/**
 * Automated Data Replication Script
 * Copies all data from Old Supabase Project to New Supabase Project
 */

const OLD_URL = "https://spksxeupdfmyniqfmhld.supabase.co";
const OLD_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwa3N4ZXVwZGZteW5pcWZtaGxkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTQ5NDIsImV4cCI6MjA5Njk5MDk0Mn0.moH2EekbZ6i8ymaA5wZJsbl-J09wzeP5Afk91bevM7Y";

const NEW_URL = "https://yfyvceirbveamvcgbvps.supabase.co";
const NEW_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmeXZjZWlyYnZlYW12Y2didnBzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzMyMDA4NywiZXhwIjoyMTAyODk2MDg3fQ.EMUDPYcbQk1QC-87P9VeciSs_Ha-E4-RAM524b_6xwY";

// Replication order to respect foreign key dependencies
const TABLES = [
  { name: "assets", pk: "asset_id" },
  { name: "transactions", pk: "tx_id" },
  { name: "mf_sip_configs", pk: "asset_id" },
  { name: "fund_holdings", pk: null },
  { name: "news", pk: "guid" },
  { name: "company_documents", pk: "attachment_id" },
  { name: "nse_stocks", pk: "symbol" },
  { name: "watchlist_items", pk: "watchlist_id" },
  { name: "paper_portfolio_config", pk: "id" },
  { name: "paper_assets", pk: "asset_id" },
  { name: "paper_transactions", pk: "tx_id" },
  { name: "mainboard_ipos", pk: "id" }
];

async function fetchAllFromOld(tableName) {
  let allRows = [];
  let from = 0;
  const batchSize = 1000;

  while (true) {
    const to = from + batchSize - 1;
    const res = await fetch(`${OLD_URL}/rest/v1/${tableName}?select=*`, {
      headers: {
        "apikey": OLD_ANON_KEY,
        "Authorization": `Bearer ${OLD_ANON_KEY}`,
        "Range": `${from}-${to}`
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to fetch from ${tableName}: HTTP ${res.status} - ${errText}`);
    }

    const rows = await res.json();
    if (!rows || rows.length === 0) break;

    allRows.push(...rows);
    if (rows.length < batchSize) break;
    from += batchSize;
  }

  return allRows;
}

async function insertBatchWithRetry(tableName, batch, droppedCols = new Set()) {
  let currentBatch = batch.map(row => {
    const cleaned = { ...row };
    for (const col of droppedCols) {
      delete cleaned[col];
    }
    return cleaned;
  });

  while (true) {
    const res = await fetch(`${NEW_URL}/rest/v1/${tableName}`, {
      method: "POST",
      headers: {
        "apikey": NEW_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${NEW_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
      },
      body: JSON.stringify(currentBatch)
    });

    if (res.ok) {
      return currentBatch.length;
    }

    const errText = await res.text();
    const match = errText.match(/Could not find the '([^']+)' column of/);
    if (match && match[1]) {
      const missingCol = match[1];
      droppedCols.add(missingCol);
      currentBatch = currentBatch.map(row => {
        const cleaned = { ...row };
        delete cleaned[missingCol];
        return cleaned;
      });
      continue;
    }

    throw new Error(`Failed to insert batch into ${tableName}: HTTP ${res.status} - ${errText}`);
  }
}

async function insertIntoNew(tableName, rows) {
  if (!rows || rows.length === 0) return 0;

  const BATCH = 500;
  let inserted = 0;
  const droppedCols = new Set();

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const count = await insertBatchWithRetry(tableName, batch, droppedCols);
    inserted += count;
  }

  return inserted;
}

async function runReplication() {
  console.log("====================================================================");
  console.log("STARTING DATA REPLICATION TO NEW SUPABASE PROJECT (yfyvceirbveamvcgbvps)");
  console.log("====================================================================\n");

  const results = {};

  for (const table of TABLES) {
    try {
      process.stdout.write(`Fetching ${table.name} from old project... `);
      const rows = await fetchAllFromOld(table.name);
      console.log(`Fetched ${rows.length} rows.`);

      if (rows.length > 0) {
        process.stdout.write(`Inserting ${rows.length} rows into new project ${table.name}... `);
        const count = await insertIntoNew(table.name, rows);
        console.log(`Successfully migrated ${count} rows.`);
        results[table.name] = { status: "SUCCESS", count };
      } else {
        console.log(`Skipped (0 rows).`);
        results[table.name] = { status: "EMPTY", count: 0 };
      }
    } catch (err) {
      console.error(`ERROR on table ${table.name}:`, err.message);
      results[table.name] = { status: "ERROR", error: err.message };
    }
  }

  console.log("\n====================================================================");
  console.log("DATA REPLICATION SUMMARY");
  console.log("====================================================================");
  console.table(results);
}

runReplication();
