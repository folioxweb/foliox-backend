-- ============================================================================
-- FOLIOX / EQUITY DASHBOARD - USEFUL SQL QUERIES (SINGLE-LINE FORMAT)
-- ============================================================================
-- Ready to run directly in Supabase SQL Editor.
-- Every query is strictly on a SINGLE LINE for instant copying and pasting.
-- For date queries, the date is left empty as '' (e.g. ::date = '') so you can
-- simply type your target date (format: 'YYYY-MM-DD').
-- ============================================================================


-- ============================================================================
-- 1. USERS & AUTHENTICATION
-- ============================================================================

-- 1.1 List all registered users
SELECT id, email, created_at, last_sign_in_at FROM auth.users ORDER BY created_at DESC;

-- 1.2 User activity summary (holdings count, watchlist count, virtual paper trades)
SELECT u.email, COUNT(DISTINCT t.asset_id) AS total_holdings, COUNT(DISTINCT w.symbol) AS watchlist_items, COUNT(DISTINCT pt.id) AS paper_trades FROM auth.users u LEFT JOIN transactions t ON t.user_id = u.id LEFT JOIN watchlist_items w ON w.user_id = u.id LEFT JOIN paper_transactions pt ON pt.user_id = u.id GROUP BY u.id, u.email;

-- 1.3 Users who signed in on a specific date (Enter date 'YYYY-MM-DD')
SELECT id, email, last_sign_in_at FROM auth.users WHERE last_sign_in_at::date = '' ORDER BY last_sign_in_at DESC;

-- 1.4 Newly registered users on a specific date (Enter date 'YYYY-MM-DD')
SELECT id, email, created_at FROM auth.users WHERE created_at::date = '' ORDER BY created_at DESC;


-- ============================================================================
-- 2. PORTFOLIO HOLDINGS & SUMMARY
-- ============================================================================

-- 2.1 View full live holdings (Stocks, ETFs, Mutual Funds)
SELECT symbol, name, asset_type, total_quantity, ROUND(avg_price, 2) AS avg_price, ROUND(current_price, 2) AS current_price, ROUND(invested_value, 2) AS invested_value, ROUND(current_value, 2) AS current_value, ROUND(return_abs, 2) AS return_abs, ROUND(return_pct, 2) AS return_pct FROM vw_holdings ORDER BY current_value DESC;

-- 2.2 Holdings filtered by asset type ('STOCK', 'ETF', or 'MF')
SELECT symbol, name, total_quantity, ROUND(current_price, 2) AS current_price, ROUND(current_value, 2) AS current_value, ROUND(return_pct, 2) AS return_pct FROM vw_holdings WHERE asset_type = 'STOCK' ORDER BY current_value DESC;

-- 2.3 Top gainers in portfolio
SELECT symbol, name, ROUND(return_pct, 2) AS return_pct, ROUND(return_abs, 2) AS profit FROM vw_holdings WHERE return_pct > 0 ORDER BY return_pct DESC LIMIT 10;

-- 2.4 Top losers in portfolio
SELECT symbol, name, ROUND(return_pct, 2) AS return_pct, ROUND(return_abs, 2) AS loss FROM vw_holdings WHERE return_pct < 0 ORDER BY return_pct ASC LIMIT 10;

-- 2.5 Overall portfolio summary metrics
SELECT ROUND(total_invested, 2) AS total_invested, ROUND(current_value, 2) AS current_value, ROUND(unrealized_pnl, 2) AS unrealized_pnl, ROUND(return_pct, 2) AS return_pct, ROUND(day_change, 2) AS today_pnl FROM vw_portfolio_summary;

-- 2.6 Sector-wise allocation
SELECT sector, ROUND(allocated_value, 2) AS total_value, ROUND(allocation_pct, 2) AS percentage FROM vw_global_sector_allocation ORDER BY allocated_value DESC;


-- ============================================================================
-- 3. TRANSACTIONS
-- ============================================================================

-- 3.1 Latest 20 transactions across the portfolio
SELECT t.tx_date, a.symbol, a.name, t.tx_type, t.quantity, ROUND(t.price, 2) AS price, ROUND(t.quantity * t.price, 2) AS total_amount, t.user_id FROM transactions t JOIN assets a ON a.asset_id = t.asset_id ORDER BY t.tx_date DESC LIMIT 20;

-- 3.2 All transactions on a specific date (Enter date 'YYYY-MM-DD')
SELECT t.tx_date, a.symbol, a.name, t.tx_type, t.quantity, ROUND(t.price, 2) AS price, ROUND(t.quantity * t.price, 2) AS total_amount, u.email FROM transactions t JOIN assets a ON a.asset_id = t.asset_id LEFT JOIN auth.users u ON u.id = t.user_id WHERE t.tx_date::date = '' ORDER BY t.tx_date DESC;

-- 3.3 Transaction history for a specific stock (e.g. 'TCS' or 'RELIANCE')
SELECT t.tx_date, t.tx_type, t.quantity, ROUND(t.price, 2) AS price, t.tx_id FROM transactions t JOIN assets a ON a.asset_id = t.asset_id WHERE a.symbol = 'TCS' OR a.symbol = 'NSE:TCS' ORDER BY t.tx_date DESC;

-- 3.4 Total buy vs sell count and amounts
SELECT tx_type, COUNT(*) AS total_trades, SUM(quantity) AS total_shares, ROUND(SUM(quantity * price), 2) AS total_volume FROM transactions GROUP BY tx_type;


-- ============================================================================
-- 4. MUTUAL FUNDS & SIPS
-- ============================================================================

-- 4.1 View all active Mutual Fund SIP configurations
SELECT a.name AS fund_name, a.symbol, sip.sip_amount, sip.sip_day AS day_of_month, sip.is_enabled, sip.last_sip_date FROM mf_sip_configs sip JOIN assets a ON a.asset_id = sip.asset_id ORDER BY sip.is_enabled DESC, sip.sip_day ASC;

-- 4.2 Search Mutual Funds from the AMFI Master schemes list
SELECT scheme_code, name, category, nav, nav_date, last_updated FROM mf_schemes WHERE name ILIKE '%Parag Parikh%' OR name ILIKE '%Nifty 50%' ORDER BY name ASC LIMIT 10;

-- 4.3 View top underlying stock holdings inside a Mutual Fund
SELECT a.name AS mutual_fund, fh.company_name AS holding_stock, fh.symbol, fh.sector, fh.allocation_pct FROM fund_holdings fh JOIN assets a ON a.asset_id = fh.fund_asset_id ORDER BY fh.allocation_pct DESC LIMIT 20;

-- 4.4 Indirect exposure to stocks through Mutual Funds
SELECT stock_symbol, stock_name, ROUND(indirect_invested_value, 2) AS indirect_value FROM vw_indirect_exposure ORDER BY indirect_invested_value DESC LIMIT 10;


-- ============================================================================
-- 5. WATCHLIST
-- ============================================================================

-- 5.1 View current Watchlist with price, target, and confidence
SELECT symbol, name, sector, confidence, badge, ROUND(added_price, 2) AS added_price, ROUND(current_price, 2) AS live_price, ROUND(target_price, 2) AS target_price, ROUND(return_since_added_pct, 2) AS return_pct, added_at FROM vw_watchlist ORDER BY added_at DESC;

-- 5.2 Watchlist items that are also in your actual portfolio
SELECT symbol, name, ROUND(current_price, 2) AS current_price, ROUND(target_price, 2) AS target_price, notes FROM vw_watchlist WHERE in_portfolio = true;

-- 5.3 Watchlist stocks closest to target price
SELECT symbol, name, current_price, target_price, ROUND(((target_price - current_price) / current_price) * 100, 2) AS upside_potential_pct FROM vw_watchlist WHERE target_price > current_price ORDER BY upside_potential_pct ASC;

-- 5.4 Watchlist additions on a specific date (Enter date 'YYYY-MM-DD')
SELECT symbol, name, sector, badge, added_price, added_at FROM watchlist_items WHERE added_at::date = '' ORDER BY added_at DESC;


-- ============================================================================
-- 6. PAPER TRADING (VIRTUAL PORTFOLIO)
-- ============================================================================

-- 6.1 Virtual Cash and Realized P&L Summary
SELECT id, ROUND(initial_capital, 2) AS initial_capital, ROUND(current_cash, 2) AS cash_balance, ROUND(realized_pnl, 2) AS realized_pnl, updated_at FROM paper_portfolio_config;

-- 6.2 Active Paper Holdings
SELECT symbol, name, total_quantity, ROUND(avg_price, 2) AS avg_buy_price, ROUND(current_price, 2) AS current_price, ROUND(invested_value, 2) AS invested_value, ROUND(current_value, 2) AS current_value, ROUND(return_pct, 2) AS profit_loss_pct FROM vw_paper_holdings ORDER BY current_value DESC;

-- 6.3 Recent Paper Trades
SELECT pt.tx_date, pa.symbol, pa.name, pt.tx_type, pt.quantity, ROUND(pt.price, 2) AS trade_price, ROUND(pt.realized_gain, 2) AS realized_gain FROM paper_transactions pt JOIN paper_assets pa ON pa.asset_id = pt.asset_id ORDER BY pt.tx_date DESC LIMIT 20;

-- 6.4 Paper Trades executed on a specific date (Enter date 'YYYY-MM-DD')
SELECT pt.tx_date, pa.symbol, pa.name, pt.tx_type, pt.quantity, ROUND(pt.price, 2) AS trade_price, ROUND(pt.realized_gain, 2) AS realized_gain, u.email FROM paper_transactions pt JOIN paper_assets pa ON pa.asset_id = pt.asset_id LEFT JOIN auth.users u ON u.id = pt.user_id WHERE pt.tx_date::date = '' ORDER BY pt.tx_date DESC;


-- ============================================================================
-- 7. IPOS (MAINBOARD & SME)
-- ============================================================================

-- 7.1 View all active and upcoming IPOs
SELECT ipo_name, category, status, price_str, ipo_size, open_date, close_date, listing_date, gmp_amount, ROUND(gmp_percent, 2) AS gmp_percent FROM mainboard_ipos ORDER BY open_date DESC LIMIT 20;

-- 7.2 Top IPOs by Grey Market Premium (GMP %)
SELECT ipo_name, category, status, price_str, gmp_amount, ROUND(gmp_percent, 2) AS gmp_percent, updated_on_text FROM mainboard_ipos WHERE gmp_percent IS NOT NULL ORDER BY gmp_percent DESC LIMIT 10;

-- 7.3 GMP History / Trend for a specific IPO
SELECT h.recorded_date, h.gmp, m.ipo_name FROM ipo_gmp_history h JOIN mainboard_ipos m ON m.id = h.ipo_id WHERE m.ipo_name ILIKE '%Tata%' OR m.id = 1 ORDER BY h.recorded_date DESC;

-- 7.4 Log of sent IPO email alerts
SELECT ipo_name, alert_type, ROUND(gmp_percent, 2) AS gmp_pct, recipient_count, sent_status, error_message, created_at FROM ipo_email_alerts ORDER BY created_at DESC LIMIT 20;

-- 7.5 IPO email alerts sent on a specific date (Enter date 'YYYY-MM-DD')
SELECT ipo_name, alert_type, recipient_count, sent_status, error_message, created_at FROM ipo_email_alerts WHERE created_at::date = '' ORDER BY created_at DESC;


-- ============================================================================
-- 8. MARKET NEWS & BSE ANNOUNCEMENTS
-- ============================================================================

-- 8.1 Latest market news
SELECT title, source, published_at, url FROM news ORDER BY published_at DESC LIMIT 20;

-- 8.2 News ingested on a specific date (Enter date 'YYYY-MM-DD')
SELECT title, source, published_at, created_at FROM news WHERE created_at::date = '' ORDER BY created_at DESC;

-- 8.3 News specifically matching your portfolio assets
SELECT symbol, title, source, published_at FROM vw_user_news ORDER BY published_at DESC LIMIT 20;

-- 8.4 Recent corporate announcements and filings (BSE)
SELECT company, symbol, title, document_type, ai_status, announcement_date, pdf_url FROM company_documents ORDER BY announcement_date DESC, created_at DESC LIMIT 20;

-- 8.5 BSE announcements ingested on a specific date (Enter date 'YYYY-MM-DD')
SELECT company, symbol, title, document_type, ai_status, announcement_date, created_at FROM company_documents WHERE created_at::date = '' ORDER BY created_at DESC;

-- 8.6 Announcements with AI research summaries completed
SELECT company, symbol, title, ai_model, ai_summary_json ->> 'sentiment' AS sentiment, ai_summary_json ->> 'summary' AS executive_summary, created_at FROM company_documents WHERE ai_status = 'COMPLETED' ORDER BY created_at DESC LIMIT 5;


-- ============================================================================
-- 9. NSE STOCKS & ETFS MASTER
-- ============================================================================

-- 9.1 Search listed stocks or ETFs
SELECT symbol, name, isin, series, sector, last_updated FROM nse_stocks WHERE symbol ILIKE 'HDFC%' OR name ILIKE '%Reliance%' ORDER BY symbol ASC LIMIT 10;

-- 9.2 Count of listed Stocks vs ETFs
SELECT series, COUNT(*) AS total_securities FROM nse_stocks GROUP BY series;


-- ============================================================================
-- 10. SYSTEM EXECUTION LOGS (EDGE FUNCTIONS MONITORING)
-- ============================================================================

-- 10.1 Latest 25 executions across all functions and crons
SELECT id, function_name, caller_type, response_status, status, duration_ms, user_email, created_at FROM system_execution_logs ORDER BY id DESC LIMIT 25;

-- 10.2 Executions of a SPECIFIC function on a SPECIFIC date (Enter date 'YYYY-MM-DD' & function name)
SELECT id, function_name, caller_type, response_status, status, duration_ms, user_email, created_at, error_message FROM system_execution_logs WHERE function_name = 'sync-prices' AND created_at::date = '' ORDER BY id DESC;

-- 10.3 All Edge Function errors on a specific date (Enter date 'YYYY-MM-DD')
SELECT id, function_name, caller_type, response_status, error_message, request_payload, created_at FROM system_execution_logs WHERE (status = 'FAILED' OR response_status >= 400) AND created_at::date = '' ORDER BY id DESC;

-- 10.4 Daily function performance & error breakdown for a specific date (Enter date 'YYYY-MM-DD')
SELECT function_name, COUNT(*) AS total_runs, COUNT(*) FILTER (WHERE status = 'SUCCESS') AS success_runs, COUNT(*) FILTER (WHERE status = 'FAILED' OR response_status >= 400) AS failed_runs, ROUND(AVG(duration_ms)) AS avg_duration_ms, MAX(duration_ms) AS max_duration_ms FROM system_execution_logs WHERE created_at::date = '' GROUP BY function_name ORDER BY total_runs DESC;

-- 10.5 Slowest function executions overall (performance inspection)
SELECT function_name, caller_type, duration_ms, status, created_at FROM system_execution_logs ORDER BY duration_ms DESC LIMIT 15;


-- ============================================================================
-- 11. USER AUDIT TRAIL (STATE & FINANCIAL MUTATIONS)
-- ============================================================================

-- 11.1 Recent user actions across the platform
SELECT id, action, category, entity_type, entity_id, user_email, created_at FROM user_audit_logs ORDER BY id DESC LIMIT 25;

-- 11.2 All user audit logs on a specific date (Enter date 'YYYY-MM-DD')
SELECT id, action, category, entity_type, entity_id, user_email, created_at, old_state, new_state FROM user_audit_logs WHERE created_at::date = '' ORDER BY id DESC;

-- 11.3 Audit logs for a specific user on a specific date (Enter date 'YYYY-MM-DD')
SELECT id, action, entity_type, entity_id, old_state, new_state, created_at FROM user_audit_logs WHERE user_email = 'parthdeshmukh291@gmail.com' AND created_at::date = '' ORDER BY id DESC;

-- 11.4 Audit logs filtered by category ('PORTFOLIO', 'WATCHLIST', 'PAPER_TRADE') on a date (Enter date 'YYYY-MM-DD')
SELECT action, entity_type, entity_id, user_email, created_at, old_state, new_state FROM user_audit_logs WHERE category = 'PORTFOLIO' AND created_at::date = '' ORDER BY id DESC;


-- ============================================================================
-- 12. PG_CRON SCHEDULED JOBS & EXECUTION MONITORING
-- ============================================================================

-- 12.1 View all active scheduled cron jobs and schedules
SELECT jobid, jobname, schedule, active, command FROM cron.job ORDER BY jobid ASC;

-- 12.2 ALL cron runs on a specific date (Enter date 'YYYY-MM-DD')
SELECT d.runid, j.jobname, d.status, d.return_message, d.start_time, d.end_time, (d.end_time - d.start_time) AS duration FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE d.start_time::date = '' ORDER BY d.start_time DESC;

-- 12.3 Runs of a SPECIFIC CRON on a SPECIFIC date (Enter date 'YYYY-MM-DD' & cron jobname)
SELECT d.runid, j.jobname, d.status, d.return_message, d.start_time, d.end_time, (d.end_time - d.start_time) AS duration FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = 'sync-prices' AND d.start_time::date = '' ORDER BY d.start_time DESC;

-- 12.4 All cron FAILURES on a specific date (Enter date 'YYYY-MM-DD')
SELECT d.runid, j.jobname, d.status, d.return_message, d.start_time, d.end_time FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE d.status != 'succeeded' AND d.start_time::date = '' ORDER BY d.start_time DESC;

-- 12.5 Daily summary per cron job for a specific date: total runs, successes, failures (Enter date 'YYYY-MM-DD')
SELECT j.jobname, COUNT(*) AS total_runs, COUNT(*) FILTER (WHERE d.status = 'succeeded') AS succeeded, COUNT(*) FILTER (WHERE d.status != 'succeeded') AS failed, MIN(d.start_time) AS first_run, MAX(d.start_time) AS last_run FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE d.start_time::date = '' GROUP BY j.jobname ORDER BY total_runs DESC;


-- ============================================================================
-- 13. DATA FRESHNESS & HEALTH CHECKS
-- ============================================================================

-- 13.1 Current database time in UTC and IST
SELECT NOW() AS current_utc, NOW() AT TIME ZONE 'Asia/Kolkata' AS current_ist;

-- 13.2 Stock & ETF price freshness (see which securities haven't been updated recently)
SELECT symbol, name, asset_type, current_price, last_updated FROM assets ORDER BY last_updated ASC LIMIT 25;

-- 13.3 Mutual Fund NAV freshness (see oldest updated funds)
SELECT scheme_code, name, nav, nav_date, last_updated FROM mf_schemes ORDER BY last_updated ASC LIMIT 25;

-- 13.4 Approximate row counts across all platform tables
SELECT relname AS table_name, n_live_tup AS estimated_rows FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
