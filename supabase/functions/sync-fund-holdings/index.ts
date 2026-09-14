import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

// Known slug mappings for Mutual Funds on INDmoney
const MF_SLUG_MAP: Record<string, string> = {
  'INF879O01027': 'parag-parikh-flexi-cap-fund-direct-growth',
  '122639': 'parag-parikh-flexi-cap-fund-direct-growth',
  'INF966L01689': 'quant-small-cap-fund-growth-option-direct-plan',
  '120828': 'quant-small-cap-fund-growth-option-direct-plan',
  'INF846K01EH3': 'axis-midcap-fund-direct-plan-growth',
  '120505': 'axis-midcap-fund-direct-plan-growth',
  'INF179KA1RQ7': 'hdfc-large-mid-cap-fund-direct-growth',
  '130498': 'hdfc-large-mid-cap-fund-direct-growth',
  'INF879O01100': 'parag-parikh-elss-tax-saver-fund-direct-growth',
  '147481': 'parag-parikh-elss-tax-saver-fund-direct-growth',
  'INF22M001093': 'jioblackrock-flexi-cap-fund-direct-growth',
  '153859': 'jioblackrock-flexi-cap-fund-direct-growth',
};

// NSE Official Index CSV URLs for ETFs
const ETF_INDEX_URLS: Record<string, string> = {
  'NIFTYBEES': 'https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv',
  'SETFNN50': 'https://www.niftyindices.com/IndexConstituent/ind_niftynext50list.csv',
  'ITBEES': 'https://www.niftyindices.com/IndexConstituent/ind_niftyitlist.csv',
  'HDFCSML250': 'https://www.niftyindices.com/IndexConstituent/ind_niftysmallcap250list.csv',
};

// ---------------------------------------------------------------------------
// A. Fetch ETF Constituents from Official NSE CSVs
// ---------------------------------------------------------------------------
async function fetchEtfHoldings(symbol: string): Promise<{ stocks: any[], sectors: any[] }> {
  const cleanSym = symbol.toUpperCase().replace(/^NSE:|^BSE:/, '').trim();

  // Commodity ETFs (Gold / Silver)
  if (cleanSym.includes('GOLD')) {
    return {
      stocks: [],
      sectors: [{ name: 'Commodity - Gold', weight: 100.0 }]
    };
  }
  if (cleanSym.includes('SILVER')) {
    return {
      stocks: [],
      sectors: [{ name: 'Commodity - Silver', weight: 100.0 }]
    };
  }

  const csvUrl = ETF_INDEX_URLS[cleanSym];
  if (!csvUrl) {
    return { stocks: [], sectors: [] };
  }

  try {
    const res = await fetch(csvUrl, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length <= 1) return { stocks: [], sectors: [] };

    // Header: Company Name,Industry,Symbol,Series,ISIN Code
    const stocks: any[] = [];
    const sectorMap: Record<string, number> = {};
    const stockCount = lines.length - 1;
    const equalWeight = Number((100.0 / stockCount).toFixed(2));

    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',');
      if (parts.length >= 2) {
        const companyName = parts[0].trim();
        const industry = parts[1].trim() || 'Other';
        stocks.push({ name: companyName, sector: industry, weight: equalWeight });
        sectorMap[industry] = (sectorMap[industry] || 0) + equalWeight;
      }
    }

    const sectors = Object.entries(sectorMap)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(2)) }))
      .sort((a, b) => b.weight - a.weight);

    return { stocks, sectors };
  } catch (err: any) {
    console.warn(`fetchEtfHoldings failed for ${cleanSym}:`, err.message);
    return { stocks: [], sectors: [] };
  }
}

// ---------------------------------------------------------------------------
// B. Fetch Mutual Fund Constituents via INDmoney SSR Next.js Data
// ---------------------------------------------------------------------------
async function fetchMfHoldings(identifier: { isin?: string | null, apiCode?: string | null, name?: string | null }): Promise<{ stocks: any[], sectors: any[] }> {
  let slug = (identifier.isin && MF_SLUG_MAP[identifier.isin]) || 
             (identifier.apiCode && MF_SLUG_MAP[identifier.apiCode]);

  if (!slug && identifier.name) {
    // Generate fallback slug from fund name
    slug = identifier.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .replace('-direct-plan', '-direct-growth')
      .replace('-direct', '-direct-growth');
  }

  if (!slug) return { stocks: [], sectors: [] };

  const url = `https://www.indmoney.com/mutual-funds/${slug}`;

  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (!match || !match[1]) return { stocks: [], sectors: [] };

    const data = JSON.parse(match[1]);
    const mfData = data?.props?.pageProps?.mutualFundsDetailData?.data;
    if (!mfData) return { stocks: [], sectors: [] };

    // 1. Stock holdings (ONLY Equity group)
    const holdingGroups = mfData?.holdings?.holdings || [];
    const stockMap: Record<string, { sector: string; weight: number }> = {};

    for (const grp of holdingGroups) {
      const grpName = (grp?.name || '').toLowerCase().trim();
      // Only process Equity holdings — skip Debt & Cash
      if (grpName && grpName !== 'equity') {
        continue;
      }

      const rows = grp?.table?.rows || [];
      for (const row of rows) {
        const rawName = row?.name?.trim();
        if (!rawName) continue;
        const name = rawName.slice(0, 100);
        const sector = row?.sector?.trim() || 'Other';
        const weightText = row?.columns?.[1]?.title || '';
        const weight = parseFloat(String(weightText).replace('%', ''));

        if (!isNaN(weight) && weight > 0) {
          if (!stockMap[name]) {
            stockMap[name] = { sector, weight };
          } else {
            stockMap[name].weight = Number((stockMap[name].weight + weight).toFixed(2));
          }
        }
      }
    }

    const stocks = Object.entries(stockMap)
      .map(([name, val]) => ({ name, sector: val.sector, weight: Number(val.weight.toFixed(2)) }))
      .sort((a, b) => b.weight - a.weight);

    // 2. Sector allocations (Equity sectors + Debt & Cash attribution)
    const distributions = mfData?.sector_allocation?.distribution || [];
    const sectorMap: Record<string, number> = {};

    for (const dist of distributions) {
      const distName = (dist?.name || '').toLowerCase().trim();
      const distPerc = Number(dist?.PercentageVal || parseFloat(String(dist?.perc || 0).replace('%', '')));

      if (distName === 'equity') {
        const secList = dist?.sectors || [];
        for (const s of secList) {
          const sName = s?.name?.trim();
          const sWeight = Number(s?.percValue || parseFloat(String(s?.perc || 0).replace('%', '')));
          if (sName && !isNaN(sWeight) && sWeight > 0) {
            sectorMap[sName] = (sectorMap[sName] || 0) + sWeight;
          }
        }
      } else if (distName.includes('debt') || distName.includes('cash')) {
        if (!isNaN(distPerc) && distPerc > 0) {
          sectorMap['Debt & Cash'] = (sectorMap['Debt & Cash'] || 0) + distPerc;
        }
      }
    }

    // If no Debt & Cash distribution was found, but stocks sum to less than 98%, add remainder as Debt & Cash
    const totalStockWeight = stocks.reduce((acc, s) => acc + s.weight, 0);
    if (!sectorMap['Debt & Cash'] && totalStockWeight > 0 && totalStockWeight < 98.0) {
      const remainder = Number((100.0 - totalStockWeight).toFixed(2));
      if (remainder > 0.5) {
        sectorMap['Debt & Cash'] = remainder;
      }
    }

    const sectors = Object.entries(sectorMap)
      .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(2)) }))
      .sort((a, b) => b.weight - a.weight);

    return { stocks, sectors };
  } catch (err: any) {
    console.warn(`fetchMfHoldings failed for slug ${slug}:`, err.message);
    return { stocks: [], sectors: [] };
  }
}

// ---------------------------------------------------------------------------
// Edge Function Entrypoint
// ---------------------------------------------------------------------------
serve(withSystemLogging('sync-fund-holdings', async (req) => {
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

    let targetAssetId: string | null = null;
    let targetIsin: string | null = null;

    if (req.method === 'POST') {
      try {
        const body = await req.json();
        targetAssetId = body.asset_id || body.assetId || null;
        targetIsin = body.isin || null;
      } catch (_e) {}
    }

    if (!targetAssetId || !targetIsin) {
      try {
        const url = new URL(req.url);
        targetAssetId = targetAssetId || url.searchParams.get('asset_id') || url.searchParams.get('assetId');
        targetIsin = targetIsin || url.searchParams.get('isin');
      } catch (_e) {}
    }

    // -------------------------------------------------------------------------
    // A. Single-Fund On-Demand Sync
    // -------------------------------------------------------------------------
    if (targetAssetId || targetIsin) {
      const query = supabaseAdmin.from('assets').select('asset_id, symbol, name, isin, api_code, asset_type');
      if (targetAssetId) query.eq('asset_id', targetAssetId);
      else if (targetIsin) query.eq('isin', targetIsin);

      const { data: assetRow } = await query.maybeSingle();

      if (!assetRow) {
        throw new Error(`Asset not found for id: ${targetAssetId || targetIsin}`);
      }

      let holdingsResult: { stocks: any[], sectors: any[] } = { stocks: [], sectors: [] };

      if (assetRow.asset_type === 'ETF') {
        holdingsResult = await fetchEtfHoldings(assetRow.symbol);
      } else {
        holdingsResult = await fetchMfHoldings({
          isin: assetRow.isin,
          apiCode: assetRow.api_code,
          name: assetRow.name
        });
      }

      // Mathematical Primary Key deduplication guard: (holding_type, holding_name)
      const singleHoldingsMap = new Map<string, any>();

      for (const s of holdingsResult.stocks) {
        const name = (s.name || '').trim().slice(0, 100);
        if (!name) continue;
        const key = `STOCK:${name.toLowerCase()}`;
        if (!singleHoldingsMap.has(key)) {
          singleHoldingsMap.set(key, {
            fund_asset_id: assetRow.asset_id,
            holding_type: 'STOCK',
            holding_name: name,
            weight_percentage: s.weight
          });
        } else {
          // If duplicate key encountered, accumulate weight
          const existing = singleHoldingsMap.get(key);
          existing.weight_percentage = Number((existing.weight_percentage + s.weight).toFixed(2));
        }
      }

      for (const sec of holdingsResult.sectors) {
        const name = (sec.name || '').trim().slice(0, 100);
        if (!name) continue;
        const key = `SECTOR:${name.toLowerCase()}`;
        if (!singleHoldingsMap.has(key)) {
          singleHoldingsMap.set(key, {
            fund_asset_id: assetRow.asset_id,
            holding_type: 'SECTOR',
            holding_name: name,
            weight_percentage: sec.weight
          });
        } else {
          const existing = singleHoldingsMap.get(key);
          existing.weight_percentage = Number((existing.weight_percentage + sec.weight).toFixed(2));
        }
      }

      const singleHoldings = Array.from(singleHoldingsMap.values());

      // CRITICAL GUARD: Only replace existing holdings if new holdings were verified!
      if (singleHoldings.length > 0) {
        let targetAssetIds = [assetRow.asset_id];
        if (assetRow.isin) {
          const { data: siblings } = await supabaseAdmin
            .from('assets')
            .select('asset_id')
            .eq('isin', assetRow.isin);
          if (siblings && siblings.length > 0) {
            targetAssetIds = siblings.map((s: any) => s.asset_id);
          }
        }

        await supabaseAdmin.from('fund_holdings').delete().in('fund_asset_id', targetAssetIds);

        const allHoldingsToInsert: any[] = [];
        for (const aid of targetAssetIds) {
          for (const h of singleHoldings) {
            allHoldingsToInsert.push({ ...h, fund_asset_id: aid });
          }
        }

        const { error: insErr } = await supabaseAdmin.from('fund_holdings').insert(allHoldingsToInsert);
        if (insErr) throw insErr;
      }

      return new Response(JSON.stringify({ 
        success: true, 
        asset_id: assetRow.asset_id, 
        symbol: assetRow.symbol,
        isin: assetRow.isin, 
        stocks: holdingsResult.stocks, 
        sectors: holdingsResult.sectors, 
        rowsInserted: singleHoldings.length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // -------------------------------------------------------------------------
    // B. Batch Sync (All MFs & ETFs)
    // -------------------------------------------------------------------------
    const { data: assets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name, isin, api_code, asset_type')
      .in('asset_type', ['MF', 'ETF']);

    if (fetchErr) throw fetchErr;

    let totalInserted = 0;
    const results: any[] = [];

    for (const asset of assets || []) {
      await new Promise(r => setTimeout(r, 600)); // Polite interval

      let holdingsResult: { stocks: any[], sectors: any[] } = { stocks: [], sectors: [] };

      if (asset.asset_type === 'ETF') {
        holdingsResult = await fetchEtfHoldings(asset.symbol);
      } else {
        holdingsResult = await fetchMfHoldings({
          isin: asset.isin,
          apiCode: asset.api_code,
          name: asset.name
        });
      }

      const assetHoldingsMap = new Map<string, any>();

      for (const s of holdingsResult.stocks) {
        const name = (s.name || '').trim().slice(0, 100);
        if (!name) continue;
        const key = `STOCK:${name.toLowerCase()}`;
        if (!assetHoldingsMap.has(key)) {
          assetHoldingsMap.set(key, {
            fund_asset_id: asset.asset_id,
            holding_type: 'STOCK',
            holding_name: name,
            weight_percentage: s.weight
          });
        } else {
          const existing = assetHoldingsMap.get(key);
          existing.weight_percentage = Number((existing.weight_percentage + s.weight).toFixed(2));
        }
      }

      for (const sec of holdingsResult.sectors) {
        const name = (sec.name || '').trim().slice(0, 100);
        if (!name) continue;
        const key = `SECTOR:${name.toLowerCase()}`;
        if (!assetHoldingsMap.has(key)) {
          assetHoldingsMap.set(key, {
            fund_asset_id: asset.asset_id,
            holding_type: 'SECTOR',
            holding_name: name,
            weight_percentage: sec.weight
          });
        } else {
          const existing = assetHoldingsMap.get(key);
          existing.weight_percentage = Number((existing.weight_percentage + sec.weight).toFixed(2));
        }
      }

      const assetHoldings = Array.from(assetHoldingsMap.values());

      // CRITICAL GUARD: Only clear & update if fresh data was successfully fetched!
      if (assetHoldings.length > 0) {
        await supabaseAdmin.from('fund_holdings').delete().eq('fund_asset_id', asset.asset_id);
        const { error: insErr } = await supabaseAdmin.from('fund_holdings').insert(assetHoldings);
        if (!insErr) {
          totalInserted += assetHoldings.length;
        }
      }

      results.push({
        symbol: asset.symbol,
        asset_type: asset.asset_type,
        status: assetHoldings.length > 0 ? 'UPDATED' : 'PRESERVED',
        stocksCount: holdingsResult.stocks.length,
        sectorsCount: holdingsResult.sectors.length
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      rowsInserted: totalInserted, 
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
}));
