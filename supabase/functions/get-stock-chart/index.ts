import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function toYahooSymbol(symbol: string): string {
  let s = symbol.trim();
  s = s.replace(/^NSE:/i, '').replace(/^BSE:/i, '');
  if (s.endsWith('.NS') || s.endsWith('.BO')) return s;
  return s + '.NS';
}

serve(withSystemLogging('get-stock-chart', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const urlObj = new URL(req.url);
    let symbol = urlObj.searchParams.get('symbol') || 'TCS.NS';
    let range = urlObj.searchParams.get('range') || '1d';
    let interval = urlObj.searchParams.get('interval') || '1m';

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      if (body.symbol) symbol = body.symbol;
      if (body.range) range = body.range;
      if (body.interval) interval = body.interval;
    }

    const ySymbol = toYahooSymbol(symbol);
    const yahooUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;

    const res = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: `Yahoo API status ${res.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: res.status
      });
    }

    const data = await res.json();
    const result = data.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      return new Response(JSON.stringify({ success: false, error: "No chart data found for symbol" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404
      });
    }

    const timestamps: number[] = result.timestamp;
    const quote = result.indicators.quote[0];
    const opens: (number | null)[] = quote.open || [];
    const highs: (number | null)[] = quote.high || [];
    const lows: (number | null)[] = quote.low || [];
    const closes: (number | null)[] = quote.close || [];
    const volumes: (number | null)[] = quote.volume || [];

    // Sort by timestamp ascending
    const items = timestamps.map((t, idx) => ({
      t,
      open: opens[idx],
      high: highs[idx],
      low: lows[idx],
      close: closes[idx],
      vol: volumes[idx] ?? 0
    })).sort((a, b) => a.t - b.t);

    const candles = [];
    const volumeBars = [];
    const seenDates = new Set<string>();
    const isIntraday = ['1m', '2m', '5m', '15m', '30m', '60m', '90m'].includes(interval);

    for (const item of items) {
      if (
        item.open == null || item.high == null || item.low == null || item.close == null ||
        !Number.isFinite(item.open) || !Number.isFinite(item.high) ||
        !Number.isFinite(item.low) || !Number.isFinite(item.close)
      ) {
        continue;
      }

      let timeVal: string | number;
      if (isIntraday) {
        timeVal = item.t;
      } else {
        timeVal = new Date(item.t * 1000).toISOString().split('T')[0];
        if (seenDates.has(timeVal as string)) continue;
        seenDates.add(timeVal as string);
      }

      candles.push({
        time: timeVal,
        open: Number(item.open.toFixed(2)),
        high: Number(item.high.toFixed(2)),
        low: Number(item.low.toFixed(2)),
        close: Number(item.close.toFixed(2))
      });

      volumeBars.push({
        time: timeVal,
        value: Number(item.vol),
        color: item.close >= item.open ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'
      });
    }

    const meta = result.meta || {};

    return new Response(JSON.stringify({
      success: true,
      symbol: ySymbol,
      currency: meta.currency || 'INR',
      regularMarketPrice: meta.regularMarketPrice,
      previousClose: meta.previousClose,
      candles,
      volumeBars
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
}, {
  payloadFilter: (res) => ({
    success: res?.success,
    symbol: res?.symbol,
    regularMarketPrice: res?.regularMarketPrice,
    previousClose: res?.previousClose,
    candleCount: res?.candles?.length
  })
}));

