-- 031_remove_exchange_prefix_from_symbols.sql
-- Standardizes all asset, watchlist, paper trade, and document symbols to clean tickers by stripping 'NSE:' and 'BSE:' prefixes.

-- 1. ASSETS TABLE CLEANUP & MERGING
DO $$
DECLARE
    rec RECORD;
    v_clean_symbol TEXT;
    v_existing_asset_id UUID;
BEGIN
    FOR rec IN 
        SELECT asset_id, symbol 
        FROM assets 
        WHERE symbol ILIKE 'NSE:%' OR symbol ILIKE 'BSE:%'
    LOOP
        v_clean_symbol := REGEXP_REPLACE(rec.symbol, '^(NSE|BSE):', '', 'i');
        
        -- Check if an asset with the clean symbol already exists
        SELECT asset_id INTO v_existing_asset_id
        FROM assets
        WHERE symbol = v_clean_symbol
        LIMIT 1;
        
        IF v_existing_asset_id IS NOT NULL AND v_existing_asset_id <> rec.asset_id THEN
            -- Re-point transactions to the existing clean asset (user_id is preserved)
            UPDATE transactions 
            SET asset_id = v_existing_asset_id 
            WHERE asset_id = rec.asset_id;
            
            -- Re-point company_documents to the existing clean asset
            UPDATE company_documents
            SET asset_id = v_existing_asset_id, symbol = v_clean_symbol
            WHERE asset_id = rec.asset_id;
            
            -- Re-point fund_holdings if any
            UPDATE fund_holdings
            SET fund_asset_id = v_existing_asset_id
            WHERE fund_asset_id = rec.asset_id;
            
            -- Re-point mf_sip_configs if any
            UPDATE mf_sip_configs
            SET asset_id = v_existing_asset_id
            WHERE asset_id = rec.asset_id;

            -- Re-point news if any
            UPDATE news
            SET asset_id = v_existing_asset_id
            WHERE asset_id = rec.asset_id;

            -- Remove the redundant duplicate prefixed asset
            DELETE FROM assets WHERE asset_id = rec.asset_id;
        ELSE
            -- No conflict; simply rename the symbol to clean ticker
            UPDATE assets
            SET symbol = v_clean_symbol
            WHERE asset_id = rec.asset_id;
        END IF;
    END LOOP;
END $$;

-- 2. WATCHLIST ITEMS CLEANUP & MERGING
DO $$
DECLARE
    w_rec RECORD;
    v_clean_w_symbol TEXT;
    v_exists BOOLEAN;
BEGIN
    FOR w_rec IN 
        SELECT id, user_id, symbol 
        FROM watchlist_items 
        WHERE symbol ILIKE 'NSE:%' OR symbol ILIKE 'BSE:%'
    LOOP
        v_clean_w_symbol := REGEXP_REPLACE(w_rec.symbol, '^(NSE|BSE):', '', 'i');
        
        -- Check if user already has the clean symbol in watchlist
        SELECT EXISTS (
            SELECT 1 FROM watchlist_items 
            WHERE (user_id = w_rec.user_id OR (user_id IS NULL AND w_rec.user_id IS NULL))
              AND symbol = v_clean_w_symbol
              AND id <> w_rec.id
        ) INTO v_exists;
        
        IF v_exists THEN
            DELETE FROM watchlist_items WHERE id = w_rec.id;
        ELSE
            UPDATE watchlist_items 
            SET symbol = v_clean_w_symbol 
            WHERE id = w_rec.id;
        END IF;
    END LOOP;
END $$;

-- 3. PAPER ASSETS CLEANUP & MERGING
DO $$
DECLARE
    p_rec RECORD;
    v_clean_p_symbol TEXT;
    v_exists BOOLEAN;
BEGIN
    FOR p_rec IN 
        SELECT id, user_id, symbol 
        FROM paper_assets 
        WHERE symbol ILIKE 'NSE:%' OR symbol ILIKE 'BSE:%'
    LOOP
        v_clean_p_symbol := REGEXP_REPLACE(p_rec.symbol, '^(NSE|BSE):', '', 'i');
        
        SELECT EXISTS (
            SELECT 1 FROM paper_assets 
            WHERE (user_id = p_rec.user_id OR (user_id IS NULL AND p_rec.user_id IS NULL))
              AND symbol = v_clean_p_symbol
              AND id <> p_rec.id
        ) INTO v_exists;
        
        IF v_exists THEN
            DELETE FROM paper_assets WHERE id = p_rec.id;
        ELSE
            UPDATE paper_assets 
            SET symbol = v_clean_p_symbol 
            WHERE id = p_rec.id;
        END IF;
    END LOOP;
END $$;

-- 4. PAPER TRANSACTIONS CLEANUP
UPDATE paper_transactions
SET symbol = REGEXP_REPLACE(symbol, '^(NSE|BSE):', '', 'i')
WHERE symbol ILIKE 'NSE:%' OR symbol ILIKE 'BSE:%';

-- 5. COMPANY DOCUMENTS CLEANUP
UPDATE company_documents
SET symbol = REGEXP_REPLACE(symbol, '^(NSE|BSE):', '', 'i')
WHERE symbol ILIKE 'NSE:%' OR symbol ILIKE 'BSE:%';
