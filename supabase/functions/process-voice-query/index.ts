import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { parseQuery, findBestMatch, Intent } from "./nlp-engine.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const payload = await req.json().catch(() => ({}));
    const query = payload.query || "";

    if (!query) {
      return new Response(JSON.stringify({ error: "Missing query parameter" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      authHeader ? { global: { headers: { Authorization: authHeader } } } : undefined
    );

    // Fetch all user holdings for context to extract entity
    const { data: holdings } = await supabaseClient
      .from('vw_holdings')
      .select('*');

    const assetNames = (holdings || []).map(h => h.name || h.symbol).filter(Boolean);

    // Dynamic keyword-based parsing
    const { intent, entity } = parseQuery(query, assetNames);
    
    let speechText = "I'm sorry, I didn't understand your request.";
    let matchedAsset = entity; // entity is now exactly the asset name if found
    let matchedHolding = null;
    
    if (matchedAsset) {
      matchedHolding = holdings?.find(h => h.name === matchedAsset || h.symbol === matchedAsset);
    }

    const formatCurrency = (val: number) => `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    const formatPercent = (val: number) => `${val.toFixed(2)}%`;

    switch (intent) {
      // ----------------------------------------------------
      // ASSET SPECIFIC METRICS
      // ----------------------------------------------------
      case Intent.GET_CURRENT_PRICE:
        if (matchedHolding) {
           speechText = `The current price of ${matchedHolding.name} is ${formatCurrency(matchedHolding.current_price)}.`;
        } else if (entity) {
           speechText = `I couldn't find ${entity} in your portfolio.`;
        } else {
           speechText = `Please specify which asset's price you want to know.`;
        }
        break;

      case Intent.GET_AVG_BUY_PRICE:
        if (matchedHolding) {
          speechText = `Your average buy price for ${matchedHolding.name} is ${formatCurrency(matchedHolding.avg_price)}.`;
        } else if (entity) {
          speechText = `I couldn't find ${entity} in your portfolio.`;
        } else {
          speechText = `Please specify which asset's average buy price you want to know.`;
        }
        break;

      case Intent.GET_QUANTITY:
        if (matchedHolding) {
          speechText = `You own ${matchedHolding.total_quantity} units of ${matchedHolding.name}.`;
        } else {
          speechText = `Please specify which asset's quantity you want to know.`;
        }
        break;

      case Intent.GET_INVESTED_AMOUNT:
        if (matchedHolding) {
          speechText = `Your invested amount in ${matchedHolding.name} is ${formatCurrency(matchedHolding.invested_value)}.`;
        } else {
          speechText = `Please specify which asset's invested amount you want.`;
        }
        break;

      case Intent.GET_CURRENT_VALUE:
        if (matchedHolding) {
          speechText = `Your current holding value for ${matchedHolding.name} is ${formatCurrency(matchedHolding.current_value)}.`;
        } else {
          speechText = `Please specify which asset's current value you want to know.`;
        }
        break;

      case Intent.GET_PROFIT_LOSS:
        if (matchedHolding) {
          const ret = matchedHolding.return_abs || 0;
          const retPct = matchedHolding.return_pct || 0;
          speechText = `You have a ${ret >= 0 ? 'profit' : 'loss'} of ${formatCurrency(Math.abs(ret))} (${formatPercent(retPct)}) in ${matchedHolding.name}.`;
        } else {
          speechText = `Please specify which asset's profit or loss you want to know.`;
        }
        break;

      case Intent.GET_DAY_CHANGE:
        if (matchedHolding) {
          const change = matchedHolding.day_change_abs || 0;
          const changePct = matchedHolding.day_change_pct || 0;
          speechText = `${matchedHolding.name} went ${change >= 0 ? 'up' : 'down'} by ${formatCurrency(Math.abs(change))} (${formatPercent(Math.abs(changePct))}) today.`;
        } else {
          speechText = `Please specify which asset's day change you want to know.`;
        }
        break;

      case Intent.GET_SECTOR:
        if (matchedHolding) {
          if (matchedHolding.sector) {
            speechText = `${matchedHolding.name} is in the ${matchedHolding.sector} sector.`;
          } else {
            speechText = `I don't have sector information for ${matchedHolding.name}.`;
          }
        } else {
          speechText = `Please specify which asset's sector you want to know.`;
        }
        break;

      case Intent.GET_CONVICTION:
        if (matchedHolding) {
          if (matchedHolding.confidence) {
            speechText = `Your conviction score for ${matchedHolding.name} is ${matchedHolding.confidence}.`;
          } else {
            speechText = `You haven't assigned a conviction score to ${matchedHolding.name}.`;
          }
        } else {
          speechText = `Please specify which asset's conviction score you want to know.`;
        }
        break;

      case Intent.GET_CONSTITUENTS:
        if (matchedHolding) {
          if (matchedHolding.asset_type === 'STOCK') {
            speechText = `${matchedHolding.name} is a stock and doesn't have constituents.`;
          } else {
            const { data: constituents } = await supabaseClient
              .from('fund_holdings')
              .select('holding_name, weight_percentage')
              .eq('fund_asset_id', matchedHolding.asset_id)
              .order('weight_percentage', { ascending: false })
              .limit(5);
            
            if (constituents && constituents.length > 0) {
              const topList = constituents.map(c => c.holding_name).join(', ');
              speechText = `The top constituents of ${matchedHolding.name} include: ${topList}.`;
            } else {
              speechText = `I don't have constituent data for ${matchedHolding.name}.`;
            }
          }
        } else {
          speechText = `Please specify which fund's constituents you want to know.`;
        }
        break;

      case Intent.LATEST_NEWS:
        if (matchedHolding) {
           const startOfDay = new Date();
           startOfDay.setHours(0, 0, 0, 0);

           const { data: newsItems } = await supabaseClient
             .from('news')
             .select('title')
             .eq('asset_id', matchedHolding.asset_id)
             .gte('published_at', startOfDay.toISOString())
             .order('published_at', { ascending: false });
             
           if (newsItems && newsItems.length > 0) {
             const headlines = newsItems.map(n => n.title).join(". ");
             speechText = `I found ${newsItems.length} news articles for ${matchedHolding.name} today: ${headlines}.`;
           } else {
             // Fallback to latest if nothing today
             const { data: latest } = await supabaseClient
               .from('news')
               .select('title')
               .eq('asset_id', matchedHolding.asset_id)
               .order('published_at', { ascending: false })
               .limit(1);
             if (latest && latest.length > 0) {
               speechText = `There is no news today. The latest news for ${matchedHolding.name} is: ${latest[0].title}.`;
             } else {
               speechText = `I couldn't find any news for ${matchedHolding.name}.`;
             }
           }
        } else if (entity) {
           speechText = `I couldn't find ${entity} in your portfolio.`;
        } else {
           speechText = `Please specify which asset you want news for.`;
        }
        break;

      case Intent.LATEST_REPORTS:
        if (matchedHolding) {
           const { data: reports } = await supabaseClient
             .from('company_documents')
             .select('title')
             .eq('asset_id', matchedHolding.asset_id)
             .order('announcement_date', { ascending: false })
             .limit(1);
             
           if (reports && reports.length > 0) {
             speechText = `The latest report for ${matchedHolding.name} is: ${reports[0].title}.`;
           } else {
             speechText = `I couldn't find any recent reports for ${matchedHolding.name}.`;
           }
        } else {
           speechText = `Please specify which asset you want reports for.`;
        }
        break;

      // ----------------------------------------------------
      // PORTFOLIO WIDE METRICS & ANALYTICS
      // ----------------------------------------------------
      case Intent.GET_TOP_STOCKS: {
        const numMatch = query.match(/\b(top|biggest) (\d+)\b/i);
        const limit = numMatch ? parseInt(numMatch[2], 10) : 5;
        const sortedStocks = (holdings || []).filter(h => h.asset_type === 'STOCK').sort((a, b) => (b.current_value || 0) - (a.current_value || 0)).slice(0, limit);
        if (sortedStocks.length > 0) {
          const list = sortedStocks.map(s => s.name).join(", ");
          speechText = `Your top ${sortedStocks.length} stocks are: ${list}.`;
        } else {
          speechText = `You don't have any stocks in your portfolio.`;
        }
        break;
      }

      case Intent.GET_TOP_SECTORS: {
        const numMatch = query.match(/\b(top|biggest) (\d+)\b/i);
        const limit = numMatch ? parseInt(numMatch[2], 10) : 5;
        
        const sectorMap = new Map<string, number>();
        (holdings || []).forEach(h => {
          if (h.sector) {
            sectorMap.set(h.sector, (sectorMap.get(h.sector) || 0) + (h.current_value || 0));
          }
        });
        
        const sortedSectors = Array.from(sectorMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit);
        if (sortedSectors.length > 0) {
          const list = sortedSectors.map(s => s[0]).join(", ");
          speechText = `Your top ${sortedSectors.length} sectors are: ${list}.`;
        } else {
          speechText = `I couldn't find any sector data for your portfolio.`;
        }
        break;
      }

      case Intent.GET_WEIGHTAGE: {
        const totalPortfolioValue = (holdings || []).reduce((sum, h) => sum + (h.current_value || 0), 0);
        if (totalPortfolioValue === 0) {
          speechText = "Your portfolio value is currently zero.";
          break;
        }

        if (matchedHolding) {
          const weight = ((matchedHolding.current_value || 0) / totalPortfolioValue) * 100;
          speechText = `${matchedHolding.name} makes up ${formatPercent(weight)} of your portfolio.`;
        } else {
          const uniqueSectors = Array.from(new Set((holdings || []).map(h => h.sector).filter(Boolean)));
          let matchedSector = null;
          for (const s of uniqueSectors) {
            if (query.toLowerCase().includes(s.toLowerCase())) {
              matchedSector = s;
              break;
            }
          }
          
          if (matchedSector) {
            const sectorValue = (holdings || []).filter(h => h.sector === matchedSector).reduce((sum, h) => sum + (h.current_value || 0), 0);
            const weight = (sectorValue / totalPortfolioValue) * 100;
            speechText = `The ${matchedSector} sector makes up ${formatPercent(weight)} of your portfolio.`;
          } else {
            speechText = "Please specify which asset or sector you want to check the weightage for.";
          }
        }
        break;
      }
      case Intent.GET_TODAY_ETF_GAIN:
        const etfs = holdings?.filter(h => h.asset_type === 'ETF') || [];
        const totalEtfGain = etfs.reduce((sum, h) => sum + (h.day_change_abs || 0), 0);
        speechText = `Your ETFs ${totalEtfGain >= 0 ? 'gained' : 'lost'} ${formatCurrency(Math.abs(totalEtfGain))} today.`;
        break;

      case Intent.GET_TODAY_MF_GAIN:
        const mfs = holdings?.filter(h => h.asset_type === 'MF') || [];
        const totalMfGain = mfs.reduce((sum, h) => sum + (h.day_change_abs || 0), 0);
        speechText = `Your Mutual Funds ${totalMfGain >= 0 ? 'gained' : 'lost'} ${formatCurrency(Math.abs(totalMfGain))} today.`;
        break;

      case Intent.GET_TODAY_PERFORMANCE:
        const totalGain = (holdings || []).reduce((sum, h) => sum + (h.day_change_abs || 0), 0);
        speechText = `Your overall portfolio ${totalGain >= 0 ? 'gained' : 'lost'} ${formatCurrency(Math.abs(totalGain))} today.`;
        break;

      case Intent.LIST_ETFS:
        const myEtfs = holdings?.filter(h => h.asset_type === 'ETF').map(h => h.name || h.symbol) || [];
        if (myEtfs.length > 0) {
          if (query.toLowerCase().includes('how many')) {
            speechText = `You have ${myEtfs.length} ETFs.`;
          } else {
            speechText = `You have ${myEtfs.length} ETFs. They are: ${myEtfs.join(", ")}.`;
          }
        } else {
          speechText = "You don't currently hold any ETFs.";
        }
        break;

      case Intent.LIST_MFS:
        const myMfs = holdings?.filter(h => h.asset_type === 'MF').map(h => h.name || h.symbol) || [];
        if (myMfs.length > 0) {
          if (query.toLowerCase().includes('how many')) {
            speechText = `You have ${myMfs.length} mutual funds.`;
          } else {
            speechText = `You have ${myMfs.length} mutual funds. They are: ${myMfs.join(", ")}.`;
          }
        } else {
          speechText = "You don't currently hold any mutual funds.";
        }
        break;

      case Intent.LIST_STOCKS:
        const myStocks = holdings?.filter(h => h.asset_type === 'STOCK').map(h => h.name || h.symbol) || [];
        if (myStocks.length > 0) {
          if (query.toLowerCase().includes('how many')) {
            speechText = `You own ${myStocks.length} stocks.`;
          } else {
            speechText = `You own ${myStocks.length} stocks. They are: ${myStocks.join(", ")}.`;
          }
        } else {
          speechText = "You don't currently hold any stocks.";
        }
        break;
        
      default:
        speechText = "I heard you, but I'm not sure how to answer that specific question yet.";
        break;
    }

    return new Response(JSON.stringify({ 
      data: {
         speechText,
         intent,
         entity,
         matchedAsset
      } 
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
})
