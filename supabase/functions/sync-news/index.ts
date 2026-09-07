import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const COMPANY_SEARCH_MAP: Record<string, string> = {
  "Tata Consultancy Services Ltd": '"TCS" OR "Tata Consultancy Services"',
  "TCS": '"TCS" OR "Tata Consultancy Services"',
  "Reliance Industries Ltd": '"Reliance Industries" OR "Reliance Ltd."',
  "RELIANCE": '"Reliance Industries" OR "Reliance Ltd."',
  "HDFC Bank Ltd": '"HDFC Bank"',
  "Hdfc Bank": '"HDFC Bank"',
  "HDFC": '"HDFC Bank"',
  "HDFCBANK": '"HDFC Bank"',
  "Infosys Ltd": '"Infosys" OR "INFY"',
  "INFY": '"Infosys" OR "INFY"',
  "REC Ltd.": '"REC Limited"',
  "REC": '"REC Limited"',
  "RECLTD": '"REC Limited"',
  "Affle 3i Ltd": '"Affle India" OR "AFFLE"',
  "AFFLE": '"Affle India" OR "AFFLE"',
  "Lodha Developers": '"Macrotech Developers"',
  "LODHA": '"Macrotech Developers"',
  "Home First Finance Co India Ltd": '"Home First Finance"',
  "HOMEFIRST": '"Home First Finance"',
  "United Spirits": '"United Spirits" OR "MCDOWELL-N"',
  "MCDOWELL-N": '"United Spirits" OR "MCDOWELL-N"',
  "Elecon Engineering Co Ltd": '"Elecon Engineering"',
  "ELECON": '"Elecon Engineering"',
  "BLS International Services Ltd": '"BLS International"',
  "BLS": '"BLS International"',
  "Bajaj Housing Finance": '"Bajaj Housing Finance"',
  "BAJAJHFL": '"Bajaj Housing Finance"',
  "Poly Medicure Ltd": '"Poly Medicure" OR "POLYMED"',
  "POLYMED": '"Poly Medicure" OR "POLYMED"',
  "KPI Green": '"KPI Green Energy" OR "KPIGREEN"',
  "KPIGREEN": '"KPI Green Energy" OR "KPIGREEN"',
  "State Bank of India": '"State Bank of India" OR "SBI"',
  "SBIN": '"State Bank of India" OR "SBI"',
  "ICICI Bank": '"ICICI Bank"',
  "ICICIBANK": '"ICICI Bank"'
};

const LEGAL_SUFFIX_RE = /\b(Ltd\.?|Limited|Co\.?|Corp\.?|Inc\.?|PLC|LLP|Pvt\.?|Industries|Services|Finance|International|Developers|Engineering)\b/gi;

function cleanHtml(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, '')
    .trim();
}

function buildSearchQuery(company: { name: string; symbol: string }, lookbackDays: number): string {
  const normalized =
    COMPANY_SEARCH_MAP[company.name] ||
    COMPANY_SEARCH_MAP[company.symbol] ||
    `"${company.name}" OR "${company.symbol}"`;

  return `${normalized} when:${lookbackDays}d`;
}

function buildMatchKeywords(company: { name: string; symbol: string }): string[] {
  const mapEntry = COMPANY_SEARCH_MAP[company.name] || COMPANY_SEARCH_MAP[company.symbol];

  if (mapEntry) {
    const quoted: string[] = [];
    const quoteRe = /"([^"]+)"/g;
    let m;
    while ((m = quoteRe.exec(mapEntry)) !== null) {
      quoted.push(m[1].toLowerCase());
    }
    if (quoted.length > 0) return [...new Set(quoted)];
  }

  const cleaned = (company.name || company.symbol)
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (cleaned.length >= 3) return [cleaned];

  return [company.name ? company.name.toLowerCase() : company.symbol.toLowerCase()];
}

function isArticleRelevant(articleTitle: string, company: { name: string; symbol: string }): boolean {
  const keywords = buildMatchKeywords(company);
  if (keywords.length === 0) return true;
  const title = articleTitle.toLowerCase();
  return keywords.some(kw => title.includes(kw));
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

    const { data: assets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name')
      .in('asset_type', ['STOCK', 'ETF']);

    if (fetchErr) throw fetchErr;

    const newArticles: any[] = [];
    const seenGuids = new Set<string>();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>([\s\S]*?)<\/title>/;
    const linkRegex = /<link>([\s\S]*?)<\/link>/;
    const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid[^>]*>([\s\S]*?)<\/guid>/;
    const sourceRegex = /<source[^>]*>([\s\S]*?)<\/source>/;

    for (const asset of assets || []) {
      const companyObj = { name: asset.name || asset.symbol, symbol: asset.symbol };
      const searchQuery = buildSearchQuery(companyObj, lookbackDays);
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}&hl=en-IN&gl=IN&ceid=IN:en`;

      try {
        const response = await fetch(rssUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
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

          // Post-fetch relevance guard exactly as in GAS
          if (!isArticleRelevant(rawTitle, companyObj)) {
            continue;
          }

          seenGuids.add(rawGuid);

          const link = cleanHtml(itemXml.match(linkRegex)?.[1] || '');
          const pubDateStr = itemXml.match(pubDateRegex)?.[1] || '';
          let source = cleanHtml(itemXml.match(sourceRegex)?.[1] || '');

          // Clean title like GAS NewsService: strip trailing source & live updates
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

          newArticles.push({
            guid: rawGuid,
            asset_id: asset.asset_id,
            title: title || rawTitle,
            source: source || 'Google News',
            published_at: publishedAt,
            url: link,
            is_read: false
          });
        }
      } catch (e) {
        console.warn(`Failed fetching news for ${asset.symbol}:`, e);
      }
    }

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
