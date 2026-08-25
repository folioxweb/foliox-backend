# 🚀 FolioX - Complete Dual-Environment Deployment Guide (PROD & UAT)

This document details the complete dual-environment architecture, CI/CD pipelines, database sync, and day-to-day release workflow for **FolioX**.

---

## 📑 1. Environment Architecture & Endpoints

| Resource / Property | 🚀 Production Environment (`PROD`) | 🧪 Staging Environment (`UAT`) |
| :--- | :--- | :--- |
| **Frontend Live URL** | [https://folioxweb.github.io/foliox/](https://folioxweb.github.io/foliox/) | [https://folioxweb.github.io/foliox/uat/](https://folioxweb.github.io/foliox/uat/) |
| **Frontend Branch** | `main` | `uat` |
| **Frontend Build Base** | `/foliox/` | `/foliox/uat/` |
| **Frontend Config File** | `.env.production` | `.env.uat` |
| **Backend Repo Branch** | `main` | `uat` |
| **Supabase Project Ref** | `yfyvceirbveamvcgbvps` | `auflgeottunktfkwakab` |
| **Supabase Region** | `aws-0-ap-southeast-1` (Singapore) | `aws-0-ap-south-1` (Mumbai) |
| **Supabase DB Pooler** | `aws-0-ap-southeast-1.pooler.supabase.com:6543` | `aws-0-ap-south-1.pooler.supabase.com:6543` |
| **Data Scope** | Real user portfolios & live trades | Sandbox test data (isolated) |

---

## 📁 2. GitHub Repositories & Branch Structure

### 🌐 A. Frontend Repository: [`folioxweb/foliox`](https://github.com/folioxweb/foliox.git)
- **`uat` branch**: Connected to UAT Supabase (`auflgeottunktfkwakab`). Automatically builds and deploys to the `/uat/` subfolder on GitHub Pages.
- **`main` branch**: Connected to PROD Supabase (`yfyvceirbveamvcgbvps`). Automatically builds and deploys to the root `/` on GitHub Pages.
- **`gh-pages` branch**: Serves both builds side-by-side using GitHub Pages.

### 🗄️ B. Backend Repository: [`folioxweb/foliox-backend`](https://github.com/folioxweb/foliox-backend.git)
- **`uat` branch**: Runs database migrations and deploys all 12 Edge Functions to UAT Supabase.
- **`main` branch**: Runs database migrations and deploys all 12 Edge Functions to PROD Supabase.

---

## 🔄 3. Daily Development & Release Workflow

```
                        ┌─────────────────────────────────────────────────────────┐
                        │                 STEP 1: DEVELOP LOCALLY                 │
                        │   1. Checkout `uat` branch in VS Code                   │
                        │   2. Test locally using: `npm run dev`                  │
                        └─────────────────────────────────────────────────────────┘
                                                     │
                                             (git push origin uat)
                                                     │
                                                     ▼
     ┌─────────────────────────────────────────────────────────────────────────────────────────┐
     │                            STEP 2: AUTOMATIC UAT DEPLOYMENT                             │
     ├────────────────────────────────────────────┬────────────────────────────────────────────┤
     │  🌐 Frontend GitHub Action:                │  🗄️ Backend GitHub Action:                 │
     │  • Triggers on `uat` push                  │  • Triggers on `uat` push                  │
     │  • Builds with `npm run build:uat`         │  • Applies new migrations to UAT DB        │
     │  • Deploys to:                             │  • Deploys 12 Edge Functions to:           │
     │    https://folioxweb.github.io/foliox/uat/ │    UAT Project (`auflgeottunktfkwakab`)    │
     └────────────────────────────────────────────┴────────────────────────────────────────────┘
                                                     │
                                                     ▼
                        ┌─────────────────────────────────────────────────────────┐
                        │                 STEP 3: QA & VERIFICATION               │
                        │   1. Open: https://folioxweb.github.io/foliox/uat/      │
                        │   2. Test new features, trades & UI risk-free           │
                        └─────────────────────────────────────────────────────────┘
                                                     │
                                      (Features verified & ready?)
                                                     │
                                                     ▼
                        ┌─────────────────────────────────────────────────────────┐
                        │              STEP 4: CREATE PULL REQUEST (PR)           │
                        │   1. Go to GitHub: folioxweb/foliox (and backend repo)  │
                        │   2. Open Pull Request: `uat` ──► `main`                │
                        │   3. Review code diffs and click "Merge Pull Request"   │
                        └─────────────────────────────────────────────────────────┘
                                                     │
                                                     ▼
     ┌─────────────────────────────────────────────────────────────────────────────────────────┐
     │                         STEP 5: AUTOMATIC PRODUCTION RELEASE                            │
     ├────────────────────────────────────────────┬────────────────────────────────────────────┤
     │  🌐 Frontend GitHub Action:                │  🗄️ Backend GitHub Action:                 │
     │  • Triggers on `main` merge                │  • Triggers on `main` merge                │
     │  • Builds with `npm run build:prod`        │  • Applies new migrations to PROD DB       │
     │  • Deploys to:                             │  • Deploys 12 Edge Functions to:           │
     │    https://folioxweb.github.io/foliox/     │    PROD Project (`yfyvceirbveamvcgbvps`)   │
     └────────────────────────────────────────────┴────────────────────────────────────────────┘
```

---

## ⚙️ 4. GitHub Actions CI/CD Configuration

### 🌐 Frontend Workflow: `.github/workflows/deploy-gh-pages.yml`
```yaml
name: Deploy Frontend to GitHub Pages

on:
  push:
    branches:
      - main
      - uat
  workflow_dispatch:

permissions:
  contents: write

jobs:
  deploy:
    name: Build & Deploy to GitHub Pages
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Build Application
        run: |
          if [ "${{ github.ref_name }}" = "uat" ]; then
            echo "🏗️ Building for UAT Environment (/foliox/uat/)"
            npm run build:uat
          else
            echo "🚀 Building for PRODUCTION Environment (/foliox/)"
            npm run build:prod
          fi

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          destination_dir: ${{ github.ref_name == 'uat' && 'uat' || '' }}
          keep_files: true
```

---

### 🗄️ Backend Workflow: `.github/workflows/deploy-supabase.yml`
```yaml
name: Deploy Supabase Backend (CI/CD)

on:
  push:
    branches:
      - main
      - uat
  workflow_dispatch:

jobs:
  deploy:
    name: Deploy Migrations & Edge Functions
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Configure Target Environment
        id: env-config
        run: |
          if [ "${{ github.ref_name }}" = "main" ]; then
            echo "Environment: PRODUCTION"
            TARGET_PROJECT="${{ secrets.SUPABASE_PROD_PROJECT_ID }}"
            TARGET_DB_PASS="${{ secrets.SUPABASE_PROD_DB_PASSWORD }}"
            TARGET_DB_URL="postgresql://postgres.${TARGET_PROJECT}:${TARGET_DB_PASS}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres"
          else
            echo "Environment: UAT / STAGING"
            TARGET_PROJECT="${{ secrets.SUPABASE_UAT_PROJECT_ID }}"
            TARGET_DB_PASS="${{ secrets.SUPABASE_UAT_DB_PASSWORD }}"
            TARGET_DB_URL="postgresql://postgres.${TARGET_PROJECT}:${TARGET_DB_PASS}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres"
          fi
          echo "PROJECT_ID=$TARGET_PROJECT" >> $GITHUB_ENV
          echo "DB_URL=$TARGET_DB_URL" >> $GITHUB_ENV

      - name: Push Database Migrations
        run: |
          supabase db push --include-all --db-url "$DB_URL"

      - name: Deploy All Edge Functions
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
        run: |
          supabase functions deploy --project-ref "$PROJECT_ID" --no-verify-jwt
```

---

## 🔑 5. Required GitHub Repository Secrets

Configure the following secrets in **Backend GitHub Repo $\rightarrow$ Settings $\rightarrow$ Secrets and variables $\rightarrow$ Actions**:

| Secret Name | Description | Value / Example |
| :--- | :--- | :--- |
| `SUPABASE_ACCESS_TOKEN` | Personal Supabase CLI Access Token | `sbp_fc3b17a4821c...` |
| `SUPABASE_PROD_PROJECT_ID` | Production Supabase Project Ref | `yfyvceirbveamvcgbvps` |
| `SUPABASE_PROD_DB_PASSWORD` | Production PostgreSQL Database Password | `Vrindavan@1911` |
| `SUPABASE_UAT_PROJECT_ID` | UAT Supabase Project Ref | `auflgeottunktfkwakab` |
| `SUPABASE_UAT_DB_PASSWORD` | UAT PostgreSQL Database Password | `Vrindavan@1911` |

---

## 📦 6. On-Demand Data Snapshotting (PROD $\rightarrow$ UAT)

To re-seed or snapshot all live data from PROD into UAT at any point in time:
1. Open the backend repository folder: `equity-dashboard-backend-supabase-uat/`
2. Run the automated exporter:
   ```bash
   node export_prod_data_to_sql.js
   ```
3. Run the import into UAT:
   ```bash
   node -e '
   import { Client } from "pg";
   import fs from "fs";
   const client = new Client({ connectionString: "postgresql://postgres.auflgeottunktfkwakab:Vrindavan@1911@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" });
   await client.connect();
   await client.query(fs.readFileSync("migrate_data_to_uat.sql", "utf-8"));
   console.log("Data snapshot applied to UAT successfully!");
   await client.end();
   '
   ```
   *(Or copy the contents of `migrate_data_to_uat.sql` into **Supabase UAT Dashboard $\rightarrow$ SQL Editor** and click Run).*

---

## 🔧 7. Troubleshooting & FAQ

### Q: Why do we connect through regional poolers in CI/CD?
GitHub Actions runners use IPv6 by default. Supabase direct connections (`db.<ref>.supabase.co:5432`) may fail with `ECONNREFUSED` over IPv6. Connecting via `<region>.pooler.supabase.com:6543` handles both IPv4 and IPv6 seamlessly.

### Q: How does Single Page App (SPA) routing work on GitHub Pages?
GitHub Pages has a single global `404.html`. Our `404.html` script detects if the URL starts with `/foliox/uat/` and retains 2 path segments (`/foliox/uat`), routing requests to `/foliox/uat/index.html` without colliding with `/foliox/`.
