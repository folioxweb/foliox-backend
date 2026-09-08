import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SCRIP_CODE_MAP: Record<string, string> = {
  'HDFCBANK': '500180',
  'HDFC': '500180',
  'RELIANCE': '500325',
  'TCS': '532540',
  'INFY': '500209',
  'ICICIBANK': '532174',
  'SBIN': '500112',
  'BHARTIARTL': '532454',
  'ITC': '500875',
  'KOTAKBANK': '500247',
  'LT': '500510',
  'AXISBANK': '532215',
  'ASIANPAINT': '500820',
  'MARUTI': '532500',
  'SUNPHARMA': '524715',
  'BAJFINANCE': '500034',
  'TATAMOTORS': '500570',
  'ULTRACEMCO': '532538',
  'TITAN': '500114',
  'WIPRO': '507685',
  'HCLTECH': '532281',
  'NTPC': '532555',
  'POWERGRID': '532898',
  'ONGC': '500312',
  'COALINDIA': '533278',
  'M&M': '500520',
  'BAJAJFINSV': '532978',
  'NESTLEIND': '500790',
  'JSWSTEEL': '500228',
  'TATASTEEL': '500470',
  'UJJIVANSFB': '542904',
  'AIAENG': '532683',
  'HDFCAMC': '541729',
  'EXIDEIND': '500086'
};

const DOCUMENT_TYPES = {
  RESULTS: "RESULTS",
  INVESTOR_PRESENTATION: "PRESENTATION",
  EARNINGS_CALL: "TRANSCRIPT",
  ANALYST_MEETING: "ANALYST_MEETING",
  ANALYST_MEETING_INTIMATION: "ANALYST_MEETING_INTIMATION",
  BOARD_MEETING: "BOARD_MEETING",
  ANNUAL_REPORT: "ANNUAL_REPORT",
  BRSR: "BRSR",
  PRESS_RELEASE: "PRESS_RELEASE",
  DIVIDEND: "DIVIDEND",
  BONUS: "BONUS",
  SPLIT: "SPLIT",
  BUYBACK: "BUYBACK",
  RIGHTS: "RIGHTS",
  CREDIT_RATING: "CREDIT_RATING",
  MANAGEMENT_CHANGE: "MANAGEMENT_CHANGE",
  DIRECTOR_CHANGE: "DIRECTOR_CHANGE",
  ESG: "ESG",
  OTHER: "OTHER"
};

function classifyDocument(title: string): string {
  const t = (title || "").toLowerCase();

  if (t.includes("earnings call transcript") || t.includes("transcript")) return DOCUMENT_TYPES.EARNINGS_CALL;
  if (t.includes("investor presentation") || t.includes("presentation")) return DOCUMENT_TYPES.INVESTOR_PRESENTATION;
  if (t.includes("analyst / investor meet") && t.includes("intimation")) return DOCUMENT_TYPES.ANALYST_MEETING_INTIMATION;
  if (t.includes("analyst / investor meet") || t.includes("analyst meeting")) return DOCUMENT_TYPES.ANALYST_MEETING;
  if (t.includes("financial results") || t.includes("quarterly results") || t.includes("audited") || t.includes("unaudited") || t.includes("outcome of board meeting")) return DOCUMENT_TYPES.RESULTS;
  if (t.includes("annual report") || t.includes("integrated annual report")) return DOCUMENT_TYPES.ANNUAL_REPORT;
  if (t.includes("brsr")) return DOCUMENT_TYPES.BRSR;
  if (t.includes("board meeting")) return DOCUMENT_TYPES.BOARD_MEETING;
  if (t.includes("dividend")) return DOCUMENT_TYPES.DIVIDEND;
  if (t.includes("bonus")) return DOCUMENT_TYPES.BONUS;
  if (t.includes("split")) return DOCUMENT_TYPES.SPLIT;
  if (t.includes("buyback")) return DOCUMENT_TYPES.BUYBACK;
  if (t.includes("rights")) return DOCUMENT_TYPES.RIGHTS;
  if (t.includes("credit rating")) return DOCUMENT_TYPES.CREDIT_RATING;
  if (t.includes("change in management")) return DOCUMENT_TYPES.MANAGEMENT_CHANGE;
  if (t.includes("change in director")) return DOCUMENT_TYPES.DIRECTOR_CHANGE;
  if (t.includes("press release")) return DOCUMENT_TYPES.PRESS_RELEASE;
  if (t.includes("esg")) return DOCUMENT_TYPES.ESG;

  return DOCUMENT_TYPES.OTHER;
}

function getQuarterlyReportingPeriod(announcementDate: Date): string {
  const month = announcementDate.getMonth() + 1;
  const year = announcementDate.getFullYear();

  let quarter = "";
  let fyYear = year;

  if (month >= 4 && month <= 5) {
    quarter = "Q4";
    fyYear = year - 1;
  } else if (month >= 6 && month <= 8) {
    quarter = "Q1";
  } else if (month >= 9 && month <= 11) {
    quarter = "Q2";
  } else if (month === 12 || month <= 2) {
    quarter = "Q3";
    if (month <= 2) fyYear = year - 1;
  } else {
    return "";
  }
  return quarter + " FY" + String(fyYear + 1).slice(-2);
}

function getAnnualReportingPeriod(title: string): string {
  const match = title.match(/FY\s*(\d{4})-(\d{2})/i) || title.match(/(\d{4})-(\d{2})/);
  if (!match) return "";
  return "FY" + match[2];
}

function getReportingPeriod(documentType: string, title: string, announcementDateStr: string): string {
  const announcementDate = new Date(announcementDateStr);
  switch (documentType) {
    case DOCUMENT_TYPES.RESULTS:
    case DOCUMENT_TYPES.INVESTOR_PRESENTATION:
    case DOCUMENT_TYPES.EARNINGS_CALL:
    case DOCUMENT_TYPES.ANALYST_MEETING:
    case DOCUMENT_TYPES.ANALYST_MEETING_INTIMATION:
    case DOCUMENT_TYPES.BOARD_MEETING:
      return getQuarterlyReportingPeriod(announcementDate);
    case DOCUMENT_TYPES.ANNUAL_REPORT:
    case DOCUMENT_TYPES.BRSR:
      return getAnnualReportingPeriod(title);
    default:
      return "";
  }
}

function buildPdfUrl(fileName: string, announcementDateStr: string): string {
  if (!fileName) return "";
  if (announcementDateStr) {
    const announcementDate = new Date(announcementDateStr);
    const today = new Date();
    const diffTime = Math.abs(today.getTime() - announcementDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    if (diffDays <= 3) {
      return "https://www.bseindia.com/xml-data/corpfiling/AttachLive/" + fileName;
    }
  }
  return "https://www.bseindia.com/xml-data/corpfiling/AttachHis/" + fileName;
}

/**
 * Resolves BSE Scrip Code for an equity symbol using the official BSE Search Endpoint.
 * Gracefully ignores 'BSE' (which is listed only on NSE).
 */
async function resolveScripCode(symbol: string): Promise<string | null> {
  const cleanSym = symbol.replace(/^(NSE:|BSE:)/i, '').replace(/(\.NS|\.BO)$/i, '').trim().toUpperCase();

  // BSE Limited (BSE) is listed exclusively on NSE and does not have a BSE scrip code
  if (cleanSym === 'BSE') return null;

  try {
    const res = await fetch(
      `https://api.bseindia.com/Msource/1D/GetQuoteAllSearch.aspx?&text=${encodeURIComponent(cleanSym)}&flag=site`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.bseindia.com/',
          'Origin': 'https://www.bseindia.com',
          'Accept': 'text/html, */*'
        }
      }
    );

    if (!res.ok) return null;
    const html = await res.text();

    // 1. Strict exact symbol match inside <strong> or <span> followed by ISIN and 6-digit scrip code
    const exactRegex = new RegExp(`(?:<strong>|<span>)\\s*${cleanSym}\\s*(?:<\\/strong>)?(?:&nbsp;|\\s)+INE[A-Z0-9]{9,10}(?:&nbsp;|\\s)+(\\d{6})`, 'i');
    const exactMatch = html.match(exactRegex);
    if (exactMatch && exactMatch[1]) return exactMatch[1];

    // 2. URL href match: /stock-share-price/<company-slug>/<cleanSym>/<scripCode>/
    const hrefRegex = new RegExp(`\\/stock-share-price\\/[^\\/]+\\/${cleanSym.toLowerCase()}\\/(\\d{6})\\/`, 'i');
    const hrefMatch = html.match(hrefRegex);
    if (hrefMatch && hrefMatch[1]) return hrefMatch[1];

    // 3. Fallback: Check first equity match (href starting with /stock-share-price/ but not derivatives or mf)
    const equityMatch = html.match(/\/stock-share-price\/(?!future-options)[^\/]+\/[^\/]+\/(\d{6})\//);
    if (equityMatch && equityMatch[1]) return equityMatch[1];

    return null;
  } catch (err) {
    console.warn(`BSE scrip lookup failed for ${cleanSym}:`, err);
    return null;
  }
}

interface DateSlice {
  fromDate: string; // YYYYMMDD
  toDate: string;   // YYYYMMDD
}

/**
 * Splits a date range into rolling 365-day slices.
 * BSE's AnnSubCategoryGetData/w endpoint rejects ranges greater than 12 months (365 days).
 */
function calculateDateSlices(daysBack: number): DateSlice[] {
  const slices: DateSlice[] = [];
  const now = new Date();

  if (daysBack <= 365) {
    const from = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    slices.push({
      fromDate: from.toISOString().split('T')[0].replace(/-/g, ''),
      toDate: now.toISOString().split('T')[0].replace(/-/g, '')
    });
    return slices;
  }

  let remainingDays = daysBack;
  let currentEnd = now;

  while (remainingDays > 0) {
    const chunkDays = Math.min(365, remainingDays);
    const chunkStart = new Date(currentEnd.getTime() - chunkDays * 24 * 60 * 60 * 1000);

    slices.push({
      fromDate: chunkStart.toISOString().split('T')[0].replace(/-/g, ''),
      toDate: currentEnd.toISOString().split('T')[0].replace(/-/g, '')
    });

    currentEnd = chunkStart;
    remainingDays -= chunkDays;
  }

  return slices;
}

serve(withSystemLogging('sync-bse-docs', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
    const forceInitial = Boolean(payload.forceInitial);

    const { data: allAssets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name, api_code, bse_initial_sync_done')
      .in('asset_type', ['STOCK']);

    if (fetchErr) throw fetchErr;

    let targetAssets = allAssets || [];
    if (payload.symbol) {
      const cleanTarget = String(payload.symbol).replace(/^(NSE:|BSE:)/i, '').replace(/(\.NS|\.BO)$/i, '').toUpperCase();
      targetAssets = targetAssets.filter((a: any) => {
        const clean = a.symbol.replace(/^(NSE:|BSE:)/i, '').replace(/(\.NS|\.BO)$/i, '').toUpperCase();
        return clean === cleanTarget;
      });
    }

    const debugLogs: any[] = [];
    let totalInserted = 0;

    // Process assets in batches of 3 to balance speed and avoid BSE rate limits
    const BATCH_SIZE = 3;

    for (let i = 0; i < targetAssets.length; i += BATCH_SIZE) {
      const batch = targetAssets.slice(i, i + BATCH_SIZE);
      const batchDocs: any[] = [];

      await Promise.all(batch.map(async (asset: any) => {
        const cleanSym = asset.symbol.replace(/^(NSE:|BSE:)/i, '').replace(/(\.NS|\.BO)$/i, '').toUpperCase();

        // BSE Limited is listed only on NSE; skip cleanly
        if (cleanSym === 'BSE') {
          debugLogs.push({ symbol: asset.symbol, status: 'SKIPPED_NSE_ONLY' });
          return;
        }

        let scripCode = asset.api_code || SCRIP_CODE_MAP[cleanSym] || SCRIP_CODE_MAP[asset.symbol.toUpperCase()];

        // If scrip code is not known, resolve it via BSE search
        if (!scripCode) {
          scripCode = await resolveScripCode(cleanSym);
          if (scripCode) {
            // Save resolved scripCode to assets so subsequent runs are instant
            await supabaseAdmin
              .from('assets')
              .update({ api_code: scripCode })
              .eq('asset_id', asset.asset_id);
          }
        }

        if (!scripCode) {
          debugLogs.push({ symbol: asset.symbol, status: 'SCRIP_CODE_NOT_FOUND' });
          return;
        }

        // Determine if initial historical backfill is needed
        const isInitial = forceInitial || !asset.bse_initial_sync_done;

        // Determine days back: default 2 years (730 days) on initial sync, 3 days on daily incremental sync
        let assetDaysBack = 3;
        if (payload.daysBack) {
          assetDaysBack = Number(payload.daysBack);
        } else if (payload.yearsBack) {
          assetDaysBack = Number(payload.yearsBack) * 365;
        } else if (isInitial) {
          assetDaysBack = 730; // 2 years default for initial sync
        } else {
          assetDaysBack = 3;   // 3 days default for daily incremental sync
        }

        const slices = calculateDateSlices(assetDaysBack);
        const maxPagesPerSlice = assetDaysBack <= 7 ? 2 : 3;
        let assetDocsCount = 0;

        for (const slice of slices) {
          let page = 1;

          while (page <= maxPagesPerSlice) {
            const bseUrl = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1&strPrevDate=${slice.fromDate}&strScrip=${scripCode}&strSearch=P&strToDate=${slice.toDate}&strType=C&subcategory=-1`;

            try {
              const response = await fetch(bseUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Referer': 'https://www.bseindia.com/',
                  'Origin': 'https://www.bseindia.com'
                }
              });

              if (!response.ok) break;

              const json = await response.json();
              const announcements = json.Table || [];

              if (announcements.length === 0) break;

              for (const ann of announcements) {
                const attachmentName = (ann.ATTACHMENTNAME || '').trim();
                if (!attachmentName) continue;

                const docType = classifyDocument(ann.NEWSSUB || ann.HEADLINE || '');
                const rawDate = ann.NEWS_DT || ann.DT_TM || ann.News_submission_dt || new Date().toISOString();
                const [annDateStr = '', annTimeStr = ''] = rawDate.includes('T') ? rawDate.split('T') : [rawDate, ''];

                batchDocs.push({
                  attachment_id: attachmentName,
                  asset_id: asset.asset_id,
                  symbol: asset.symbol,
                  scrip_code: scripCode,
                  company: asset.name,
                  announcement_date: annDateStr || null,
                  announcement_time: annTimeStr.split('.')[0] || null,
                  reporting_period: getReportingPeriod(docType, ann.NEWSSUB || ann.HEADLINE || '', rawDate),
                  document_type: docType,
                  title: ann.HEADLINE || ann.NEWSSUB || 'BSE Announcement',
                  original_title: ann.NEWSSUB || ann.HEADLINE || 'BSE Announcement',
                  pdf_url: buildPdfUrl(attachmentName, rawDate),
                  attachment_name: attachmentName,
                  ai_status: 'PENDING'
                });
                assetDocsCount++;
              }

              if (announcements.length < 50) break;
              page++;
            } catch (fetchErr: any) {
              console.warn(`BSE fetch error for ${asset.symbol} page ${page}:`, fetchErr);
              break;
            }
          }
        }

        // Mark initial sync complete and record timestamp
        await supabaseAdmin
          .from('assets')
          .update({
            bse_initial_sync_done: true,
            bse_doc_synced_at: new Date().toISOString()
          })
          .eq('asset_id', asset.asset_id);

        debugLogs.push({
          symbol: asset.symbol,
          scripCode,
          mode: isInitial ? 'INITIAL_BACKFILL' : 'INCREMENTAL',
          slicesChecked: slices.length,
          foundDocs: assetDocsCount
        });
      }));

      // Deduplicate batchDocs by attachment_id before upserting
      const uniqueDocsMap = new Map<string, any>();
      for (const doc of batchDocs) {
        if (!uniqueDocsMap.has(doc.attachment_id)) {
          uniqueDocsMap.set(doc.attachment_id, doc);
        }
      }
      const uniqueDocs = Array.from(uniqueDocsMap.values());

      // Upsert in safe chunks of 100 to avoid PostgREST payload limits
      if (uniqueDocs.length > 0) {
        for (let j = 0; j < uniqueDocs.length; j += 100) {
          const chunk = uniqueDocs.slice(j, j + 100);
          const { error: upsertErr } = await supabaseAdmin
            .from('company_documents')
            .upsert(chunk, { onConflict: 'attachment_id', ignoreDuplicates: true });

          if (!upsertErr) {
            totalInserted += chunk.length;
          } else {
            console.error("Batch upsert error:", upsertErr);
          }
        }
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      insertedCount: totalInserted,
      debugLogs 
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
}));
