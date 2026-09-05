import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import nodemailer from "npm:nodemailer@6.9.13"

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

  let allotmentUrl: string | null = null;
  const allotMatch = nameHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>(?:<span[^>]*>)?Allotted/i)
    || nameHtml.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*title=["']Check Allotment["']/i)
    || nameHtml.match(/<a\s+[^>]*title=["']Check Allotment["'][^>]*href=["']([^"']+)["']/i);
  if (allotMatch && allotMatch[1]) {
    allotmentUrl = allotMatch[1];
  }

  const isAllotted = Boolean(allotmentUrl || nameHtml.includes('Allotted'));

  const cleanNameHtml = nameHtml
    .replace(/<a [^>]*allotment[^>]*>.*?<\/a>/gi, '')
    .replace(/<span [^>]*>Allotted<\/span>/gi, '');

  if (cleanNameHtml.includes('L@')) {
    const match = cleanNameHtml.match(/L@[^<]+/);
    const badgeText = match ? match[0] : 'Listed';
    return { status: 'Listed', statusBadge: badgeText, allotmentUrl };
  }
  if (cleanNameHtml.includes('bg-warning') || cleanNameHtml.includes('>U<')) {
    return { status: 'Upcoming', statusBadge: 'Upcoming', allotmentUrl };
  }

  if (isAllotted || cleanNameHtml.includes('bg-primary') || cleanNameHtml.includes('>C<')) {
    return { status: 'Closed', statusBadge: isAllotted ? 'Allotted' : 'Closed', allotmentUrl };
  }

  if (cleanNameHtml.includes('bg-success') || cleanNameHtml.includes('>O<')) {
    return { status: 'Open', statusBadge: 'Open', allotmentUrl };
  }

  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utcMs + (5.5 * 3600000));
  const todayStr = istDate.toISOString().split('T')[0];

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
  const entityMatches = ratingHtml.match(/&#128293;/g);
  if (entityMatches) return entityMatches.length;
  const emojiMatches = ratingHtml.match(/🔥/g);
  if (emojiMatches) return emojiMatches.length;
  return 0;
}

function parseNumericPrice(priceStr: string): number {
  if (!priceStr) return 0;
  const numbers = priceStr.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length === 0) return 0;
  const lastNum = parseFloat(numbers[numbers.length - 1]);
  return isNaN(lastNum) ? 0 : lastNum;
}

function parseSubscriptionDetails(subItem: any): any {
  if (!subItem) return null;

  const parseField = (val: any) => {
    if (!val || val === '-' || val === '--') return { text: '-', num: 0 };
    const str = String(val).replace(/<[^>]*>/g, '').trim();
    const match = str.match(/([0-9]+(?:\.[0-9]+)?)/);
    return {
      text: match ? `${match[1]}x` : (str || '-'),
      num: match ? parseFloat(match[1]) : 0
    };
  };

  const totalMatch = String(subItem.Total || '').match(/<b>([0-9]+(?:\.[0-9]+)?)<\/b>/i) 
    || String(subItem.Total || '').match(/([0-9]+(?:\.[0-9]+)?)/);
  const totalNum = totalMatch ? parseFloat(totalMatch[1]) : 0;
  const totalText = totalMatch ? `${totalNum}x` : cleanHtml(subItem.Total || '-');

  const qib = parseField(subItem.QIB);
  const nii = parseField(subItem.NII);
  const shni = parseField(subItem.sHNI);
  const bhni = parseField(subItem.bHNI);
  const rii = parseField(subItem.RII);
  const anchorAvailable = Boolean(subItem.Anchor && subItem.Anchor.includes('✅'));

  let updatedAt = '';
  const timeMatch = String(subItem.Total || '').match(/<small[^>]*>.*?<b>([^<]+)<\/b>.*?<\/small>/i)
    || String(subItem.Total || '').match(/<small[^>]*>([^<]+)<\/small>/i);
  if (timeMatch) {
    updatedAt = cleanHtml(timeMatch[1]);
  }

  return {
    total: totalText,
    total_num: totalNum,
    qib: qib.text,
    qib_num: qib.num,
    nii: nii.text,
    nii_num: nii.num,
    shni: shni.text,
    shni_num: shni.num,
    bhni: bhni.text,
    bhni_num: bhni.num,
    rii: rii.text,
    rii_num: rii.num,
    anchor_available: anchorAvailable,
    anchor_status: anchorAvailable ? '✅ Allocated' : (subItem.Anchor && subItem.Anchor.includes('❌') ? '❌ Not Available' : '-'),
    updated_at: updatedAt,
    closing_date: subItem['Closing Date'] || ''
  };
}

// -----------------------------------------------------------------------------
// Alert & Email Helpers
// -----------------------------------------------------------------------------

async function getAlertRecipients(supabaseAdmin: any): Promise<string[]> {
  const recipients = new Set<string>();

  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers();
    if (!error && data?.users) {
      for (const u of data.users) {
        // Opt-in: Default is OFF. Alert only if user explicitly enabled IPO alerts
        const isAlertsEnabled = u.user_metadata?.ipo_alerts_enabled === true;

        if (u.email && u.email_confirmed_at && isAlertsEnabled) {
          recipients.add(u.email.trim().toLowerCase());
        }
      }
    }
  } catch (err) {
    console.warn('Could not query auth.users for alert recipients:', err);
  }

  const fallbackEnv = Deno.env.get('ALERT_RECIPIENT_EMAIL');
  if (fallbackEnv) {
    for (const email of fallbackEnv.split(',')) {
      if (email.trim()) recipients.add(email.trim().toLowerCase());
    }
  }

  return Array.from(recipients);
}

async function sendAlertEmailViaSmtp({
  recipients,
  ipo,
  alertType,
  prevGmp,
  currentGmp
}: {
  recipients: string[];
  ipo: any;
  alertType: 'OPENING_DAY_HIGH_GMP' | 'GMP_DROPPED_BELOW_20' | 'GMP_RISEN_ABOVE_20';
  prevGmp: number;
  currentGmp: number;
}) {
  if (!recipients || recipients.length === 0) {
    return { success: true, subject: '', error: 'No recipients enabled' };
  }

  const smtpHost = Deno.env.get('SMTP_HOST') || 'smtp.gmail.com';
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || 465);
  const smtpUser = Deno.env.get('SMTP_USER') || Deno.env.get('GMAIL_USER') || 'deshmukhparth14@gmail.com';
  const smtpPass = Deno.env.get('SMTP_PASS') || Deno.env.get('GMAIL_APP_PASSWORD');

  if (!smtpPass) {
    console.warn('Gmail SMTP password (SMTP_PASS / GMAIL_APP_PASSWORD) not configured. Skipping email dispatch.');
    return { success: false, subject: '', error: 'SMTP credentials missing' };
  }

  const isSecure = smtpPort === 465;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: isSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  let subject = '';
  let badgeText = '';
  let badgeColor = '';
  let headline = '';
  let summaryText = '';

  const isSme = String(ipo.category || '').toUpperCase().includes('SME');
  const categoryLabel = isSme ? 'SME IPO' : 'Mainboard IPO';

  if (alertType === 'GMP_DROPPED_BELOW_20') {
    subject = `⚠️ FolioX Alert: ${ipo.ipo_name} GMP Dropped Below 20% (${currentGmp.toFixed(1)}%)`;
    badgeText = 'CRITICAL ALERT: GMP DROPPED BELOW 20%';
    badgeColor = '#dc2626';
    headline = `${ipo.ipo_name} GMP has dropped to ${currentGmp.toFixed(1)}%`;
    summaryText = `The Grey Market Premium for <strong>${ipo.ipo_name}</strong> (${categoryLabel}) has dropped below your 20% threshold from a previous <strong>${prevGmp.toFixed(1)}%</strong> to <strong>${currentGmp.toFixed(1)}%</strong> (₹${ipo.gmp_amount}). Please review your application or exit strategy before closing/listing.`;
  } else if (alertType === 'GMP_RISEN_ABOVE_20') {
    subject = `🚀 FolioX Alert: ${ipo.ipo_name} GMP Surged Above 20% (${currentGmp.toFixed(1)}%)`;
    badgeText = 'OPPORTUNITY ALERT: GMP CROSSED 20%';
    badgeColor = '#16a34a';
    headline = `${ipo.ipo_name} GMP surged to ${currentGmp.toFixed(1)}%`;
    summaryText = `The Grey Market Premium for <strong>${ipo.ipo_name}</strong> (${categoryLabel}) has surged back above 20%, currently at <strong>${currentGmp.toFixed(1)}%</strong> (₹${ipo.gmp_amount}). Previous level was ${prevGmp.toFixed(1)}%.`;
  } else {
    subject = `🟢 FolioX Alert: ${ipo.ipo_name} Opens Today with ${currentGmp.toFixed(1)}% GMP`;
    badgeText = 'BIDDING OPENS TODAY (GMP > 20%)';
    badgeColor = '#059669';
    headline = `${ipo.ipo_name} opens today with strong GMP of ${currentGmp.toFixed(1)}%`;
    summaryText = `Bidding opens today for <strong>${ipo.ipo_name}</strong> (${categoryLabel}) with an attractive Grey Market Premium of <strong>${currentGmp.toFixed(1)}%</strong> (₹${ipo.gmp_amount} / share).`;
  }

  const expectedListingPrice = (ipo.price_num || 0) + (ipo.gmp_amount || 0);
  const estProfitPerLot = (ipo.gmp_amount || 0) * (ipo.lot_size || 1);
  const minInvestment = (ipo.price_num || 0) * (ipo.lot_size || 1);

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; padding: 30px 10px;">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #1e293b; border-radius: 16px; overflow: hidden; border: 1px solid #334155; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
                
                <!-- HEADER -->
                <tr>
                  <td style="padding: 24px 28px; background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #38bdf8; text-transform: uppercase;">FOLIOX IPO INTELLIGENCE</span>
                          <h1 style="margin: 6px 0 0 0; font-size: 20px; font-weight: 700; color: #ffffff;">${ipo.ipo_name}</h1>
                        </td>
                        <td align="right">
                          <span style="display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background-color: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">${categoryLabel}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- BADGE & HEADLINE -->
                <tr>
                  <td style="padding: 24px 28px 12px 28px;">
                    <div style="display: inline-block; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff; background-color: ${badgeColor}; margin-bottom: 14px;">
                      ${badgeText}
                    </div>
                    <h2 style="margin: 0 0 10px 0; font-size: 18px; font-weight: 700; color: #ffffff;">${headline}</h2>
                    <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #94a3b8;">${summaryText}</p>
                  </td>
                </tr>

                <!-- METRICS GRID -->
                <tr>
                  <td style="padding: 16px 28px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0f172a; border-radius: 12px; border: 1px solid #334155; padding: 16px;">
                      <tr>
                        <td width="50%" style="padding: 8px; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Current GMP</span>
                          <span style="font-size: 20px; font-weight: 800; color: ${currentGmp >= 20 ? '#10b981' : '#f43f5e'};">₹${ipo.gmp_amount} (${currentGmp.toFixed(1)}%)</span>
                        </td>
                        <td width="50%" style="padding: 8px; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Issue Price</span>
                          <span style="font-size: 20px; font-weight: 800; color: #ffffff;">₹${ipo.price_str || ipo.price_num || '--'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 8px; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Est. Listing Price</span>
                          <span style="font-size: 16px; font-weight: 700; color: #38bdf8;">₹${expectedListingPrice}</span>
                        </td>
                        <td width="50%" style="padding: 8px; border-bottom: 1px solid #1e293b;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Est. Profit (1 Lot)</span>
                          <span style="font-size: 16px; font-weight: 700; color: #10b981;">+₹${estProfitPerLot.toLocaleString('en-IN')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 8px;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Lot Size</span>
                          <span style="font-size: 14px; font-weight: 600; color: #ffffff;">${ipo.lot_size} shares (₹${minInvestment.toLocaleString('en-IN')})</span>
                        </td>
                        <td width="50%" style="padding: 8px;">
                          <span style="font-size: 11px; color: #94a3b8; display: block; text-transform: uppercase; font-weight: 600;">Total Subscription</span>
                          <span style="font-size: 14px; font-weight: 600; color: #f59e0b;">${ipo.subscription || '--'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- TIMELINE -->
                <tr>
                  <td style="padding: 4px 28px 20px 28px;">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #94a3b8;">
                      <tr>
                        <td style="padding: 4px 0;"><strong>Bidding Opens:</strong> ${ipo.open_date || 'TBA'}</td>
                        <td style="padding: 4px 0;"><strong>Bidding Closes:</strong> ${ipo.close_date || 'TBA'}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0;"><strong>Allotment Date:</strong> ${ipo.boa_date || 'TBA'}</td>
                        <td style="padding: 4px 0;"><strong>Listing Date:</strong> ${ipo.listing_date || 'TBA'}</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- ACTION BUTTON -->
                <tr>
                  <td align="center" style="padding: 12px 28px 30px 28px;">
                    <a href="https://folioxweb.github.io/foliox/uat/#/ipo/${ipo.id}" target="_blank" style="display: inline-block; padding: 12px 28px; background-color: #0284c7; color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 700; box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);">
                      View Full Details on FolioX &rarr;
                    </a>
                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="padding: 18px 28px; background-color: #0f172a; border-top: 1px solid #334155; text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                      This real-time notification was dispatched automatically by FolioX IPO Engine based on 20% GMP threshold transitions.<br>
                      &copy; 2026 FolioX Wealth Tracker. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const info = await transporter.sendMail({
    from: `"FolioX IPO Alerts" <${smtpUser}>`,
    to: smtpUser,
    bcc: recipients.length > 0 ? recipients : undefined,
    subject,
    html
  });

  return {
    success: true,
    subject,
    messageId: info.messageId
  };
}

async function logGmpHistoryAndAlerts(supabaseAdmin: any, formattedRecords: any[]) {
  if (!formattedRecords || formattedRecords.length === 0) return;

  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istDate = new Date(utcMs + (5.5 * 3600000));
  const todayStr = istDate.toISOString().split('T')[0];

  const ipoIds = formattedRecords.map(r => r.id);

  // 1. Fetch latest recorded history for each IPO
  let latestHistoryMap = new Map<number, any>();
  try {
    const { data: recentHistory } = await supabaseAdmin
      .from('ipo_gmp_history')
      .select('ipo_id, gmp_amount, gmp_percent, recorded_date, recorded_at')
      .in('ipo_id', ipoIds)
      .order('recorded_at', { ascending: false });

    if (recentHistory) {
      for (const h of recentHistory) {
        if (!latestHistoryMap.has(h.ipo_id)) {
          latestHistoryMap.set(h.ipo_id, h);
        }
      }
    }
  } catch (err: any) {
    console.warn('Could not query ipo_gmp_history:', err.message);
  }

  // 2. Insert new historical snapshots if GMP changed or if no snapshot exists today
  const historyInserts: any[] = [];
  for (const item of formattedRecords) {
    const latest = latestHistoryMap.get(item.id);
    const hasToday = latest && latest.recorded_date === todayStr;
    const gmpChanged = !latest || Number(latest.gmp_amount) !== Number(item.gmp_amount) || Number(latest.gmp_percent) !== Number(item.gmp_percent);

    if (gmpChanged || !hasToday) {
      historyInserts.push({
        ipo_id: item.id,
        ipo_name: item.ipo_name,
        category: item.category || 'IPO',
        price_num: item.price_num || 0,
        gmp_amount: item.gmp_amount || 0,
        gmp_percent: item.gmp_percent || 0,
        gmp_trend: item.gmp_trend || '',
        status: item.status || '',
        subscription: item.subscription || '',
        recorded_date: todayStr,
        recorded_at: new Date().toISOString()
      });
    }
  }

  if (historyInserts.length > 0) {
    try {
      await supabaseAdmin.from('ipo_gmp_history').insert(historyInserts);
    } catch (histErr: any) {
      console.warn('Warning: Could not insert ipo_gmp_history:', histErr.message);
    }
  }

  // 3. Fetch existing alert states for transition detection
  let stateMap = new Map<number, any>();
  try {
    const { data: existingStates } = await supabaseAdmin
      .from('ipo_alert_state')
      .select('*')
      .in('ipo_id', ipoIds);

    if (existingStates) {
      for (const s of existingStates) {
        stateMap.set(s.ipo_id, s);
      }
    }
  } catch (stateReadErr: any) {
    console.warn('Warning: Could not read ipo_alert_state:', stateReadErr.message);
  }

  const recipients = await getAlertRecipients(supabaseAdmin);

  const stateUpserts: any[] = [];
  const alertLogs: any[] = [];
  const emailsToSend: Array<{
    ipo: any;
    alertType: 'OPENING_DAY_HIGH_GMP' | 'GMP_DROPPED_BELOW_20' | 'GMP_RISEN_ABOVE_20';
    prevGmp: number;
    currentGmp: number;
  }> = [];

  for (const item of formattedRecords) {
    const currentGmp = Number(item.gmp_percent || 0);
    const newBand = currentGmp >= 20 ? 'ABOVE_20' : 'BELOW_20';
    const state = stateMap.get(item.id);

    const openDate = item.sort_open;
    const listingDate = item.sort_listing;
    
    // Explicitly exclude listed IPOs from triggering any alerts
    const isListed = String(item.status || '').toLowerCase().includes('listed') || Boolean(listingDate && todayStr >= listingDate);
    if (isListed) {
      continue;
    }

    const isOpeningDay = openDate && todayStr === openDate;
    const isActiveWindow = openDate && todayStr >= openDate && !isListed;

    let triggeredAlertType: 'OPENING_DAY_HIGH_GMP' | 'GMP_DROPPED_BELOW_20' | 'GMP_RISEN_ABOVE_20' | null = null;
    let prevGmpPercent = state ? Number(state.last_gmp_percent || 0) : 0;

    if (!state) {
      if (isOpeningDay && newBand === 'ABOVE_20') {
        triggeredAlertType = 'OPENING_DAY_HIGH_GMP';
      }
      stateUpserts.push({
        ipo_id: item.id,
        ipo_name: item.ipo_name,
        category: item.category || 'IPO',
        last_gmp_percent: currentGmp,
        current_band: newBand,
        last_alert_type: triggeredAlertType,
        last_alerted_at: triggeredAlertType ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      });
    } else {
      const prevBand = state.current_band;

      if (isActiveWindow) {
        if (prevBand === 'ABOVE_20' && newBand === 'BELOW_20') {
          triggeredAlertType = 'GMP_DROPPED_BELOW_20';
        } else if (prevBand === 'BELOW_20' && newBand === 'ABOVE_20') {
          triggeredAlertType = 'GMP_RISEN_ABOVE_20';
        } else if (isOpeningDay && newBand === 'ABOVE_20' && state.last_alert_type !== 'OPENING_DAY_HIGH_GMP') {
          triggeredAlertType = 'OPENING_DAY_HIGH_GMP';
        }
      }

      stateUpserts.push({
        ipo_id: item.id,
        ipo_name: item.ipo_name,
        category: item.category || 'IPO',
        last_gmp_percent: currentGmp,
        current_band: newBand,
        last_alert_type: triggeredAlertType || state.last_alert_type,
        last_alerted_at: triggeredAlertType ? new Date().toISOString() : state.last_alerted_at,
        updated_at: new Date().toISOString()
      });
    }

    if (triggeredAlertType) {
      emailsToSend.push({
        ipo: item,
        alertType: triggeredAlertType,
        prevGmp: prevGmpPercent,
        currentGmp
      });
    }
  }

  if (stateUpserts.length > 0) {
    try {
      await supabaseAdmin
        .from('ipo_alert_state')
        .upsert(stateUpserts, { onConflict: 'ipo_id' });
    } catch (stateWriteErr: any) {
      console.warn('Warning: Could not upsert ipo_alert_state:', stateWriteErr.message);
    }
  }

  for (const alertItem of emailsToSend) {
    if (recipients.length === 0) {
      console.log(`[Alert] ${alertItem.alertType} for ${alertItem.ipo.ipo_name} detected, but no users have enabled IPO email alerts. Skipping dispatch.`);
      alertLogs.push({
        ipo_id: alertItem.ipo.id,
        ipo_name: alertItem.ipo.ipo_name,
        category: alertItem.ipo.category || 'IPO',
        alert_type: alertItem.alertType,
        gmp_percent: alertItem.currentGmp,
        previous_gmp_percent: alertItem.prevGmp,
        recipients: [],
        recipient_count: 0,
        subject: `FolioX IPO Alert: ${alertItem.ipo.ipo_name}`,
        sent_status: 'SKIPPED_NO_RECIPIENTS',
        error_message: 'No users have enabled IPO email alerts',
        created_at: new Date().toISOString()
      });
      continue;
    }

    try {
      const emailResult = await sendAlertEmailViaSmtp({
        recipients,
        ipo: alertItem.ipo,
        alertType: alertItem.alertType,
        prevGmp: alertItem.prevGmp,
        currentGmp: alertItem.currentGmp
      });

      alertLogs.push({
        ipo_id: alertItem.ipo.id,
        ipo_name: alertItem.ipo.ipo_name,
        category: alertItem.ipo.category || 'IPO',
        alert_type: alertItem.alertType,
        gmp_percent: alertItem.currentGmp,
        previous_gmp_percent: alertItem.prevGmp,
        recipients,
        recipient_count: recipients.length,
        subject: emailResult.subject,
        sent_status: emailResult.success ? 'SENT' : 'FAILED',
        error_message: emailResult.error || null,
        created_at: new Date().toISOString()
      });
    } catch (err: any) {
      console.error('Error sending alert email for IPO:', alertItem.ipo.ipo_name, err);
      alertLogs.push({
        ipo_id: alertItem.ipo.id,
        ipo_name: alertItem.ipo.ipo_name,
        category: alertItem.ipo.category || 'IPO',
        alert_type: alertItem.alertType,
        gmp_percent: alertItem.currentGmp,
        previous_gmp_percent: alertItem.prevGmp,
        recipients,
        recipient_count: recipients.length,
        subject: `FolioX IPO Alert: ${alertItem.ipo.ipo_name}`,
        sent_status: 'FAILED',
        error_message: err.message,
        created_at: new Date().toISOString()
      });
    }
  }

  if (alertLogs.length > 0) {
    try {
      await supabaseAdmin.from('ipo_email_alerts').insert(alertLogs);
    } catch (logErr: any) {
      console.warn('Warning: Could not insert ipo_email_alerts:', logErr.message);
    }
  }
}

// -----------------------------------------------------------------------------
// Main Handler
// -----------------------------------------------------------------------------

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

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const fy = month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
    const cacheBuster = Date.now();

    const report331Url = `https://webnodejs.investorgain.com/cloud/v2/report/data-read/331/1/${month}/${year}/${fy}/0/ipo?search=&v=19-18&_t=${cacheBuster}`;
    const report333Url = `https://webnodejs.investorgain.com/cloud/v2/report/data-read/333/1/${month}/${year}/${fy}/0/ipo?search=&v=18-18&_t=${cacheBuster}`;

    const fetchHeaders = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.investorgain.com/'
    };

    const [res331, res333] = await Promise.allSettled([
      fetch(report331Url, { headers: fetchHeaders }),
      fetch(report333Url, { headers: fetchHeaders })
    ]);

    if (res331.status !== 'fulfilled' || !res331.value.ok) {
      throw new Error(`Failed to fetch from InvestorGain Report 331 API`);
    }

    const json331 = await res331.value.json();
    const rawList = json331.reportTableData || [];

    const subMap = new Map<number | string, any>();
    if (res333.status === 'fulfilled' && res333.value.ok) {
      try {
        const json333 = await res333.value.json();
        const rawSubList = json333.reportTableData || [];
        for (const sItem of rawSubList) {
          const sId = sItem['~id'];
          if (sId) {
            subMap.set(String(sId), sItem);
            subMap.set(Number(sId), sItem);
          }
        }
      } catch (subErr) {
        console.warn('Warning: Could not parse Report 333 subscription JSON:', subErr);
      }
    }

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

      const subItem = subMap.get(id);
      const subDetails = subItem ? parseSubscriptionDetails(subItem) : null;
      const finalSubscription = (subDetails && subDetails.total && subDetails.total !== '-')
        ? subDetails.total
        : cleanHtml(item.Sub || '-');

      const anchorAvailable = Boolean(
        (subDetails && subDetails.anchor_available) ||
        (item.Anchor && item.Anchor.includes('✅'))
      );
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
        subscription: finalSubscription,
        subscription_details: subDetails,
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
        raw_json: { ...item, subscription_details: subDetails },
        updated_at: new Date().toISOString()
      });
    }

    let upsertedCount = 0;
    if (formattedRecords.length > 0) {
      let { error: upsertErr, count } = await supabaseAdmin
        .from('mainboard_ipos')
        .upsert(formattedRecords, { onConflict: 'id', count: 'exact' });

      if (upsertErr && (upsertErr.message.includes('subscription_details') || upsertErr.message.includes('allotment_url'))) {
        const cleanedRecords = formattedRecords.map(({ subscription_details, allotment_url, ...rest }) => rest);
        const retryRes = await supabaseAdmin
          .from('mainboard_ipos')
          .upsert(cleanedRecords, { onConflict: 'id', count: 'exact' });
        upsertErr = retryRes.error;
        count = retryRes.count;
      }

      if (upsertErr) throw upsertErr;
      upsertedCount = count ?? formattedRecords.length;

      // Real-time History Logging and Transition Alerts
      try {
        await logGmpHistoryAndAlerts(supabaseAdmin, formattedRecords);
      } catch (alertEngineErr) {
        console.error('Error during logGmpHistoryAndAlerts execution:', alertEngineErr);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      fetched: rawList.length, 
      subscriptionMapped: subMap.size,
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
