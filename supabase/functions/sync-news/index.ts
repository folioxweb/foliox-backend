import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Resilient performance constants
const PER_REQUEST_TIMEOUT_MS = 5000;   // 5 seconds max per Google News RSS fetch
const CONCURRENCY_LIMIT = 5;          // Process 5 feeds concurrently
const EXECUTION_TIME_BUDGET_MS = 45000;// 45s hard budget before graceful return and flush

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
    lookbackDays: 2,
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

function parseRssXml(xmlText: string, onItem: (itemXml: string) => void): void {
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xmlText)) !== null) {
    onItem(match[1]);
  }
}

async function fetchCompanyNews(
  companyObj: { asset_id: string; symbol: string; name: string; cleanName: string },
  lookbackDays: number,
  allCompanies: { asset_id: string; symbol: string; name: string; cleanName: string }[]
): Promise<any[]> {
  const searchQuery = buildSearchQuery(companyObj, lookbackDays);
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;

  const articles: any[] = [];
  try {
    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      }
    });

    if (!response.ok) {
      console.warn(`[sync-news] HTTP ${response.status} for ${companyObj.symbol}`);
      return articles;
    }

    const xmlText = await response.text();
    const titleRegex = /<title>([\s\S]*?)<\/title>/;
    const linkRegex = /<link>([\s\S]*?)<\/link>/;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid[^>]*>([\s\S]*?)<\/guid>/;
    const sourceWithUrlRegex = /<source[^>]*url=["']([^"']*)["'][^>]*>([\s\S]*?)<\/source>/;
    const fallbackSourceRegex = /<source[^>]*>([\s\S]*?)<\/source>/;

    parseRssXml(xmlText, (itemXml) => {
      const rawGuid = itemXml.match(guidRegex)?.[1];
      if (!rawGuid) return;

      const rawTitle = cleanHtml(itemXml.match(titleRegex)?.[1] || '');
      if (!rawTitle) return;

      // Strict relevance check with word boundaries and financial context
      if (!isArticleRelevant(rawTitle, companyObj)) {
        return;
      }

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
      const title = rawTitle
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
      for (const otherComp of allCompanies) {
        if (otherComp.symbol !== companyObj.symbol && isArticleRelevant(title || rawTitle, otherComp)) {
          matchedSymbols.add(otherComp.symbol);
        }
      }

      articles.push({
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
    });
  } catch (err: any) {
    console.warn(`[sync-news] Error/timeout fetching news for ${companyObj.symbol}:`, err.message || err);
  }
  return articles;
}

async function fetchMacroNews(
  macroFeed: typeof MACRO_FEEDS[number],
  lookbackDays: number
): Promise<any[]> {
  const actualLookback = Math.min(macroFeed.lookbackDays, lookbackDays);
  const macroQuery = `${macroFeed.query} when:${actualLookback}d`;
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(macroQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;

  const articles: any[] = [];
  try {
    const response = await fetch(rssUrl, {
      signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
      }
    });

    if (!response.ok) {
      console.warn(`[sync-news] HTTP ${response.status} for macro: ${macroFeed.name}`);
      return articles;
    }

    const xmlText = await response.text();
    const titleRegex = /<title>([\s\S]*?)<\/title>/;
    const linkRegex = /<link>([\s\S]*?)<\/link>/;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid[^>]*>([\s\S]*?)<\/guid>/;
    const sourceWithUrlRegex = /<source[^>]*url=["']([^"']*)["'][^>]*>([\s\S]*?)<\/source>/;
    const fallbackSourceRegex = /<source[^>]*>([\s\S]*?)<\/source>/;

    parseRssXml(xmlText, (itemXml) => {
      const rawGuid = itemXml.match(guidRegex)?.[1];
      if (!rawGuid) return;

      const rawTitle = cleanHtml(itemXml.match(titleRegex)?.[1] || '');
      if (!rawTitle) return;

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

      const title = rawTitle
        .replace(/\s*-\s*[^-]+$/, "")
        .replace(/\s*\|\s*[^|]+$/, "")
        .replace(/\s*:\s*Live Updates$/i, "")
        .trim();

      const pubDate = new Date(pubDateStr);
      const publishedAt = isNaN(pubDate.getTime()) ? new Date().toISOString() : pubDate.toISOString();

      articles.push({
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
    });
  } catch (err: any) {
    console.warn(`[sync-news] Error/timeout fetching macro feed ${macroFeed.name}:`, err.message || err);
  }
  return articles;
}

serve(withSystemLogging('sync-news', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const startTime = performance.now();

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
    // Default lookback is 2 days (48h) for hourly cron; caller can override
    const lookbackDays = Number(payload.lookbackDays || 2);

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

    const allArticles: any[] = [];
    const seenGuids = new Set<string>();
    let companiesProcessed = 0;
    let budgetExceeded = false;

    // 3. Concurrent batch processing with execution time budget protection
    for (let i = 0; i < companyObjects.length; i += CONCURRENCY_LIMIT) {
      if (performance.now() - startTime > EXECUTION_TIME_BUDGET_MS) {
        console.warn(`[sync-news] Execution budget (${EXECUTION_TIME_BUDGET_MS}ms) reached. Processed ${companiesProcessed}/${companyObjects.length} companies.`);
        budgetExceeded = true;
        break;
      }

      const chunk = companyObjects.slice(i, i + CONCURRENCY_LIMIT);
      const chunkResults = await Promise.all(
        chunk.map(comp => fetchCompanyNews(comp, lookbackDays, companyObjects))
      );

      for (const articleList of chunkResults) {
        for (const art of articleList) {
          if (!seenGuids.has(art.guid)) {
            seenGuids.add(art.guid);
            allArticles.push(art);
          }
        }
      }
      companiesProcessed += chunk.length;
    }

    // 4. Fetch General Macro & Market Overview feeds concurrently (if within budget)
    if (!budgetExceeded && (performance.now() - startTime <= EXECUTION_TIME_BUDGET_MS)) {
      const macroResults = await Promise.all(
        MACRO_FEEDS.map(feed => fetchMacroNews(feed, lookbackDays))
      );
      for (const articleList of macroResults) {
        for (const art of articleList) {
          if (!seenGuids.has(art.guid)) {
            seenGuids.add(art.guid);
            allArticles.push(art);
          }
        }
      }
    }

    // 5. Upsert articles into news table
    let insertedCount = 0;
    if (allArticles.length > 0) {
      const { error: upsertErr, count } = await supabaseAdmin
        .from('news')
        .upsert(allArticles, { onConflict: 'guid', ignoreDuplicates: true, count: 'exact' });

      if (upsertErr) throw upsertErr;
      insertedCount = count ?? allArticles.length;
    }

    const durationMs = Math.round(performance.now() - startTime);

    return new Response(JSON.stringify({
      success: true,
      budgetExceeded,
      companiesProcessed,
      totalCompanies: companyObjects.length,
      fetched: allArticles.length,
      inserted: insertedCount,
      durationMs
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    const durationMs = Math.round(performance.now() - startTime);
    console.error('[sync-news] Error during execution:', error);
    return new Response(JSON.stringify({
      error: error.message || String(error),
      durationMs
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
}))
