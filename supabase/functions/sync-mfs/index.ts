import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(withSystemLogging('sync-mfs', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let updatedCount = 0;
    let sipsExecuted = 0;
    const executedSips = [];

    // 1. Fetch Mutual Funds
    const { data: mfAssets, error: fetchErr } = await supabaseAdmin
      .from('assets')
      .select('asset_id, symbol, api_code')
      .eq('asset_type', 'MF')
      .not('api_code', 'is', null);

    if (fetchErr) throw fetchErr;

    if (mfAssets && mfAssets.length > 0) {
      for (const mf of mfAssets) {
        try {
          // 2. Fetch NAV from MFAPI
          const res = await fetch(`https://api.mfapi.in/mf/${mf.api_code}`);
          if (!res.ok) continue;
          
          const mfData = await res.json();
          if (!mfData?.data || mfData.data.length === 0) continue;

          const latest = mfData.data[0];
          const previous = mfData.data[1];
          
          const navStr = latest?.nav;
          const prevNavStr = previous?.nav;
          const dateStr = latest?.date; // Format: "DD-MM-YYYY"
          const nav = Number(navStr);
          const prevNav = Number(prevNavStr || navStr);
          
          if (isNaN(nav) || nav <= 0 || !dateStr) continue;

          // Parse DD-MM-YYYY
          const dateParts = dateStr.split('-');
          if (dateParts.length !== 3) continue;
          const navDateDay = parseInt(dateParts[0], 10);
          const formattedNavDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // YYYY-MM-DD for DB storage

          // 3. Update NAV and Prev Close in assets table
          await supabaseAdmin
            .from('assets')
            .update({
              current_price: nav,
              prev_close: prevNav,
              last_updated: new Date().toISOString()
            })
            .eq('asset_id', mf.asset_id);
          
          updatedCount++;

          // 4. Process SIPs (handles weekends, public holidays & next trading day)
          const { data: sips } = await supabaseAdmin
            .from('mf_sip_configs')
            .select('asset_id, sip_amount, sip_day, last_sip_date')
            .eq('asset_id', mf.asset_id)
            .eq('is_enabled', true);
          
          if (sips && sips.length > 0) {
            for (const sip of sips) {
              const sipDay = Number(sip.sip_day) || 0;
              const sipAmount = Number(sip.sip_amount) || 0;
              if (sipDay <= 0 || sipAmount <= 0) continue;

              const lastSipDateStr = sip.last_sip_date ? String(sip.last_sip_date).substring(0, 10) : '';
              const currentYearMonth = formattedNavDate.substring(0, 7); // "YYYY-MM"
              const lastSipYearMonth = lastSipDateStr ? lastSipDateStr.substring(0, 7) : '';

              // Already executed in current NAV month
              if (lastSipYearMonth === currentYearMonth) continue;

              // Effective SIP day in current NAV month
              const navYear = parseInt(dateParts[2], 10);
              const navMonth = parseInt(dateParts[1], 10);
              const lastDayOfNavMonth = new Date(navYear, navMonth, 0).getDate();
              const effectiveSipDay = Math.min(sipDay, lastDayOfNavMonth);

              let shouldExecute = false;
              if (navDateDay >= effectiveSipDay) {
                shouldExecute = true;
              } else if (lastSipYearMonth !== '' && navDateDay <= 3) {
                // Check if previous month SIP was missed due to month-end weekend/holiday
                const prevMonthDate = new Date(navYear, navMonth - 2, 1);
                const prevMonthYear = prevMonthDate.getFullYear();
                const prevMonthNum = String(prevMonthDate.getMonth() + 1).padStart(2, '0');
                const prevMonthStr = `${prevMonthYear}-${prevMonthNum}`;
                if (lastSipYearMonth < prevMonthStr) {
                  shouldExecute = true;
                }
              }

              if (!shouldExecute) continue;

              // Deduplication check: if we already ran SIP for this specific NAV date
              if (sip.last_sip_date === formattedNavDate) continue;

              const quantity = sipAmount / nav;

              const { error: txErr } = await supabaseAdmin
                .from('transactions')
                .insert({
                  asset_id: sip.asset_id,
                  tx_type: 'BUY',
                  quantity: quantity,
                  price: nav,
                  tx_date: new Date().toISOString()
                });
              
              if (!txErr) {
                await supabaseAdmin
                  .from('mf_sip_configs')
                  .update({ last_sip_date: formattedNavDate })
                  .eq('asset_id', sip.asset_id);
                
                sipsExecuted++;
                executedSips.push(sip.asset_id);
              }
            }
          }
        } catch (e) {
          console.warn(`MF Processing failed for ${mf.symbol}:`, e);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      updated_mfs: updatedCount,
      sips_executed: sipsExecuted,
      executed_assets: executedSips,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400
    });
  }
}));
