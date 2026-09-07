import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(withSystemLogging('sync-nse-stocks', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const now = new Date().toISOString();
    const records: any[] = [];
    const seenSymbols = new Set<string>();

    const reqHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5'
    };

    // 1. Ingest Listed Equities (EQUITY_L.csv)
    try {
      const equityUrl = "https://archives.nseindia.com/content/equities/EQUITY_L.csv";
      const eqRes = await fetch(equityUrl, { headers: reqHeaders });
      if (eqRes.ok) {
        const eqText = await eqRes.text();
        const eqLines = eqText.split(/\r?\n/).filter(line => line.trim().length > 0);
        for (let i = 1; i < eqLines.length; i++) {
          const cols = eqLines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.length >= 7) {
            const symbol = cols[0].toUpperCase();
            const name = cols[1];
            const series = cols[2];
            const isin = cols[6].toUpperCase();

            if (symbol && isin && (isin.startsWith('INE') || isin.startsWith('INF')) && !seenSymbols.has(symbol)) {
              seenSymbols.add(symbol);
              records.push({
                symbol,
                isin,
                name: name || symbol,
                series: series || 'EQ',
                last_updated: now
              });
            }
          }
        }
      }
    } catch (eqErr) {
      console.warn("Error fetching NSE Equity CSV:", eqErr);
    }

    // 2. Ingest Listed ETFs (eq_etfseclist.csv)
    try {
      const etfUrl = "https://archives.nseindia.com/content/equities/eq_etfseclist.csv";
      const etfRes = await fetch(etfUrl, { headers: reqHeaders });
      if (etfRes.ok) {
        const etfText = await etfRes.text();
        const etfLines = etfText.split(/\r?\n/).filter(line => line.trim().length > 0);
        // Header: Symbol,Underlying,SecurityName,DateofListing,MarketLot,ISINNumber,FaceValue
        for (let i = 1; i < etfLines.length; i++) {
          const cols = etfLines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.length >= 6) {
            const symbol = cols[0].toUpperCase();
            const underlying = cols[1];
            const name = cols[2];
            const isin = cols[5].toUpperCase();

            if (symbol && isin) {
              if (seenSymbols.has(symbol)) {
                // Update existing record with ETF series and underlying
                const existing = records.find(r => r.symbol === symbol);
                if (existing) {
                  existing.series = 'ETF';
                  existing.sector = underlying || 'ETF';
                }
              } else {
                seenSymbols.add(symbol);
                records.push({
                  symbol,
                  isin,
                  name: name || symbol,
                  sector: underlying || 'ETF',
                  series: 'ETF',
                  last_updated: now
                });
              }
            }
          }
        }
      }
    } catch (etfErr) {
      console.warn("Error fetching NSE ETF CSV:", etfErr);
    }

    if (records.length === 0) {
      throw new Error("No valid stock or ETF records parsed from NSE");
    }

    // Upsert in batches of 500
    const BATCH_SIZE = 500;
    let upsertedCount = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('nse_stocks')
        .upsert(batch, { onConflict: 'symbol' });

      if (error) {
        console.error(`Batch upsert error at ${i}:`, error.message);
      } else {
        upsertedCount += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      totalParsed: records.length,
      upsertedCount,
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
