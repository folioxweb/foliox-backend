import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const AMFI_NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

serve(withSystemLogging('sync-mf-master', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log("Fetching AMFI NAV master file...");
    const res = await fetch(AMFI_NAV_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch AMFI file: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    console.log(`Received ${lines.length} total lines from AMFI.`);

    let currentCategory = "";
    let currentAmc = "";
    let isOpenEnded = false;

    const filteredSchemes: any[] = [];
    const seenSchemeCodes = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Section Category Header (e.g. "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)")
      if (line.includes("Schemes(") && line.endsWith(")")) {
        if (line.startsWith("Open Ended Schemes")) {
          isOpenEnded = true;
          const match = line.match(/\((.*?)\)/);
          currentCategory = match ? match[1].trim() : "Open Ended";
        } else {
          isOpenEnded = false;
          currentCategory = "";
        }
        currentAmc = "";
        continue;
      }

      // If not in an Open Ended section, skip
      if (!isOpenEnded) continue;

      // Check if this is an AMC Header line (non-semicolon line)
      if (!line.includes(";")) {
        currentAmc = line;
        continue;
      }

      // Check if header line
      if (line.startsWith("Scheme Code;")) continue;

      // Format: Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
      const parts = line.split(";");
      if (parts.length < 8) continue;

      const rawSchemeCode = parts[0]?.trim();
      const rawIsin = parts[1]?.trim();
      const rawName = parts[3]?.trim();
      const rawPlan = parts[4]?.trim();
      const rawOption = parts[5]?.trim();
      const rawNav = parts[6]?.trim();
      const rawDate = parts[7]?.trim();

      const schemeCode = parseInt(rawSchemeCode, 10);
      if (isNaN(schemeCode) || schemeCode <= 0) continue;

      // Filter for Growth Option only
      const optionUpper = (rawOption || "").toUpperCase();
      if (!optionUpper.includes("GROWTH")) continue;

      // Verify ISIN format if present
      const isin = (rawIsin && rawIsin !== "-" && rawIsin.startsWith("INF")) ? rawIsin : null;

      // Verify NAV is active and valid
      const navNum = parseFloat(rawNav);
      if (isNaN(navNum) || navNum <= 0) continue;

      // Avoid duplicates in file
      if (seenSchemeCodes.has(schemeCode)) continue;
      seenSchemeCodes.add(schemeCode);

      // Clean scheme name
      let cleanName = rawName || `MF Scheme ${schemeCode}`;
      if (rawPlan && !cleanName.includes(rawPlan)) {
        cleanName = `${cleanName} - ${rawPlan}`;
      }

      filteredSchemes.push({
        scheme_code: schemeCode,
        isin: isin,
        name: cleanName,
        amc_name: currentAmc || null,
        category: currentCategory || "Mutual Fund",
        plan: rawPlan || "Direct Plan",
        nav: navNum,
        nav_date: rawDate || null,
        last_updated: new Date().toISOString()
      });
    }

    console.log(`Filtered down to ${filteredSchemes.length} clean Growth schemes.`);

    // Batch upsert into mf_schemes table in chunks of 500
    const CHUNK_SIZE = 500;
    let upsertedCount = 0;

    for (let i = 0; i < filteredSchemes.length; i += CHUNK_SIZE) {
      const chunk = filteredSchemes.slice(i, i + CHUNK_SIZE);
      const { error: upsertErr } = await supabaseAdmin
        .from('mf_schemes')
        .upsert(chunk, { onConflict: 'scheme_code' });

      if (upsertErr) {
        console.error(`Chunk error at index ${i}:`, upsertErr);
      } else {
        upsertedCount += chunk.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully synced ${upsertedCount} Mutual Fund schemes into mf_schemes master table.`,
        totalFiltered: filteredSchemes.length,
        totalUpserted: upsertedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: any) {
    console.error("Sync MF Master error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}));
