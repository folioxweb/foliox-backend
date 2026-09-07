import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isMarketHours(): boolean {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  };
  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(now);
  
  let weekday = '';
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = part.value;
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
  }

  // Weekdays only (Mon-Fri)
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  if (!isWeekday) return false;

  // Indian Market Hours: 9:15 AM to 3:30 PM IST
  const timeInMinutes = hour * 60 + minute;
  const startInMinutes = 9 * 60 + 15;  // 09:15
  const endInMinutes = 15 * 60 + 30;   // 15:30

  return timeInMinutes >= startInMinutes && timeInMinutes <= endInMinutes;
}

function toYahooSymbol(symbol: string): string {
  const s = symbol.trim();
  if (s.startsWith('NSE:')) return s.replace(/^NSE:/i, '') + '.NS';
  if (s.startsWith('BSE:')) return s.replace(/^BSE:/i, '') + '.BO';
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;
  return s + '.NS';
}

async function fetchStockQuote(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  const ySym = toYahooSymbol(symbol);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (!meta || meta.regularMarketPrice === undefined) return null;
    return {
      price: Number(meta.regularMarketPrice),
      prevClose: Number(meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice)
    };
  } catch (err) {
    console.error(`Quote fetch failed for ${symbol}:`, err);
    return null;
  }
}

serve(withSystemLogging('sync-prices', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json().catch(() => ({}));
    const forceRun = body.force === true;

    // Market Hours Guard: Mon-Fri 9:15 AM - 3:30 PM IST
    if (!isMarketHours() && !forceRun) {
      return new Response(JSON.stringify({
        success: true,
        skipped: true,
        message: "Market is closed (Trading hours: Mon-Fri 9:15 AM - 3:30 PM IST). Skipping price sync."
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey || anonKey || '',
      authHeader && !serviceRoleKey ? { global: { headers: { Authorization: authHeader } } } : undefined
    );

    // 1. Fetch Real Assets (Stocks & ETFs)
    const { data: realAssets } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, asset_type')
      .in('asset_type', ['STOCK', 'ETF']);

    // 2. Fetch Watchlist Symbols
    const { data: watchlistAssets } = await supabaseAdmin
      .from('watchlist_items')
      .select('symbol');

    // 3. Fetch Paper Assets
    const { data: paperAssets } = await supabaseAdmin
      .from('paper_assets')
      .select('asset_id, symbol');

    // Collect all distinct symbols
    const symbolMap = new Map<string, { inReal: boolean; inPaper: boolean; realAssetIds: string[]; paperAssetIds: string[] }>();

    (realAssets || []).forEach(a => {
      const sym = a.symbol.trim();
      if (!symbolMap.has(sym)) {
        symbolMap.set(sym, { inReal: true, inPaper: false, realAssetIds: [a.asset_id], paperAssetIds: [] });
      } else {
        const item = symbolMap.get(sym)!;
        item.inReal = true;
        item.realAssetIds.push(a.asset_id);
      }
    });

    (watchlistAssets || []).forEach(w => {
      const sym = w.symbol.trim();
      if (!symbolMap.has(sym)) {
        symbolMap.set(sym, { inReal: false, inPaper: false, realAssetIds: [], paperAssetIds: [] });
      }
    });

    (paperAssets || []).forEach(p => {
      const sym = p.symbol.trim();
      if (!symbolMap.has(sym)) {
        symbolMap.set(sym, { inReal: false, inPaper: true, realAssetIds: [], paperAssetIds: [p.asset_id] });
      } else {
        const item = symbolMap.get(sym)!;
        item.inPaper = true;
        item.paperAssetIds.push(p.asset_id);
      }
    });

    let updatedCount = 0;
    const updatedAssets: any[] = [];
    const now = new Date().toISOString();

    for (const [symbol, info] of symbolMap.entries()) {
      const quote = await fetchStockQuote(symbol);
      if (quote) {
        // Update Real Assets if present
        if (info.realAssetIds.length > 0) {
          for (const assetId of info.realAssetIds) {
            await supabaseAdmin
              .from('assets')
              .update({
                current_price: quote.price,
                prev_close: quote.prevClose,
                last_updated: now
              })
              .eq('asset_id', assetId);
          }
        }

        // Update Paper Assets if present
        if (info.paperAssetIds.length > 0) {
          for (const assetId of info.paperAssetIds) {
            await supabaseAdmin
              .from('paper_assets')
              .update({
                current_price: quote.price,
                prev_close: quote.prevClose,
                last_updated: now
              })
              .eq('asset_id', assetId);
          }
        }

        updatedCount++;
        updatedAssets.push({ symbol, price: quote.price, prevClose: quote.prevClose });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      updatedCount,
      updatedAssets,
      timestamp: now
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
}));
