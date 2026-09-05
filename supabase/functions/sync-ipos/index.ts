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
  const smtpUser = Deno.env.get('SMTP_USER') || Deno.env.get('GMAIL_USER') || 'foliox.in@gmail.com';
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
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light dark">
        <meta name="supported-color-schemes" content="light dark">
        <title>${subject}</title>
        <style>
          :root {
            color-scheme: light dark;
            supported-color-schemes: light dark;
          }
          @media only screen and (max-width: 600px) {
            .email-card { width: 100% !important; border-radius: 10px !important; }
            .content-padding { padding: 18px 18px !important; }
          }
          @media (prefers-color-scheme: dark) {
            body, .email-bg { background-color: #0b0f19 !important; }
            .email-card { background-color: #151d2f !important; border-color: #243247 !important; }
            .email-header { background-color: #151d2f !important; border-color: #243247 !important; }
            .email-title { color: #f8fafc !important; }
            .email-badge-pill { background-color: #1e293b !important; border-color: #334155 !important; color: #94a3b8 !important; }
            .email-headline { color: #f8fafc !important; }
            .email-desc { color: #cbd5e1 !important; }
            .email-metric-card { background-color: #0f172a !important; border-color: #243247 !important; }
            .email-metric-label { color: #94a3b8 !important; }
            .email-metric-val { color: #f8fafc !important; }
            .email-timeline { color: #94a3b8 !important; }
            .email-timeline strong { color: #e2e8f0 !important; }
            .email-footer { background-color: #0f172a !important; border-color: #243247 !important; color: #64748b !important; }
          }
        </style>
      </head>
      <body class="email-bg" style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 10px;" class="email-bg">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);" class="email-card">
                
                <!-- TOP COLOR ACCENT BAR -->
                <tr>
                  <td style="height: 4px; background-color: ${badgeColor}; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>

                <!-- HEADER -->
                <tr>
                  <td style="padding: 22px 26px 16px 26px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;" class="email-header">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: #0284c7; text-transform: uppercase;">FOLIOX IPO INTELLIGENCE</span>
                          <h1 class="email-title" style="margin: 4px 0 0 0; font-size: 22px; font-weight: 800; color: #0f172a;">${ipo.ipo_name}</h1>
                        </td>
                        <td align="right" valign="top">
                          <span class="email-badge-pill" style="display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;">${categoryLabel}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- BADGE & HEADLINE -->
                <tr>
                  <td style="padding: 22px 26px 12px 26px;" class="content-padding">
                    <div style="display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff; background-color: ${badgeColor}; margin-bottom: 12px;">
                      ${badgeText}
                    </div>
                    <h2 class="email-headline" style="margin: 0 0 8px 0; font-size: 17px; font-weight: 700; color: #0f172a;">${headline}</h2>
                    <p class="email-desc" style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">${summaryText}</p>
                  </td>
                </tr>

                <!-- METRICS GRID -->
                <tr>
                  <td style="padding: 10px 26px 16px 26px;" class="content-padding">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; padding: 14px;" class="email-metric-card">
                      <tr>
                        <td width="50%" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Current GMP</span>
                          <span style="font-size: 19px; font-weight: 800; color: ${currentGmp >= 20 ? '#059669' : '#dc2626'};">₹${ipo.gmp_amount} (${currentGmp.toFixed(1)}%)</span>
                        </td>
                        <td width="50%" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Issue Price</span>
                          <span class="email-metric-val" style="font-size: 19px; font-weight: 800; color: #0f172a;">₹${ipo.price_str || ipo.price_num || '--'}</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Est. Listing Price</span>
                          <span style="font-size: 15px; font-weight: 700; color: #0284c7;">₹${expectedListingPrice}</span>
                        </td>
                        <td width="50%" style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Est. Profit (1 Lot)</span>
                          <span style="font-size: 15px; font-weight: 700; color: #059669;">+₹${estProfitPerLot.toLocaleString('en-IN')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td width="50%" style="padding: 8px 10px;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Lot Size</span>
                          <span class="email-metric-val" style="font-size: 13px; font-weight: 600; color: #0f172a;">${ipo.lot_size} shares (₹${minInvestment.toLocaleString('en-IN')})</span>
                        </td>
                        <td width="50%" style="padding: 8px 10px;">
                          <span class="email-metric-label" style="font-size: 11px; color: #64748b; display: block; text-transform: uppercase; font-weight: 600;">Total Subscription</span>
                          <span style="font-size: 13px; font-weight: 600; color: #d97706;">${ipo.subscription || '--'}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- TIMELINE -->
                <tr>
                  <td style="padding: 4px 26px 22px 26px;" class="content-padding">
                    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #64748b;" class="email-timeline">
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

                <!-- FOOTER -->
                <tr>
                  <td style="padding: 16px 26px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;" class="email-footer">
                    <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
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

async function sendBulkDigestEmailViaSmtp({
  recipients,
  digestType,
  ipos
}: {
  recipients: string[];
  digestType: 'OPENING' | 'CLOSING';
  ipos: Array<{
    ipo: any;
    currentGmp: number;
    estProfit: number;
    expectedListingPrice: number;
    minInvestment: number;
  }>;
}) {
  if (!recipients || recipients.length === 0 || !ipos || ipos.length === 0) {
    return { success: true, subject: '', error: 'No recipients or no IPOs' };
  }

  const smtpHost = Deno.env.get('SMTP_HOST') || 'smtp.gmail.com';
  const smtpPort = Number(Deno.env.get('SMTP_PORT') || 465);
  const smtpUser = Deno.env.get('SMTP_USER') || Deno.env.get('GMAIL_USER') || 'foliox.in@gmail.com';
  const smtpPass = Deno.env.get('SMTP_PASS') || Deno.env.get('GMAIL_APP_PASSWORD');

  if (!smtpPass) {
    console.warn(`Gmail SMTP password not configured. Skipping ${digestType} digest dispatch.`);
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

  const count = ipos.length;
  const isOpening = digestType === 'OPENING';

  const themeColor = isOpening ? '#059669' : '#d97706';
  const emoji = isOpening ? '🟢' : '⏰';
  const verb = isOpening ? 'Opening' : 'Closing';
  const verbPresent = isOpening ? 'Opens' : 'Closes';

  const subject = count === 1
    ? `${emoji} FolioX Alert: ${ipos[0].ipo.ipo_name} ${verbPresent} Today (${ipos[0].currentGmp.toFixed(1)}% GMP)`
    : `${emoji} FolioX Alert: ${count} IPOs ${verb} Today with >20% GMP`;

  const digestTitle = isOpening ? 'Opening Day Digest' : 'Closing Day Digest';
  const badgeText = isOpening
    ? 'BIDDING OPENS TODAY (10:00 AM)'
    : 'FINAL BIDDING DAY — CLOSING TODAY (5:00 PM)';

  const headline = count === 1
    ? `${ipos[0].ipo.ipo_name} ${verbPresent.toLowerCase()} today with strong GMP of ${ipos[0].currentGmp.toFixed(1)}%`
    : `${count} IPOs with attractive GMP (>20%) are ${verb.toLowerCase()} today`;

  const summaryText = isOpening
    ? `Bidding opens today at 10:00 AM IST. Review the Grey Market Premiums below before submitting your applications:`
    : `Today is the final day to submit bids before applications close at 5:00 PM IST. Review the Grey Market Premiums below before making your final application decision:`;

  const ipoCardsHtml = ipos.map((item, idx) => {
    const isSme = String(item.ipo.category || '').toUpperCase().includes('SME');
    const categoryLabel = isSme ? 'SME IPO' : 'Mainboard IPO';
    const isLast = idx === count - 1;

    const timelineText = isOpening
      ? `<strong>Bidding:</strong> Today to ${item.ipo.close_date || 'TBA'} &bull; <strong>Allotment:</strong> ${item.ipo.boa_date || 'TBA'} &bull; <strong>Listing:</strong> ${item.ipo.listing_date || 'TBA'}`
      : `<strong>Bidding Closes:</strong> Today (5:00 PM IST) &bull; <strong>Allotment:</strong> ${item.ipo.boa_date || 'TBA'} &bull; <strong>Listing:</strong> ${item.ipo.listing_date || 'TBA'}`;

    return `
      <!-- IPO CARD #${idx + 1}: ${item.ipo.ipo_name} -->
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: ${isLast ? '0' : '18px'}; overflow: hidden;" class="email-card">
        <!-- COMPANY HEADER -->
        <tr>
          <td style="padding: 16px 20px 12px 20px; border-bottom: 1px solid #f1f5f9;" class="email-header">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td>
                  <h3 class="email-title" style="margin: 0; font-size: 17px; font-weight: 800; color: #0f172a;">${item.ipo.ipo_name}</h3>
                </td>
                <td align="right" valign="middle">
                  <span class="email-badge-pill" style="display: inline-block; padding: 3px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background-color: #f1f5f9; color: #475569; border: 1px solid #e2e8f0;">${categoryLabel}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- HERO GMP HIGHLIGHT (MOST IMPORTANT DETAIL) -->
        <tr>
          <td style="padding: 14px 20px 10px 20px;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ecfdf5; border-radius: 10px; border: 1px solid #a7f3d0; padding: 12px 14px;" class="email-gmp-hero">
              <tr>
                <td width="55%">
                  <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.8px; color: #047857; text-transform: uppercase; display: block;">CURRENT GMP (KEY METRIC)</span>
                  <span style="font-size: 22px; font-weight: 900; color: #059669; line-height: 1.2;">₹${item.ipo.gmp_amount} (${item.currentGmp.toFixed(1)}%)</span>
                </td>
                <td width="45%" align="right">
                  <span style="font-size: 10px; font-weight: 700; letter-spacing: 0.5px; color: #047857; text-transform: uppercase; display: block;">EST. PROFIT (1 LOT)</span>
                  <span style="font-size: 17px; font-weight: 800; color: #059669; line-height: 1.2;">+₹${item.estProfit.toLocaleString('en-IN')}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- SECONDARY DETAILS GRID -->
        <tr>
          <td style="padding: 4px 20px 16px 20px;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 12px; color: #64748b; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0; padding: 10px 12px;" class="email-metric-card">
              <tr>
                <td width="50%" style="padding: 4px 6px;">
                  <span class="email-metric-label" style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 600; color: #64748b;">Issue Price</span>
                  <span class="email-metric-val" style="font-size: 13px; font-weight: 700; color: #0f172a;">₹${item.ipo.price_str || item.ipo.price_num || '--'}</span>
                </td>
                <td width="50%" style="padding: 4px 6px;">
                  <span class="email-metric-label" style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 600; color: #64748b;">Est. Listing Price</span>
                  <span style="font-size: 13px; font-weight: 700; color: #0284c7;">₹${item.expectedListingPrice}</span>
                </td>
              </tr>
              <tr>
                <td width="50%" style="padding: 4px 6px;">
                  <span class="email-metric-label" style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 600; color: #64748b;">Lot Size</span>
                  <span class="email-metric-val" style="font-size: 12px; font-weight: 600; color: #0f172a;">${item.ipo.lot_size} shares (₹${item.minInvestment.toLocaleString('en-IN')})</span>
                </td>
                <td width="50%" style="padding: 4px 6px;">
                  <span class="email-metric-label" style="display: block; font-size: 10px; text-transform: uppercase; font-weight: 600; color: #64748b;">Total Subscription</span>
                  <span style="font-size: 12px; font-weight: 700; color: #d97706;">${item.ipo.subscription || '--'}</span>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding: 6px 6px 2px 6px; border-top: 1px solid #e2e8f0; margin-top: 4px; font-size: 11px; color: #64748b;" class="email-timeline">
                  ${timelineText}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light dark">
        <meta name="supported-color-schemes" content="light dark">
        <title>${subject}</title>
        <style>
          :root {
            color-scheme: light dark;
            supported-color-schemes: light dark;
          }
          @media only screen and (max-width: 600px) {
            .email-card { width: 100% !important; border-radius: 10px !important; }
            .content-padding { padding: 18px 16px !important; }
          }
          @media (prefers-color-scheme: dark) {
            body, .email-bg { background-color: #0b0f19 !important; }
            .email-card { background-color: #151d2f !important; border-color: #243247 !important; }
            .email-header { background-color: #151d2f !important; border-color: #243247 !important; }
            .email-title { color: #f8fafc !important; }
            .email-badge-pill { background-color: #1e293b !important; border-color: #334155 !important; color: #94a3b8 !important; }
            .email-headline { color: #f8fafc !important; }
            .email-desc { color: #cbd5e1 !important; }
            .email-gmp-hero { background-color: #064e3b !important; border-color: #059669 !important; }
            .email-metric-card { background-color: #0f172a !important; border-color: #243247 !important; }
            .email-metric-label { color: #94a3b8 !important; }
            .email-metric-val { color: #f8fafc !important; }
            .email-timeline { color: #94a3b8 !important; border-color: #243247 !important; }
            .email-timeline strong { color: #e2e8f0 !important; }
            .email-footer { background-color: #0f172a !important; border-color: #243247 !important; color: #64748b !important; }
          }
        </style>
      </head>
      <body class="email-bg" style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #0f172a;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 24px 10px;" class="email-bg">
          <tr>
            <td align="center">
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(15, 23, 42, 0.06);" class="email-card">
                
                <!-- TOP COLOR ACCENT BAR -->
                <tr>
                  <td style="height: 4px; background-color: ${themeColor}; font-size: 0; line-height: 0;">&nbsp;</td>
                </tr>

                <!-- MAIN DIGEST HEADER -->
                <tr>
                  <td style="padding: 22px 26px 14px 26px; background-color: #ffffff; border-bottom: 1px solid #f1f5f9;" class="email-header">
                    <span style="font-size: 11px; font-weight: 800; letter-spacing: 1.5px; color: ${themeColor}; text-transform: uppercase;">FOLIOX IPO INTELLIGENCE</span>
                    <h1 class="email-title" style="margin: 4px 0 0 0; font-size: 22px; font-weight: 800; color: #0f172a;">${digestTitle}</h1>
                  </td>
                </tr>

                <!-- BADGE & HEADLINE -->
                <tr>
                  <td style="padding: 20px 26px 16px 26px;" class="content-padding">
                    <div style="display: inline-block; padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px; color: #ffffff; background-color: ${themeColor}; margin-bottom: 12px;">
                      ${badgeText}
                    </div>
                    <h2 class="email-headline" style="margin: 0 0 8px 0; font-size: 17px; font-weight: 700; color: #0f172a;">${headline}</h2>
                    <p class="email-desc" style="margin: 0; font-size: 14px; line-height: 1.6; color: #475569;">${summaryText}</p>
                  </td>
                </tr>

                <!-- BULK LIST OF IPOS -->
                <tr>
                  <td style="padding: 4px 26px 20px 26px;" class="content-padding">
                    ${ipoCardsHtml}
                  </td>
                </tr>

                <!-- FOOTER -->
                <tr>
                  <td style="padding: 16px 26px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;" class="email-footer">
                    <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
                      This morning ${verb.toLowerCase()} digest was dispatched automatically by FolioX IPO Engine for active IPOs with &gt;20% GMP ${verb.toLowerCase()} today.<br>
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

function sendOpeningDayDigestEmailViaSmtp(params: {
  recipients: string[];
  openingIpos: Array<{
    ipo: any;
    currentGmp: number;
    estProfit: number;
    expectedListingPrice: number;
    minInvestment: number;
  }>;
}) {
  return sendBulkDigestEmailViaSmtp({
    recipients: params.recipients,
    digestType: 'OPENING',
    ipos: params.openingIpos
  });
}

function sendClosingDayDigestEmailViaSmtp(params: {
  recipients: string[];
  closingIpos: Array<{
    ipo: any;
    currentGmp: number;
    estProfit: number;
    expectedListingPrice: number;
    minInvestment: number;
  }>;
}) {
  return sendBulkDigestEmailViaSmtp({
    recipients: params.recipients,
    digestType: 'CLOSING',
    ipos: params.closingIpos
  });
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

    let triggeredAlertType: 'GMP_DROPPED_BELOW_20' | 'GMP_RISEN_ABOVE_20' | null = null;
    let prevGmpPercent = state ? Number(state.last_gmp_percent || 0) : 0;

    if (!state) {
      stateUpserts.push({
        ipo_id: item.id,
        ipo_name: item.ipo_name,
        category: item.category || 'IPO',
        last_gmp_percent: currentGmp,
        current_band: newBand,
        last_alert_type: null,
        last_alerted_at: null,
        updated_at: new Date().toISOString()
      });
    } else {
      const prevBand = state.current_band;

      if (isActiveWindow) {
        if (prevBand === 'ABOVE_20' && newBand === 'BELOW_20') {
          triggeredAlertType = 'GMP_DROPPED_BELOW_20';
        } else if (prevBand === 'BELOW_20' && newBand === 'ABOVE_20') {
          triggeredAlertType = 'GMP_RISEN_ABOVE_20';
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

  // ── Morning Bulk Alerts (08:00 AM - 11:59 AM IST) ──
  const istHour = istDate.getHours();
  const isMorningWindow = istHour >= 8 && istHour < 12;

  if (isMorningWindow) {
    // ── 1. Opening Day Morning Bulk Alert ──
    let openingDigestSentToday = false;
    try {
      const { data: sentOpeningToday } = await supabaseAdmin
        .from('ipo_email_alerts')
        .select('id')
        .eq('alert_type', 'OPENING_DAY_DIGEST')
        .gte('created_at', `${todayStr}T00:00:00Z`)
        .limit(1);

      if (sentOpeningToday && sentOpeningToday.length > 0) {
        openingDigestSentToday = true;
      }
    } catch (chkErr: any) {
      console.warn('Warning: Could not check today opening digest:', chkErr.message);
    }

    if (!openingDigestSentToday) {
      const openingEligible = formattedRecords
        .filter(item => {
          const openDate = item.sort_open;
          const listingDate = item.sort_listing;
          const isListed = String(item.status || '').toLowerCase().includes('listed') || Boolean(listingDate && todayStr >= listingDate);
          const gmpPercent = Number(item.gmp_percent || 0);
          return openDate && todayStr === openDate && !isListed && gmpPercent >= 20;
        })
        .map(item => {
          const currentGmp = Number(item.gmp_percent || 0);
          const gmpAmount = Number(item.gmp_amount || 0);
          const lotSize = Number(item.lot_size || 1);
          const priceNum = Number(item.price_num || 0);
          return {
            ipo: item,
            currentGmp,
            estProfit: gmpAmount * lotSize,
            expectedListingPrice: priceNum + gmpAmount,
            minInvestment: priceNum * lotSize
          };
        })
        .sort((a, b) => b.currentGmp - a.currentGmp);

      if (openingEligible.length > 0) {
        if (recipients.length === 0) {
          console.log(`[Alert] OPENING_DAY_DIGEST detected for ${openingEligible.length} IPOs, but no users enabled alerts.`);
          alertLogs.push({
            ipo_id: openingEligible[0].ipo.id,
            ipo_name: openingEligible.map(c => c.ipo.ipo_name).join(', '),
            category: openingEligible.length > 1 ? 'MULTI' : openingEligible[0].ipo.category || 'IPO',
            alert_type: 'OPENING_DAY_DIGEST',
            gmp_percent: openingEligible[0].currentGmp,
            previous_gmp_percent: null,
            recipients: [],
            recipient_count: 0,
            subject: `FolioX Alert: ${openingEligible.length} IPOs Opening Today with >20% GMP`,
            sent_status: 'SKIPPED_NO_RECIPIENTS',
            error_message: 'No users have enabled IPO email alerts',
            created_at: new Date().toISOString()
          });
        } else {
          try {
            const emailResult = await sendOpeningDayDigestEmailViaSmtp({
              recipients,
              openingIpos: openingEligible
            });

            alertLogs.push({
              ipo_id: openingEligible[0].ipo.id,
              ipo_name: openingEligible.map(c => c.ipo.ipo_name).join(', '),
              category: openingEligible.length > 1 ? 'MULTI' : openingEligible[0].ipo.category || 'IPO',
              alert_type: 'OPENING_DAY_DIGEST',
              gmp_percent: openingEligible[0].currentGmp,
              previous_gmp_percent: null,
              recipients,
              recipient_count: recipients.length,
              subject: emailResult.subject,
              sent_status: emailResult.success ? 'SENT' : 'FAILED',
              error_message: emailResult.error || null,
              created_at: new Date().toISOString()
            });
          } catch (err: any) {
            console.error('Error sending opening day digest email:', err);
            alertLogs.push({
              ipo_id: openingEligible[0].ipo.id,
              ipo_name: openingEligible.map(c => c.ipo.ipo_name).join(', '),
              category: openingEligible.length > 1 ? 'MULTI' : openingEligible[0].ipo.category || 'IPO',
              alert_type: 'OPENING_DAY_DIGEST',
              gmp_percent: openingEligible[0].currentGmp,
              previous_gmp_percent: null,
              recipients,
              recipient_count: recipients.length,
              subject: `FolioX Alert: ${openingEligible.length} IPOs Opening Today with >20% GMP`,
              sent_status: 'FAILED',
              error_message: err.message,
              created_at: new Date().toISOString()
            });
          }
        }
      }
    }

    // ── 2. Closing Day Morning Bulk Alert ──
    // NOTE: Closing day strictly refers to bidding close date (item.sort_close), NOT listing date.
    let closingDigestSentToday = false;
    try {
      const { data: sentToday } = await supabaseAdmin
        .from('ipo_email_alerts')
        .select('id')
        .eq('alert_type', 'CLOSING_DAY_DIGEST')
        .gte('created_at', `${todayStr}T00:00:00Z`)
        .limit(1);

      if (sentToday && sentToday.length > 0) {
        closingDigestSentToday = true;
      }
    } catch (chkErr: any) {
      console.warn('Warning: Could not check today closing digest:', chkErr.message);
    }

    if (!closingDigestSentToday) {
      const closingEligible = formattedRecords
        .filter(item => {
          const closeDate = item.sort_close;
          const listingDate = item.sort_listing;
          // Exclude already listed IPOs or listing today
          const isListed = String(item.status || '').toLowerCase().includes('listed') || Boolean(listingDate && todayStr >= listingDate);
          const gmpPercent = Number(item.gmp_percent || 0);
          // STRICT: Targets bidding close date (sort_close) only.
          return closeDate && todayStr === closeDate && !isListed && gmpPercent >= 20;
        })
        .map(item => {
          const currentGmp = Number(item.gmp_percent || 0);
          const gmpAmount = Number(item.gmp_amount || 0);
          const lotSize = Number(item.lot_size || 1);
          const priceNum = Number(item.price_num || 0);
          return {
            ipo: item,
            currentGmp,
            estProfit: gmpAmount * lotSize,
            expectedListingPrice: priceNum + gmpAmount,
            minInvestment: priceNum * lotSize
          };
        })
        .sort((a, b) => b.currentGmp - a.currentGmp);

      if (closingEligible.length > 0) {
        if (recipients.length === 0) {
          console.log(`[Alert] CLOSING_DAY_DIGEST detected for ${closingEligible.length} IPOs, but no users enabled alerts.`);
          alertLogs.push({
            ipo_id: closingEligible[0].ipo.id,
            ipo_name: closingEligible.map(c => c.ipo.ipo_name).join(', '),
            category: closingEligible.length > 1 ? 'MULTI' : closingEligible[0].ipo.category || 'IPO',
            alert_type: 'CLOSING_DAY_DIGEST',
            gmp_percent: closingEligible[0].currentGmp,
            previous_gmp_percent: null,
            recipients: [],
            recipient_count: 0,
            subject: `FolioX Alert: ${closingEligible.length} IPOs Closing Today with >20% GMP`,
            sent_status: 'SKIPPED_NO_RECIPIENTS',
            error_message: 'No users have enabled IPO email alerts',
            created_at: new Date().toISOString()
          });
        } else {
          try {
            const emailResult = await sendClosingDayDigestEmailViaSmtp({
              recipients,
              closingIpos: closingEligible
            });

            alertLogs.push({
              ipo_id: closingEligible[0].ipo.id,
              ipo_name: closingEligible.map(c => c.ipo.ipo_name).join(', '),
              category: closingEligible.length > 1 ? 'MULTI' : closingEligible[0].ipo.category || 'IPO',
              alert_type: 'CLOSING_DAY_DIGEST',
              gmp_percent: closingEligible[0].currentGmp,
              previous_gmp_percent: null,
              recipients,
              recipient_count: recipients.length,
              subject: emailResult.subject,
              sent_status: emailResult.success ? 'SENT' : 'FAILED',
              error_message: emailResult.error || null,
              created_at: new Date().toISOString()
            });
          } catch (err: any) {
            console.error('Error sending closing day digest email:', err);
            alertLogs.push({
              ipo_id: closingEligible[0].ipo.id,
              ipo_name: closingEligible.map(c => c.ipo.ipo_name).join(', '),
              category: closingEligible.length > 1 ? 'MULTI' : closingEligible[0].ipo.category || 'IPO',
              alert_type: 'CLOSING_DAY_DIGEST',
              gmp_percent: closingEligible[0].currentGmp,
              previous_gmp_percent: null,
              recipients,
              recipient_count: recipients.length,
              subject: `FolioX Alert: ${closingEligible.length} IPOs Closing Today with >20% GMP`,
              sent_status: 'FAILED',
              error_message: err.message,
              created_at: new Date().toISOString()
            });
          }
        }
      }
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

    // ── On-demand Test Dispatcher ──
    const url = new URL(req.url);
    const testMode = url.searchParams.get('test') || url.searchParams.get('test_type');
    if (testMode) {
      const recipients = await getAlertRecipients(supabaseAdmin);

      if (testMode === 'opening') {
        const sampleOpeningIpos = [
          {
            ipo: {
              id: 1662,
              ipo_name: 'Pranav Constructions',
              category: 'IPO',
              price_str: '124',
              price_num: 124,
              gmp_amount: 39,
              gmp_percent: 31.45,
              lot_size: 100,
              subscription: '18.5x',
              open_date: 'Today (10:00 AM)',
              close_date: '9-Sep',
              boa_date: '10-Sep',
              listing_date: '12-Sep'
            },
            currentGmp: 31.45,
            estProfit: 3900,
            expectedListingPrice: 163,
            minInvestment: 12400
          },
          {
            ipo: {
              id: 1950,
              ipo_name: 'Shubhashish Homes',
              category: 'IPO',
              price_str: '210',
              price_num: 210,
              gmp_amount: 52,
              gmp_percent: 24.76,
              lot_size: 70,
              subscription: '8.2x',
              open_date: 'Today (10:00 AM)',
              close_date: '10-Sep',
              boa_date: '11-Sep',
              listing_date: '15-Sep'
            },
            currentGmp: 24.76,
            estProfit: 3640,
            expectedListingPrice: 262,
            minInvestment: 14700
          },
          {
            ipo: {
              id: 1820,
              ipo_name: 'Shree Tirupati Balajee',
              category: 'IPO',
              price_str: '99',
              price_num: 99,
              gmp_amount: 21,
              gmp_percent: 21.21,
              lot_size: 150,
              subscription: '12.4x',
              open_date: 'Today (10:00 AM)',
              close_date: '9-Sep',
              boa_date: '10-Sep',
              listing_date: '12-Sep'
            },
            currentGmp: 21.21,
            estProfit: 3150,
            expectedListingPrice: 120,
            minInvestment: 14850
          }
        ];

        const emailResult = await sendOpeningDayDigestEmailViaSmtp({
          recipients,
          openingIpos: sampleOpeningIpos
        });

        await supabaseAdmin.from('ipo_email_alerts').insert([{
          ipo_id: sampleOpeningIpos[0].ipo.id,
          ipo_name: sampleOpeningIpos.map(c => c.ipo.ipo_name).join(', '),
          category: 'MULTI',
          alert_type: 'OPENING_DAY_DIGEST',
          gmp_percent: sampleOpeningIpos[0].currentGmp,
          previous_gmp_percent: null,
          recipients,
          recipient_count: recipients.length,
          subject: emailResult.subject || 'FolioX Alert: Opening Day Digest',
          sent_status: emailResult.success ? 'SENT' : 'FAILED',
          error_message: emailResult.error || null,
          created_at: new Date().toISOString()
        }]);

        return new Response(JSON.stringify({
          success: emailResult.success,
          mode: 'TEST_DISPATCH',
          alert_type: 'OPENING_DAY_DIGEST',
          recipients,
          opening_ipos_count: sampleOpeningIpos.length,
          opening_ipos: sampleOpeningIpos.map(c => ({ name: c.ipo.ipo_name, gmp: c.currentGmp })),
          emailResult
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: emailResult.success ? 200 : 500
        });
      }

      if (testMode === 'closing') {
        const sampleClosingIpos = [
          {
            ipo: {
              id: 1662,
              ipo_name: 'Pranav Constructions',
              category: 'IPO',
              price_str: '124',
              price_num: 124,
              gmp_amount: 39,
              gmp_percent: 31.45,
              lot_size: 100,
              subscription: '18.5x',
              close_date: 'Today (5:00 PM)',
              boa_date: '10-Sep',
              listing_date: '12-Sep'
            },
            currentGmp: 31.45,
            estProfit: 3900,
            expectedListingPrice: 163,
            minInvestment: 12400
          },
          {
            ipo: {
              id: 1950,
              ipo_name: 'Shubhashish Homes',
              category: 'IPO',
              price_str: '210',
              price_num: 210,
              gmp_amount: 52,
              gmp_percent: 24.76,
              lot_size: 70,
              subscription: '8.2x',
              close_date: 'Today (5:00 PM)',
              boa_date: '11-Sep',
              listing_date: '15-Sep'
            },
            currentGmp: 24.76,
            estProfit: 3640,
            expectedListingPrice: 262,
            minInvestment: 14700
          },
          {
            ipo: {
              id: 1820,
              ipo_name: 'Shree Tirupati Balajee',
              category: 'IPO',
              price_str: '99',
              price_num: 99,
              gmp_amount: 21,
              gmp_percent: 21.21,
              lot_size: 150,
              subscription: '12.4x',
              close_date: 'Today (5:00 PM)',
              boa_date: '10-Sep',
              listing_date: '12-Sep'
            },
            currentGmp: 21.21,
            estProfit: 3150,
            expectedListingPrice: 120,
            minInvestment: 14850
          }
        ];

        const emailResult = await sendClosingDayDigestEmailViaSmtp({
          recipients,
          closingIpos: sampleClosingIpos
        });

        await supabaseAdmin.from('ipo_email_alerts').insert([{
          ipo_id: sampleClosingIpos[0].ipo.id,
          ipo_name: sampleClosingIpos.map(c => c.ipo.ipo_name).join(', '),
          category: 'MULTI',
          alert_type: 'CLOSING_DAY_DIGEST',
          gmp_percent: sampleClosingIpos[0].currentGmp,
          previous_gmp_percent: null,
          recipients,
          recipient_count: recipients.length,
          subject: emailResult.subject || 'FolioX Alert: Closing Day Digest',
          sent_status: emailResult.success ? 'SENT' : 'FAILED',
          error_message: emailResult.error || null,
          created_at: new Date().toISOString()
        }]);

        return new Response(JSON.stringify({
          success: emailResult.success,
          mode: 'TEST_DISPATCH',
          alert_type: 'CLOSING_DAY_DIGEST',
          recipients,
          closing_ipos_count: sampleClosingIpos.length,
          closing_ipos: sampleClosingIpos.map(c => ({ name: c.ipo.ipo_name, gmp: c.currentGmp })),
          emailResult
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: emailResult.success ? 200 : 500
        });
      }

      const allTestConfigs = [
        {
          alertType: 'OPENING_DAY_HIGH_GMP' as const,
          ipo: {
            id: 1662,
            ipo_name: 'Pranav Constructions',
            category: 'IPO',
            price_num: 124,
            gmp_amount: 39,
            gmp_percent: 31.45,
            lot_size: 100,
            open_date: '5-Sep',
            close_date: '9-Sep',
            boa_date: '10-Sep',
            listing_date: '12-Sep',
            subscription: '18.5x'
          },
          prevGmp: 24.0,
          currentGmp: 31.45
        },
        {
          alertType: 'GMP_DROPPED_BELOW_20' as const,
          ipo: {
            id: 2081,
            ipo_name: 'Deepa Jewellers',
            category: 'IPO',
            price_num: 177,
            gmp_amount: 19,
            gmp_percent: 10.73,
            lot_size: 84,
            open_date: '1-Sep',
            close_date: '3-Sep',
            boa_date: '4-Sep',
            listing_date: '8-Sep',
            subscription: '43.4x'
          },
          prevGmp: 25.0,
          currentGmp: 10.73
        },
        {
          alertType: 'GMP_RISEN_ABOVE_20' as const,
          ipo: {
            id: 1950,
            ipo_name: 'Shubhashish Homes',
            category: 'IPO',
            price_num: 210,
            gmp_amount: 52,
            gmp_percent: 24.76,
            lot_size: 70,
            open_date: '8-Sep',
            close_date: '10-Sep',
            boa_date: '11-Sep',
            listing_date: '15-Sep',
            subscription: '8.2x'
          },
          prevGmp: 14.5,
          currentGmp: 24.76
        }
      ];

      const testsToRun = testMode === 'all'
        ? allTestConfigs
        : allTestConfigs.filter(t => {
            if (testMode === 'drop') return t.alertType === 'GMP_DROPPED_BELOW_20';
            if (testMode === 'surge') return t.alertType === 'GMP_RISEN_ABOVE_20';
            return t.alertType === 'OPENING_DAY_HIGH_GMP';
          });

      const dispatchResults = [];

      for (const item of testsToRun) {
        const emailResult = await sendAlertEmailViaSmtp({
          recipients,
          ipo: item.ipo,
          alertType: item.alertType,
          prevGmp: item.prevGmp,
          currentGmp: item.currentGmp
        });

        await supabaseAdmin.from('ipo_email_alerts').insert([{
          ipo_id: item.ipo.id,
          ipo_name: item.ipo.ipo_name,
          category: item.ipo.category,
          alert_type: item.alertType,
          gmp_percent: item.currentGmp,
          previous_gmp_percent: item.prevGmp,
          recipients,
          recipient_count: recipients.length,
          subject: emailResult.subject || `FolioX Test Alert: ${item.ipo.ipo_name}`,
          sent_status: emailResult.success ? 'SENT' : 'FAILED',
          error_message: emailResult.error || null,
          created_at: new Date().toISOString()
        }]);

        dispatchResults.push({
          alertType: item.alertType,
          ipo: item.ipo.ipo_name,
          success: emailResult.success,
          subject: emailResult.subject,
          messageId: emailResult.messageId
        });
      }

      return new Response(JSON.stringify({
        success: dispatchResults.every(r => r.success),
        mode: 'TEST_DISPATCH',
        recipients,
        count: dispatchResults.length,
        dispatches: dispatchResults
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }

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
