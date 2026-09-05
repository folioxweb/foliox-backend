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
  'TATASTEEL': '500470'
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

serve(withSystemLogging('sync-bse-docs', async (req) => {
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
    const daysBack = Number(payload.daysBack || 3); // Default to 3 days (matches GAS daily sync)

    const { data: assets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, name, api_code')
      .in('asset_type', ['STOCK']);

    if (fetchErr) throw fetchErr;

    const newDocs: any[] = [];
    const debugLogs: any[] = [];

    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - daysBack);
    
    const formattedFromDate = fromDate.toISOString().split('T')[0].replace(/-/g, '');
    const formattedToDate = toDate.toISOString().split('T')[0].replace(/-/g, '');

    const maxPages = daysBack <= 7 ? 2 : 5;

    // Process all assets in parallel batches of 5 to avoid BSE rate limits but speed up dramatically
    const BATCH_SIZE = 5;
    let totalInserted = 0;

    for (let i = 0; i < (assets || []).length; i += BATCH_SIZE) {
      const batch = (assets || []).slice(i, i + BATCH_SIZE);
      const batchDocs: any[] = [];
      
      await Promise.all(batch.map(async (asset) => {
        const cleanSym = asset.symbol.replace(/^(NSE:|BSE:)/i, '').replace(/(\.NS|\.BO)$/i, '').toUpperCase();
        let scripCode = asset.api_code || SCRIP_CODE_MAP[cleanSym] || SCRIP_CODE_MAP[asset.symbol.toUpperCase()];

        if (!scripCode) {
          try {
            const sugRes = await fetch(`https://api.bseindia.com/BseIndiaAPI/api/Suggest/w?query=${encodeURIComponent(cleanSym)}`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': 'https://www.bseindia.com/',
                'Origin': 'https://www.bseindia.com'
              }
            });
            if (sugRes.ok) {
              const sugJson = await sugRes.json();
              if (Array.isArray(sugJson) && sugJson.length > 0 && sugJson[0].scrip_cd) {
                scripCode = String(sugJson[0].scrip_cd);
              }
            }
          } catch (sugErr) {
            console.warn(`BSE Suggest search failed for ${cleanSym}:`, sugErr);
          }
        }

        if (!scripCode) {
          debugLogs.push({ symbol: asset.symbol, status: 'scripCode not found' });
          return;
        }

        // Update scripCode in assets table if not previously set
        if (!asset.api_code) {
          await supabaseAdmin
            .from('assets')
            .update({ api_code: scripCode })
            .eq('asset_id', asset.asset_id);
        }

        let page = 1;
        let assetDocsCount = 0;

        while (page <= maxPages) {
          const bseUrl = `https://api.bseindia.com/BseIndiaAPI/api/AnnSubCategoryGetData/w?pageno=${page}&strCat=-1&strPrevDate=${formattedFromDate}&strScrip=${scripCode}&strSearch=P&strToDate=${formattedToDate}&strType=C&subcategory=-1`;
          
          try {
            const response = await fetch(bseUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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
            console.warn(`BSE fetch page ${page} error:`, fetchErr);
            break;
          }
        }

        debugLogs.push({ symbol: asset.symbol, scripCode, foundDocs: assetDocsCount });
      }));

      // Immediately upsert batch into Supabase so progress is saved even if connection drops
      if (batchDocs.length > 0) {
        const { error: upsertErr } = await supabaseAdmin
          .from('company_documents')
          .upsert(batchDocs, { onConflict: 'attachment_id', ignoreDuplicates: true });
        
        if (!upsertErr) {
          totalInserted += batchDocs.length;
        } else {
          console.error("Batch upsert error:", upsertErr);
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
}))
