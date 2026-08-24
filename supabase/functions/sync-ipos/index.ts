import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function cleanHtml(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#8377;/g, '₹')
    .replace(/<[^>]*>/g, '')
    .trim();
}

function cleanDate(raw: string): string {
  if (!raw) return '';
  const firstPart = String(raw).split(/<br\s*\/?>|<small/i)[0];
  return cleanHtml(firstPart);
}

function parseStatus(
  nameHtml: string,
  srtOpen?: string | null,
  srtClose?: string | null,
  srtListing?: string | null
): { status: string; statusBadge: string; allotmentUrl: string | null } {
  if (!nameHtml) nameHtml = '';

  // Extract allotment registrar URL if present in Name HTML
  let allotmentUrl: string | null = null;
  const allotMatch = nameHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:<span[^>]*>)?Allotted/i)
    || nameHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*title=["']Check Allotment["']/i)
    || nameHtml.match(/<a\s+[^>]*title=["']Check Allotment["'][^>]*href=["']([^"']+)["']/i);
  if (allotMatch && allotMatch[1]) {
    allotmentUrl = allotMatch[1];
  }

  const isAllotted = Boolean(allotmentUrl || nameHtml.includes('Allotted'));

  // Clean out allotment links so bg-success inside "Allotted" links does not cause false positives
  const cleanNameHtml = nameHtml
    .replace(/<a [^>]*allotment[^>]*>.*?<\/a>/gi, '')
    .replace(/<span [^>]*>Allotted<\/span>/gi, '');

  // 1. Explicit HTML badges from InvestorGain
  if (cleanNameHtml.includes('L@')) {
    const match = cleanNameHtml.match(/L@[^<]+/);
    const badgeText = match ? match[0] : 'Listed';
    return { status: 'Listed', statusBadge: badgeText, allotmentUrl };
  }
  if (cleanNameHtml.includes('bg-warning') || cleanNameHtml.includes('>U<')) {
    return { status: 'Upcoming', statusBadge: 'Upcoming', allotmentUrl };
  }

  // Allotted IPOs MUST be categorized as Closed!
  if (isAllotted || cleanNameHtml.includes('bg-primary') || cleanNameHtml.includes('>C<')) {
    return { status: 'Closed', statusBadge: isAllotted ? 'Allotted' : 'Closed', allotmentUrl };
  }

  if (cleanNameHtml.includes('bg-success') || cleanNameHtml.includes('>O<')) {
    return { status: 'Open', statusBadge: 'Open', allotmentUrl };
  }

  // 2. Accurate date-based status computation (IST Date)
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utcMs + (5.5 * 3600000));
  const todayStr = istDate.toISOString().split('T')[0]; // YYYY-MM-DD in IST

  const openStr = srtOpen ? String(srtOpen).trim() : null;
  const closeStr = srtClose ? String(srtClose).trim() : null;
  const listingStr = srtListing ? String(srtListing).trim() : null;

  if (listingStr && todayStr >= listingStr) {
    return { status: 'Listed', statusBadge: 'Listed', allotmentUrl };
  }
  if (closeStr && todayStr > closeStr) {
    return { status: 'Closed', statusBadge: isAllotted ? 'Allotted' : 'Closed', allotmentUrl };
  }
  if (openStr && closeStr && todayStr >= openStr && todayStr <= closeStr) {
    if (isAllotted) return { status: 'Closed', statusBadge: 'Allotted', allotmentUrl };
    return { status: 'Open', statusBadge: 'Open', allotmentUrl };
  }
  if (openStr && todayStr < openStr) {
    return { status: 'Upcoming', statusBadge: 'Upcoming', allotmentUrl };
  }

  if (openStr && todayStr >= openStr) {
    if (isAllotted) return { status: 'Closed', statusBadge: 'Allotted', allotmentUrl };
    return { status: 'Open', statusBadge: 'Open', allotmentUrl };
  }

  return {
    status: isAllotted ? 'Closed' : 'Upcoming',
    statusBadge: isAllotted ? 'Allotted' : 'Upcoming',
    allotmentUrl
  };
}

function parseGmp(gmpHtml: string, calcPercent?: string): { gmpAmount: number; gmpPercent: number; gmpTrend: string } {
  if (!gmpHtml) return { gmpAmount: 0, gmpPercent: 0, gmpTrend: '' };

  let gmpAmount = 0;
  // Match value inside <b> tag after ₹/&#8377;
  const valMatch = gmpHtml.match(/(?:&#8377;|₹)\s*<b>([^<]+)<\/b>/i);
  if (valMatch && valMatch[1]) {
    const parsed = parseFloat(valMatch[1].replace(/,/g, ''));
    if (!isNaN(parsed)) gmpAmount = parsed;
  }

  let gmpPercent = 0;
  if (calcPercent) {
    const p = parseFloat(calcPercent);
    if (!isNaN(p)) gmpPercent = p;
  } else {
    const pctMatch = gmpHtml.match(/\(([0-9.]+)%\)/);
    if (pctMatch && pctMatch[1]) {
      const p = parseFloat(pctMatch[1]);
      if (!isNaN(p)) gmpPercent = p;
    }
  }

  let gmpTrend = '';
  const trendMatch = gmpHtml.match(/<b>([^<]+(?:↓|↑)[^<]*)<\/b>/i);
  if (trendMatch && trendMatch[1]) {
    gmpTrend = trendMatch[1].trim();
  }

  return { gmpAmount, gmpPercent, gmpTrend };
}

function parseRatingFlames(ratingHtml: string): number {
  if (!ratingHtml) return 0;
  // Count &#128293; entities or 🔥 emojis
  const entityMatches = ratingHtml.match(/&#128293;/g);
  if (entityMatches) return entityMatches.length;
  const emojiMatches = ratingHtml.match(/🔥/g);
  if (emojiMatches) return emojiMatches.length;
  return 0;
}

function parseNumericPrice(priceStr: string): number {
  if (!priceStr) return 0;
  // Extract max/upper price from range e.g. "100-105" -> 105 or "53" -> 53
  const numbers = priceStr.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return 0;
  const lastNum = parseFloat(numbers[numbers.length - 1]);
  return isNaN(lastNum) ? 0 : lastNum;
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

    const cacheBuster = Date.now();
    const apiUrl = `https://webnodejs.investorgain.com/cloud/v2/report/data-read/331/1/8/2026/2026-27/0/ipo?search=&v=19-18&_t=${cacheBuster}`;
    const response = await fetch(apiUrl, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.investorgain.com/'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch from InvestorGain API: ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const rawList = json.reportTableData || [];

    const formattedRecords: any[] = [];

    for (const item of rawList) {
      const id = item['~id'];
      if (!id) continue;

      const ipoName = item['~ipo_name'] || cleanHtml(item.Name) || 'Unnamed IPO';
      const category = item['~IPO_Category'] || 'IPO';
      const { status, statusBadge, allotmentUrl } = parseStatus(
        item.Name || '',
        item['~Srt_Open'],
        item['~Srt_Close'],
        item['~Str_Listing']
      );
      const { gmpAmount, gmpPercent, gmpTrend } = parseGmp(item.GMP || '', item['~gmp_percent_calc']);
      const ratingFlames = parseRatingFlames(item.Rating || '');
      
      const priceStr = item['Price (₹)'] ? String(item['Price (₹)']).trim() : '';
      const priceNum = parseNumericPrice(priceStr);
      const lotSize = item.Lot ? parseInt(String(item.Lot).replace(/\D/g, ''), 10) || 1 : 1;

      const anchorAvailable = Boolean(item.Anchor && item.Anchor.includes('✅'));
      const investorgainUrl = item['~urlrewrite_folder_name'] 
        ? `https://www.investorgain.com${item['~urlrewrite_folder_name']}`
        : null;

      formattedRecords.push({
        id,
        ipo_name: ipoName,
        category,
        status,
        status_badge: statusBadge,
        gmp_amount: gmpAmount,
        gmp_percent: gmpPercent,
        gmp_trend: gmpTrend,
        rating_flames: ratingFlames,
        price_str: priceStr,
        price_num: priceNum,
        ipo_size: cleanHtml(item['IPO Size'] || ''),
        lot_size: lotSize,
        pe_ratio: item['~P/E'] ? String(item['~P/E']).trim() : '--',
        subscription: cleanHtml(item.Sub || '-'),
        open_date: cleanDate(item.Open || ''),
        close_date: cleanDate(item.Close || ''),
        boa_date: cleanDate(item['BoA Dt'] || ''),
        listing_date: cleanDate(item.Listing || ''),
        sort_open: item['~Srt_Open'] || null,
        sort_close: item['~Srt_Close'] || null,
        sort_boa: item['~Srt_BoA_Dt'] || null,
        sort_listing: item['~Str_Listing'] || null,
        updated_on_text: cleanHtml(item['Updated-On'] || ''),
        anchor_available: anchorAvailable,
        investorgain_url: investorgainUrl,
        allotment_url: allotmentUrl,
        highlight_row: item['~Highlight_Row'] || '',
        raw_json: item,
        updated_at: new Date().toISOString()
      });
    }

    let upsertedCount = 0;
    if (formattedRecords.length > 0) {
      let { error: upsertErr, count } = await supabaseAdmin
        .from('mainboard_ipos')
        .upsert(formattedRecords, { onConflict: 'id', count: 'exact' });

      if (upsertErr && upsertErr.message.includes('allotment_url')) {
        const cleanedRecords = formattedRecords.map(({ allotment_url, ...rest }) => rest);
        const retryRes = await supabaseAdmin
          .from('mainboard_ipos')
          .upsert(cleanedRecords, { onConflict: 'id', count: 'exact' });
        upsertErr = retryRes.error;
        count = retryRes.count;
      }

      if (upsertErr) throw upsertErr;
      upsertedCount = count ?? formattedRecords.length;
    }

    return new Response(JSON.stringify({ 
      success: true, 
      fetched: rawList.length, 
      upserted: upsertedCount 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error syncing IPOs:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
