import { serve } from "https://deno.land/std@0.192.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.32.0'
import { withSystemLogging, logUserAudit } from '../_shared/systemLogger.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function normalizeAssetType(rawType?: string): 'STOCK' | 'ETF' | 'MF' | 'FD' {
  if (!rawType) return 'STOCK';
  const clean = rawType.trim().toUpperCase();
  if (clean === 'STOCKS' || clean === 'STOCK') return 'STOCK';
  if (clean === 'ETFS' || clean === 'ETF') return 'ETF';
  if (clean === 'MUTUALFUNDS' || clean === 'MUTUAL_FUNDS' || clean === 'MFS' || clean === 'MF') return 'MF';
  if (clean === 'FDS' || clean === 'FD' || clean === 'FIXED_DEPOSITS' || clean === 'FIXEDDEPOSITS') return 'FD';
  return 'STOCK';
}

async function fetchLiveStockQuote(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    let ySym = symbol.trim();
    if (ySym.startsWith('NSE:')) ySym = ySym.replace(/^NSE:/i, '') + '.NS';
    else if (ySym.startsWith('BSE:')) ySym = ySym.replace(/^BSE:/i, '') + '.BO';
    else if (!ySym.endsWith('.NS') && !ySym.endsWith('.BO')) ySym = ySym + '.NS';

    const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?interval=1d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json.chart?.result?.[0]?.meta;
    if (meta && meta.regularMarketPrice !== undefined) {
      const price = Number(meta.regularMarketPrice);
      const prevClose = Number(meta.chartPreviousClose ?? meta.previousClose ?? price);
      return { price, prevClose };
    }
  } catch (e) {
    console.warn('Quote fetch failed:', e);
  }
  return null;
}

serve(withSystemLogging('execute-trade', async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    // Extract Authenticated User from JWT
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let userEmail: string | null = null;
    if (authHeader) {
      const token = authHeader.replace(/^Bearer /i, '').trim();
      if (token && token !== supabaseServiceKey) {
        try {
          const { data: { user } } = await supabaseClient.auth.getUser(token);
          if (user) {
            userId = user.id;
            userEmail = user.email || null;
          }
        } catch (_authErr) {
          // Token may be anon key
        }
      }
    }

    const payload = await req.json()
    const { 
      action, 
      symbol, 
      isin,
      name, 
      sector, 
      category, 
      confidence, 
      badge, 
      trade_type,
      tradeType,
      asset_id, 
      assetId, 
      asset_type, 
      assetType, 
      quantity, 
      price, 
      added_price,
      addedPrice,
      target_price,
      targetPrice,
      notes,
      watchlist_id,
      watchlistId,
      initialCapital,
      newCapital,
      fundCode, 
      mfApiCode, 
      sipEnabled, 
      sipAmount, 
      sipDay, 
      interestRate, 
      startDate, 
      maturityDate, 
      fd_principal, 
      fd_rate, 
      fd_maturity_date, 
      tx_id, 
      txId 
    } = payload;

    if (!action) {
      throw new Error('Missing required field: action')
    }

    // -----------------------------------------------------------------------
    // A. WATCHLIST ACTIONS
    // -----------------------------------------------------------------------
    if (action === 'addWatchlistItem') {
      const sym = symbol ? symbol.trim().toUpperCase() : '';
      if (!sym) throw new Error('Symbol is required to add watchlist item');

      let currentPrice = Number(added_price || addedPrice || price || 0);
      if (currentPrice <= 0) {
        const live = await fetchLiveStockQuote(sym);
        if (live) currentPrice = live.price;
      }

      const watchItemData: Record<string, any> = {
        symbol: sym,
        isin: isin || null,
        name: name ? name.trim() : sym,
        sector: sector || null,
        confidence: confidence || 'Medium',
        badge: badge || trade_type || tradeType || 'Trade',
        added_price: currentPrice > 0 ? currentPrice : 0,
        target_price: target_price || targetPrice || null,
        notes: notes || null,
        added_at: new Date().toISOString()
      };

      if (userId) {
        watchItemData.user_id = userId;
      }

      const onConflictTarget = userId ? 'user_id,symbol' : 'symbol';

      const { data, error } = await supabaseClient
        .from('watchlist_items')
        .upsert(watchItemData, { onConflict: onConflictTarget })
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, item: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'removeWatchlistItem') {
      const targetId = watchlist_id || watchlistId;
      const sym = symbol ? symbol.trim() : '';

      let query = supabaseClient.from('watchlist_items').delete();
      if (userId) query = query.eq('user_id', userId);

      if (targetId) query = query.eq('watchlist_id', targetId);
      else if (sym) query = query.eq('symbol', sym);
      else throw new Error('watchlist_id or symbol is required to remove from watchlist');

      const { error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, message: 'Removed from watchlist' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // -----------------------------------------------------------------------
    // B. PAPER TRADING ACTIONS
    // -----------------------------------------------------------------------
    if (action === 'updatePaperCapital') {
      const cap = Number(newCapital || initialCapital);
      if (isNaN(cap) || cap <= 0) throw new Error('Valid capital amount is required');

      let query = supabaseClient.from('paper_portfolio_config').select('*');
      if (userId) query = query.eq('user_id', userId);
      else query = query.eq('id', 1);

      const { data: config } = await query.maybeSingle();

      const oldInitial = config ? Number(config.initial_capital) : 5000000;
      const oldCash = config ? Number(config.current_cash) : 5000000;
      const diff = cap - oldInitial;
      const newCash = Math.max(0, oldCash + diff);

      const upsertConfig: Record<string, any> = {
        initial_capital: cap,
        current_cash: newCash,
        updated_at: new Date().toISOString()
      };
      if (userId) {
        upsertConfig.user_id = userId;
      } else {
        upsertConfig.id = 1;
      }

      const { data, error } = await supabaseClient
        .from('paper_portfolio_config')
        .upsert(upsertConfig)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, config: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'resetPaperPortfolio') {
      let delTxQuery = supabaseClient.from('paper_transactions').delete().neq('quantity', 0);
      let delAssetQuery = supabaseClient.from('paper_assets').delete().neq('name', '');
      if (userId) {
        delTxQuery = delTxQuery.eq('user_id', userId);
        delAssetQuery = delAssetQuery.eq('user_id', userId);
      }
      await delTxQuery;
      await delAssetQuery;

      let query = supabaseClient.from('paper_portfolio_config').select('*');
      if (userId) query = query.eq('user_id', userId);
      else query = query.eq('id', 1);

      const { data: config } = await query.maybeSingle();
      const initCap = config ? Number(config.initial_capital) : 5000000;

      const resetConfig: Record<string, any> = {
        initial_capital: initCap,
        current_cash: initCap,
        realized_pnl: 0,
        updated_at: new Date().toISOString()
      };
      if (userId) {
        resetConfig.user_id = userId;
      } else {
        resetConfig.id = 1;
      }

      const { data: updatedConfig, error } = await supabaseClient
        .from('paper_portfolio_config')
        .upsert(resetConfig)
        .select()
        .single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, config: updatedConfig }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'addPaperHolding' || action === 'buyPaperStock') {
      const buyQty = Number(quantity);
      const buyPrice = Number(price);
      const sym = symbol ? symbol.trim().toUpperCase() : '';

      if (!sym) throw new Error('Stock symbol is required');
      if (isNaN(buyQty) || buyQty <= 0) throw new Error('Quantity must be greater than 0');
      if (isNaN(buyPrice) || buyPrice <= 0) throw new Error('Price must be greater than 0');

      const totalCost = buyQty * buyPrice;

      // Check available cash balance
      let configQuery = supabaseClient.from('paper_portfolio_config').select('*');
      if (userId) configQuery = configQuery.eq('user_id', userId);
      else configQuery = configQuery.eq('id', 1);

      const { data: config } = await configQuery.maybeSingle();

      const currentCash = config ? Number(config.current_cash) : 5000000;
      if (currentCash < totalCost) {
        throw new Error(`Insufficient virtual cash. Available: ₹${currentCash.toLocaleString('en-IN')}, Required: ₹${totalCost.toLocaleString('en-IN')}`);
      }

      // Resolve or Create Paper Asset
      let assetQuery = supabaseClient.from('paper_assets').select('*').eq('symbol', sym);
      if (userId) assetQuery = assetQuery.eq('user_id', userId);

      let { data: pAsset } = await assetQuery.maybeSingle();

      if (!pAsset) {
        const live = await fetchLiveStockQuote(sym);
        const newAssetData: Record<string, any> = {
          symbol: sym,
          name: name ? name.trim() : sym,
          sector: sector || null,
          confidence: confidence || 'Medium',
          trade_type: badge || trade_type || tradeType || 'Trade',
          current_price: live ? live.price : buyPrice,
          prev_close: live ? live.prevClose : buyPrice,
          isin: isin || null,
          last_updated: new Date().toISOString()
        };
        if (userId) newAssetData.user_id = userId;

        const { data: newPAsset, error: pCreateErr } = await supabaseClient
          .from('paper_assets')
          .insert(newAssetData)
          .select()
          .single();

        if (pCreateErr) throw pCreateErr;
        pAsset = newPAsset;
      }

      // Insert Paper BUY transaction
      const txPayload: Record<string, any> = {
        asset_id: pAsset.asset_id,
        tx_type: 'BUY',
        quantity: buyQty,
        price: buyPrice,
        tx_date: new Date().toISOString()
      };
      if (userId) txPayload.user_id = userId;

      const { data: txData, error: txErr } = await supabaseClient
        .from('paper_transactions')
        .insert(txPayload)
        .select()
        .single();

      if (txErr) throw txErr;

      // Deduct cash balance
      let updateConfigQuery = supabaseClient
        .from('paper_portfolio_config')
        .update({
          current_cash: currentCash - totalCost,
          updated_at: new Date().toISOString()
        });
      
      if (userId) updateConfigQuery = updateConfigQuery.eq('user_id', userId);
      else updateConfigQuery = updateConfigQuery.eq('id', 1);

      await updateConfigQuery;

      return new Response(JSON.stringify({ success: true, transaction: txData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'sellPaperHolding') {
      const sellQty = Number(quantity);
      const sellPrice = Number(price);
      const targetPaperId = asset_id || assetId;

      if (!targetPaperId) throw new Error('Paper Asset ID is required to sell');
      if (isNaN(sellQty) || sellQty <= 0) throw new Error('Quantity must be greater than 0');

      // Get current holding state
      const { data: holding } = await supabaseClient
        .from('vw_paper_holdings')
        .select('*')
        .eq('asset_id', targetPaperId)
        .single();

      if (!holding) throw new Error('No active paper holding found to sell.');
      const curQty = Number(holding.total_quantity || 0);
      const avgPrice = Number(holding.avg_price || 0);
      if (sellQty > curQty) throw new Error(`Cannot sell ${sellQty} units. You only hold ${curQty} units.`);

      const finalSellPrice = sellPrice > 0 ? sellPrice : Number(holding.current_price || avgPrice);
      const proceeds = sellQty * finalSellPrice;
      const realizedGain = (finalSellPrice - avgPrice) * sellQty;

      if (sellQty === curQty) {
        let delQuery = supabaseClient.from('paper_transactions').delete().eq('asset_id', targetPaperId);
        if (userId) delQuery = delQuery.eq('user_id', userId);
        await delQuery;
      } else {
        const sellTxData: Record<string, any> = {
          asset_id: targetPaperId,
          tx_type: 'SELL',
          quantity: -Math.abs(sellQty),
          price: finalSellPrice,
          realized_gain: realizedGain,
          tx_date: new Date().toISOString()
        };
        if (userId) sellTxData.user_id = userId;

        await supabaseClient.from('paper_transactions').insert(sellTxData);
      }

      // Update paper config cash and realized PnL
      let configQuery = supabaseClient.from('paper_portfolio_config').select('*');
      if (userId) configQuery = configQuery.eq('user_id', userId);
      else configQuery = configQuery.eq('id', 1);

      const { data: config } = await configQuery.maybeSingle();

      if (config) {
        let updateConfigQuery = supabaseClient
          .from('paper_portfolio_config')
          .update({
            current_cash: Number(config.current_cash) + proceeds,
            realized_pnl: Number(config.realized_pnl) + realizedGain,
            updated_at: new Date().toISOString()
          });

        if (userId) updateConfigQuery = updateConfigQuery.eq('user_id', userId);
        else updateConfigQuery = updateConfigQuery.eq('id', 1);

        await updateConfigQuery;
      }

      return new Response(JSON.stringify({ success: true, realizedGain }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // -----------------------------------------------------------------------
    // C. REAL PORTFOLIO ACTIONS
    // -----------------------------------------------------------------------
    let target_asset_id = asset_id || assetId;
    let target_type = normalizeAssetType(asset_type || assetType);
    let target_symbol = symbol ? symbol.trim() : '';
    const target_name = name ? name.trim() : target_symbol;
    const target_confidence = confidence || 'Medium';
    const target_trade_type = badge || trade_type || tradeType || 'Trade';
    const target_sector = sector || null;

    if (!target_symbol) {
      if (target_type === 'FD') {
        target_symbol = `FD:${target_name.replace(/\s+/g, '_')}_${Date.now()}`;
      } else if (target_type === 'MF') {
        target_symbol = mfApiCode ? `AMFI_${mfApiCode}` : (fundCode ? fundCode.trim() : `MF:${target_name.replace(/\s+/g, '_')}`);
      } else {
        target_symbol = `ASSET_${Date.now()}`;
      }
    }

    // 1. Resolve or Auto-Create Target Asset
    if (!target_asset_id) {
      let query = supabaseClient.from('assets').select('asset_id, asset_type, current_price');
      if (target_type === 'MF' && mfApiCode) {
        query = query.eq('api_code', mfApiCode);
      } else if (isin) {
        query = query.eq('isin', isin);
      } else if (target_symbol && !target_symbol.startsWith('ASSET_')) {
        query = query.eq('symbol', target_symbol);
      } else if (target_name) {
        query = query.eq('name', target_name);
      }
      
      const { data: assetData } = await query.maybeSingle();

      if (assetData) {
        target_asset_id = assetData.asset_id;
        target_type = normalizeAssetType(assetData.asset_type);
      } else if (action === 'addHolding' || action === 'addFD') {
        let livePrice = Number(price || fd_principal || 0);
        let livePrevClose = Number(price || fd_principal || 0);

        if (target_type === 'STOCK' || target_type === 'ETF') {
          const live = await fetchLiveStockQuote(target_symbol);
          if (live) {
            livePrice = live.price;
            livePrevClose = live.prevClose;
          }
        } else if (target_type === 'MF') {
          if (payload.currentNav && Number(payload.currentNav) > 0) {
            livePrice = Number(payload.currentNav);
            livePrevClose = Number(payload.currentNav);
          }
          if (mfApiCode) {
            try {
              const mfRes = await fetch(`https://api.mfapi.in/mf/${mfApiCode}`);
              if (mfRes.ok) {
                const mfJson = await mfRes.json();
                if (mfJson?.data?.length > 0) {
                  const latestNav = parseFloat(mfJson.data[0].nav);
                  if (!isNaN(latestNav) && latestNav > 0) {
                    livePrice = latestNav;
                    if (mfJson.data.length > 1) {
                      const prevNav = parseFloat(mfJson.data[1].nav);
                      if (!isNaN(prevNav) && prevNav > 0) {
                        livePrevClose = prevNav;
                      }
                    }
                  }
                }
              }
            } catch (_mfErr) {
              console.warn("Direct MF API quote fetch error:", _mfErr);
            }
          }
        }

        const { data: newAsset, error: createErr } = await supabaseClient
          .from('assets')
          .insert({
            symbol: target_symbol,
            name: target_name || target_symbol,
            asset_type: target_type,
            sector: target_sector,
            category: category || null,
            confidence: target_confidence,
            trade_type: target_trade_type,
            current_price: livePrice,
            prev_close: livePrevClose,
            api_code: mfApiCode || null,
            isin: isin || null,
            last_updated: new Date().toISOString()
          })
          .select()
          .single();

        if (createErr) throw new Error(`Failed to create asset: ${createErr.message}`);
        target_asset_id = newAsset.asset_id;
      } else {
        throw new Error(`Asset not found for symbol/name: ${target_symbol || target_name}`);
      }
    }

    // User-specific duplicate holding guard for addHolding
    if (userId && target_asset_id && action === 'addHolding' && target_type !== 'FD') {
      const { data: userHolding } = await supabaseClient
        .from('transactions')
        .select('tx_id')
        .eq('user_id', userId)
        .eq('asset_id', target_asset_id)
        .limit(1)
        .maybeSingle();

      if (userHolding) {
        throw new Error(`You already hold ${target_name} in your portfolio. Please use 'Buy More' on your existing holding.`);
      }
    }

    // 2. Handle MF SIP Configuration if provided
    if (target_type === 'MF' && (sipEnabled !== undefined || sipAmount || sipDay)) {
      const sipData: Record<string, any> = {
        asset_id: target_asset_id,
        is_enabled: Boolean(sipEnabled),
        sip_day: Number(sipDay || 1),
        sip_amount: Number(sipAmount || 0)
      };
      if (userId) sipData.user_id = userId;

      await supabaseClient
        .from('mf_sip_configs')
        .upsert(sipData);
    }

    // 3. Handle FD Actions
    const principalVal = Number(fd_principal || principal || price || quantity || 0);
    const rateVal = Number(fd_rate || interestRate || 0);
    const maturityVal = fd_maturity_date || maturityDate || null;

    if (action === 'addFD' || (action === 'addHolding' && target_type === 'FD')) {
      if (!principalVal || !rateVal) throw new Error('FD requires principal amount and interest rate');
      const fdTxData: Record<string, any> = {
        asset_id: target_asset_id,
        tx_type: 'BUY',
        quantity: 1,
        price: principalVal,
        fd_principal: principalVal,
        fd_rate: rateVal,
        fd_maturity_date: maturityVal,
        tx_date: startDate ? new Date(startDate).toISOString() : new Date().toISOString()
      };
      if (userId) fdTxData.user_id = userId;

      const { data, error } = await supabaseClient
        .from('transactions')
        .insert(fdTxData)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, transaction: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'deleteFD') {
      const target_tx_id = tx_id || txId;
      if (!target_tx_id) throw new Error('Transaction ID is required to delete an FD');
      let delQuery = supabaseClient.from('transactions').delete().eq('tx_id', target_tx_id);
      if (userId) delQuery = delQuery.eq('user_id', userId);
      const { error } = await delQuery;
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, deleted: target_tx_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    if (action === 'updateFD') {
      const target_tx_id = tx_id || txId;
      const updates: Record<string, any> = {};
      if (principalVal) {
        updates.price = principalVal;
        updates.fd_principal = principalVal;
      }
      if (rateVal) updates.fd_rate = rateVal;
      if (maturityVal) updates.fd_maturity_date = maturityVal;
      if (startDate) updates.tx_date = new Date(startDate).toISOString();

      let query = supabaseClient.from('transactions').update(updates);
      if (userId) query = query.eq('user_id', userId);
      if (target_tx_id) {
        query = query.eq('tx_id', target_tx_id);
      } else {
        query = query.eq('asset_id', target_asset_id);
      }

      const { data, error } = await query.select();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, transaction: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 4. Handle Stock / ETF / MF: updateHolding
    if (action === 'updateHolding') {
      const targetQty = Number(quantity);
      const targetPrice = Number(price);

      if (isNaN(targetQty) || targetQty <= 0) throw new Error('Quantity must be greater than 0');
      if (isNaN(targetPrice) || targetPrice <= 0) throw new Error('Price must be greater than 0');

      const assetUpdates: Record<string, any> = {};
      if (confidence) assetUpdates.confidence = confidence;
      if (badge || trade_type || tradeType) assetUpdates.trade_type = badge || trade_type || tradeType;
      if (sector) assetUpdates.sector = sector;

      if (Object.keys(assetUpdates).length > 0) {
        await supabaseClient
          .from('assets')
          .update(assetUpdates)
          .eq('asset_id', target_asset_id);
      }

      let delQuery = supabaseClient.from('transactions').delete().eq('asset_id', target_asset_id);
      if (userId) delQuery = delQuery.eq('user_id', userId);
      await delQuery;

      const newTxData: Record<string, any> = {
        asset_id: target_asset_id,
        tx_type: 'BUY',
        quantity: targetQty,
        price: targetPrice,
        tx_date: new Date().toISOString()
      };
      if (userId) newTxData.user_id = userId;

      const { data: txData, error: txErr } = await supabaseClient
        .from('transactions')
        .insert(newTxData)
        .select()
        .single();

      if (txErr) throw txErr;

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Holding updated successfully', 
        transaction: txData 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    // 5. Handle Stock / ETF / MF: sellHolding
    if (action === 'sellHolding') {
      const sellQty = Number(quantity);
      if (isNaN(sellQty) || sellQty <= 0) throw new Error('Sell quantity must be greater than 0');

      const { data: holdingData, error: holdingErr } = await supabaseClient
        .from('vw_holdings')
        .select('total_quantity, avg_price, current_price')
        .eq('asset_id', target_asset_id)
        .maybeSingle();

      if (holdingErr) throw holdingErr;
      const currentQty = holdingData ? Number(holdingData.total_quantity || 0) : 0;
      if (currentQty === 0) throw new Error('No active holding found to sell.');
      if (sellQty > currentQty) throw new Error(`Cannot sell ${sellQty} units. You only hold ${currentQty} units.`);

      const sellPrice = Number(price) > 0 ? Number(price) : Number(holdingData?.current_price || holdingData?.avg_price || 0);

      if (sellQty === currentQty) {
        let delQuery = supabaseClient.from('transactions').delete().eq('asset_id', target_asset_id);
        if (userId) delQuery = delQuery.eq('user_id', userId);
        await delQuery;

        return new Response(JSON.stringify({ 
          success: true, 
          fullySold: true, 
          message: 'Holding completely sold and removed from portfolio.' 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      } else {
        const sellTxData: Record<string, any> = {
          asset_id: target_asset_id,
          tx_type: 'SELL',
          quantity: -Math.abs(sellQty),
          price: sellPrice,
          tx_date: new Date().toISOString()
        };
        if (userId) sellTxData.user_id = userId;

        const { data: txData, error: txErr } = await supabaseClient
          .from('transactions')
          .insert(sellTxData)
          .select()
          .single();

        if (txErr) throw txErr;

        return new Response(JSON.stringify({ 
          success: true, 
          fullySold: false, 
          remainingQuantity: currentQty - sellQty,
          transaction: txData 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    }

    // 6. Handle Stock / ETF / MF: buyMore / addHolding
    if (action === 'buyMore' || action === 'addHolding') {
      const buyQty = Number(quantity);
      const buyPrice = Number(price);

      if (isNaN(buyQty) || buyQty <= 0) throw new Error('Quantity must be greater than 0');
      if (isNaN(buyPrice) || buyPrice <= 0) throw new Error('Price must be greater than 0');

      const buyTxData: Record<string, any> = {
        asset_id: target_asset_id,
        tx_type: 'BUY',
        quantity: buyQty,
        price: buyPrice,
        tx_date: new Date().toISOString()
      };
      if (userId) buyTxData.user_id = userId;

      const { data: txData, error: txErr } = await supabaseClient
        .from('transactions')
        .insert(buyTxData)
        .select()
        .single();

      if (txErr) throw txErr;

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Holding purchased successfully', 
        transaction: txData 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    throw new Error('Invalid action provided: ' + action);

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Internal Server Error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
}))
