import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LEGAL_SUFFIX_RE = /\b(Limited|Ltd\.?|Corporation|Corp\.?|Inc\.?|PLC|LLP|Pvt\.?|Private|Holdings?|Enterprises?|Co\.?)\b/gi;

const FINANCIAL_CONTEXT_REGEX = /\b(stocks?|shares?|equity|equities|q[1-4]|quarter|quarterly|results?|profit|loss|revenue|ebitda|dividend|yield|order|contract|target|brokerage|buy|sell|downgrade|upgrade|board|agm|filing|sebi|bse|nse|nifty|sensex|rises?|falls?|jumps?|plunges?|surges?|gains?|dips?|rally|stake|capex|merger|acquisition)\b/i;

const MACRO_FEEDS = [
  {
    name: 'Nifty 50 & Indian Markets',
    query: '"Nifty 50" OR "Sensex" OR "Indian stock market"',
    lookbackDays: 2,
    category: 'Market',
    source: 'Market Overview'
  },
  {
    name: 'RBI & Macroeconomy',
    query: '"Reserve Bank of India" OR "RBI monetary policy" OR "repo rate" OR "Indian economy"',
    lookbackDays: 3,
    category: 'Economy',
    source: 'Economic Outlook'
  }
];

function cleanHtml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function getCleanCompanyName(name: string): string {
  return (name || '')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^a-zA-Z0-9 &]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchQuery(company: { name: string; symbol: string; cleanName: string }, lookbackDays: number): string {
  // If clean name is substantial (>= 4 chars) and distinct
  if (company.cleanName.length >= 4 && company.cleanName.toLowerCase() !== company.symbol.toLowerCase()) {
    return `"${company.cleanName}" OR "${company.symbol}" when:${lookbackDays}d`;
  }
  // For short acronyms (e.g. REC, ITC, BEL, HAL, SBI, TCS), pair with market context to avoid noisy results
  return `"${company.name}" OR ("${company.symbol}" AND (stock OR shares OR results OR profit OR dividend OR quarterly OR order OR market)) when:${lookbackDays}d`;
}

function isArticleRelevant(title: string, company: { name: string; symbol: string; cleanName: string }): boolean {
  // 1. Check clean name with strict word boundary
  if (company.cleanName.length >= 4) {
    const escaped = company.cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nameRegex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (nameRegex.test(title)) return true;
  }

  // 2. Check symbol with strict word boundary
  const escapedSym = company.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const symRegex = new RegExp(`\\b${escapedSym}\\b`, 'i');
  if (symRegex.test(title)) {
    // If symbol is short (<= 4 chars like REC, ITC, BEL, HAL, SBI, TCS), require financial context
    if (company.symbol.length <= 4) {
      return FINANCIAL_CONTEXT_REGEX.test(title);
    }
    return true;
  }

  return false;
}

serve(withSystemLogging('sync-news', async (req) => {
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

    const payload = await req.json().catch(() => ({}));
    const lookbackDays = Number(payload.lookbackDays || 7);

    // 1. Fetch tracked assets
    const { data: assets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name')
      .in('asset_type', ['STOCK', 'ETF']);

    if (fetchErr) throw fetchErr;

    // 2. Query nse_stocks to enrich canonical company names
    const assetSymbols = (assets || []).map(a => a.symbol).filter(Boolean);
    const { data: nseList } = await supabaseAdmin
      .from('nse_stocks')
      .select('symbol, name')
      .in('symbol', assetSymbols);

    const nseNameMap = new Map<string, string>();
    (nseList || []).forEach(n => {
      if (n.symbol && n.name) nseNameMap.set(n.symbol, n.name);
    });

    const newArticles: any[] = [];
    const seenGuids = new Set<string>();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>([\s\S]*?)<\/title>/;
    const linkRegex = /<link>([\s\S]*?)<\/link>/;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid[^>]*>([\s\S]*?)<\/guid>/;
    const sourceWithUrlRegex = /<source[^>]*url=["']([^"']*)["'][^>]*>([\s\S]*?)<\/source>/;
    const fallbackSourceRegex = /<source[^>]*>([\s\S]*?)<\/source>/;

    // Build lookup for all tracked companies for multi-symbol cross-referencing
    const companyObjects = (assets || []).map(asset => {
      const canonicalName = nseNameMap.get(asset.symbol) || asset.name || asset.symbol;
      const cleanName = getCleanCompanyName(canonicalName);
      return {
        asset_id: asset.asset_id,
        symbol: asset.symbol,
        name: canonicalName,
        cleanName
      };
    });

    // 3. Fetch news for individual tracked stocks / ETFs
    for (const companyObj of companyObjects) {
      const searchQuery = buildSearchQuery(companyObj, lookbackDays);
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;

      try {
        const response = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) continue;

        const xmlText = await response.text();
        let match;

        while ((match = itemRegex.exec(xmlText)) !== null) {
          const itemXml = match[1];
          const rawGuid = itemXml.match(guidRegex)?.[1];
          if (!rawGuid || seenGuids.has(rawGuid)) continue;

          let rawTitle = cleanHtml(itemXml.match(titleRegex)?.[1] || '');
          if (!rawTitle) continue;

          // Strict relevance check with word boundaries and financial context
          if (!isArticleRelevant(rawTitle, companyObj)) {
            continue;
          }

          seenGuids.add(rawGuid);

          const link = cleanHtml(itemXml.match(linkRegex)?.[1] || '');
          const pubDateStr = itemXml.match(pubDateRegex)?.[1] || '';
          
          let publisherDomain = '';
          let source = '';
          const sourceMatch = itemXml.match(sourceWithUrlRegex);
          if (sourceMatch) {
            publisherDomain = cleanHtml(sourceMatch[1]);
            source = cleanHtml(sourceMatch[2]);
          } else {
            source = cleanHtml(itemXml.match(fallbackSourceRegex)?.[1] || '');
          }

          // Clean title: strip trailing source & live updates suffix
          let title = rawTitle
            .replace(/\s*-\s*[^-]+$/, "")
            .replace(/\s*\|\s*[^|]+$/, "")
            .replace(/\s*:\s*Live Updates$/i, "")
            .trim();

          if (!source && rawTitle.includes(' - ')) {
            const parts = rawTitle.split(' - ');
            source = parts[parts.length - 1].trim();
          }

          const pubDate = new Date(pubDateStr);
          const publishedAt = isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString();

          // Multi-symbol detection: check if other portfolio assets are also mentioned
          const matchedSymbols = new Set<string>([companyObj.symbol]);
          for (const otherComp of companyObjects) {
            if (otherComp.symbol !== companyObj.symbol && isArticleRelevant(title || rawTitle, otherComp)) {
              matchedSymbols.add(otherComp.symbol);
            }
          }

          newArticles.push({
            guid: rawGuid,
            asset_id: companyObj.asset_id,
            symbols: Array.from(matchedSymbols),
            title: title || rawTitle,
            source: source || 'Google News',
            publisher_domain: publisherDomain || null,
            publisher_name: source || 'Google News',
            published_at: publishedAt,
            url: link,
            category: 'Stock'
          });
        }
      } catch (e) {
        console.warn(`Failed fetching news for ${companyObj.symbol}:`, e);
      }
    }

    // 4. Fetch General Macro & Market Overview feeds (asset_id = null)
    for (const macroFeed of MACRO_FEEDS) {
      const macroQuery = `${macroFeed.query} when:${macroFeed.lookbackDays}d`;
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(macroQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;

      try {
        const response = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (!response.ok) continue;

        const xmlText = await response.text();
        let match;

        while ((match = itemRegex.exec(xmlText)) !== null) {
          const itemXml = match[1];
          const rawGuid = itemXml.match(guidRegex)?.[1];
          if (!rawGuid || seenGuids.has(rawGuid)) continue;

          let rawTitle = cleanHtml(itemXml.match(titleRegex)?.[1] || '');
          if (!rawTitle) continue;

          seenGuids.add(rawGuid);

          const link = cleanHtml(itemXml.match(linkRegex)?.[1] || '');
          const pubDateStr = itemXml.match(pubDateRegex)?.[1] || '';
          
          let publisherDomain = '';
          let source = '';
          const sourceMatch = itemXml.match(sourceWithUrlRegex);
          if (sourceMatch) {
            publisherDomain = cleanHtml(sourceMatch[1]);
            source = cleanHtml(sourceMatch[2]);
          } else {
            source = cleanHtml(itemXml.match(fallbackSourceRegex)?.[1] || '');
          }

          let title = rawTitle
            .replace(/\s*-\s*[^-]+$/, "")
            .replace(/\s*\|\s*[^|]+$/, "")
            .replace(/\s*:\s*Live Updates$/i, "")
            .trim();

          const pubDate = new Date(pubDateStr);
          const publishedAt = isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString();

          newArticles.push({
            guid: rawGuid,
            asset_id: null,
            symbols: [],
            title: title || rawTitle,
            source: source || macroFeed.source,
            publisher_domain: publisherDomain || null,
            publisher_name: source || macroFeed.source,
            published_at: publishedAt,
            url: link,
            category: macroFeed.category
          });
        }
      } catch (e) {
        console.warn(`Failed fetching macro news for ${macroFeed.name}:`, e);
      }
    }

    // 5. Upsert articles into news table
    let insertedCount = 0;
    if (newArticles.length > 0) {
      const { error: upsertErr, count } = await supabaseAdmin
        .from('news')
        .upsert(newArticles, { onConflict: 'guid', ignoreDuplicates: true, count: 'exact' });

      if (upsertErr) throw upsertErr;
      insertedCount = count ?? newArticles.length;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      fetched: newArticles.length, 
      inserted: insertedCount 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
}))
