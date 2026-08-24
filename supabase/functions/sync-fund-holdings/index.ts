import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FINAPI_BASE_URL = "https://finapi.upvaly.com/api/mf/isin";

// Fetch with 429/503 retry only — no blanket delay
async function fetchHoldings(isin: string): Promise<any[]> {
  const url = `${FINAPI_BASE_URL}/${encodeURIComponent(isin)}?fields=holdings`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" }
      });

      if (res.status === 429 || res.status === 503) {
        // Only delay on rate limit responses
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json();

      if (json.status !== "success" || !json.data || !Array.isArray(json.data.holdings)) {
        throw new Error(`FinAPI error: ${json.message || json.status}`);
      }

      return json.data.holdings;
    } catch (err: any) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }

  return [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      serviceRoleKey || anonKey || '',
      authHeader && !serviceRoleKey ? { global: { headers: { Authorization: authHeader } } } : undefined
    );

    // Fetch ALL MFs and ETFs with ISINs
    const { data: assets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name, isin, asset_type')
      .in('asset_type', ['MF', 'ETF'])
      .not('isin', 'is', null);

    if (fetchErr) throw fetchErr;

    const newHoldings: any[] = [];
    const processedAssetIds: string[] = [];
    const results: any[] = [];

    // Run sequentially with a small delay to prevent FinAPI rate limiting
    for (const asset of assets || []) {
      const isin = (asset.isin || "").trim();

      if (isin.length !== 12) {
        results.push({ symbol: asset.symbol, status: 'SKIPPED', reason: `Invalid ISIN: "${isin}"` });
        continue;
      }

      // Small polite delay between each ISIN request
      await new Promise(r => setTimeout(r, 800));

      try {
        const rawHoldings = await fetchHoldings(isin);

        const stockMap: Record<string, number> = {};
        const sectorMap: Record<string, number> = {};

        for (const item of rawHoldings) {
          if (!item.name || isNaN(Number(item.weightage))) continue;
          const name = item.name.trim();
          const weight = Number(item.weightage);
          if (weight <= 0) continue;

          stockMap[name] = (stockMap[name] || 0) + weight;

          if (item.sector) {
            const sector = item.sector.trim();
            if (sector) sectorMap[sector] = (sectorMap[sector] || 0) + weight;
          }
        }

        for (const [name, weight] of Object.entries(stockMap)) {
          newHoldings.push({
            fund_asset_id: asset.asset_id,
            holding_type: 'STOCK',
            holding_name: name,
            weight_percentage: Number(weight.toFixed(2))
          });
        }

        for (const [name, weight] of Object.entries(sectorMap)) {
          newHoldings.push({
            fund_asset_id: asset.asset_id,
            holding_type: 'SECTOR',
            holding_name: name,
            weight_percentage: Number(weight.toFixed(2))
          });
        }

        processedAssetIds.push(asset.asset_id);
        results.push({
          symbol: asset.symbol,
          asset_type: asset.asset_type,
          isin,
          status: 'OK',
          stocks: Object.keys(stockMap).length,
          sectors: Object.keys(sectorMap).length,
          rawHoldingsCount: rawHoldings.length
        });
      } catch (err: any) {
        results.push({ symbol: asset.symbol, asset_type: asset.asset_type, isin, status: 'ERROR', error: err.message });
      }
    }

    // Clear old holdings only for successfully fetched assets
    if (processedAssetIds.length > 0) {
      await supabaseAdmin.from('fund_holdings').delete().in('fund_asset_id', processedAssetIds);
    }

    // Insert in batches
    let insertedCount = 0;
    if (newHoldings.length > 0) {
      const BATCH = 200;
      for (let i = 0; i < newHoldings.length; i += BATCH) {
        const { error: insertErr } = await supabaseAdmin
          .from('fund_holdings')
          .insert(newHoldings.slice(i, i + BATCH));
        if (insertErr) throw insertErr;
      }
      insertedCount = newHoldings.length;
    }

    return new Response(JSON.stringify({ success: true, rowsInserted: insertedCount, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
