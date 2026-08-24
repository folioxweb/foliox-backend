#!/bin/bash
# ============================================================================
# deploy_all_functions.sh
# Deploys all 11 Edge Functions from UAT backend to the UAT Supabase Project
# ============================================================================

PROJECT_REF="yfyvceirbveamvcgbvps"

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "======================================================================"
  echo "Supabase Access Token is required to deploy Edge Functions via CLI."
  echo "Generate your token at: https://supabase.com/dashboard/account/tokens"
  echo "======================================================================"
  echo "Usage:"
  echo "  export SUPABASE_ACCESS_TOKEN=\"sbp_your_personal_access_token\""
  echo "  ./deploy_all_functions.sh"
  echo "======================================================================"
  exit 1
fi

FUNCTIONS=(
  "execute-trade"
  "generate-ai-summary"
  "get-stock-chart"
  "process-voice-query"
  "sync-bse-docs"
  "sync-fund-holdings"
  "sync-ipos"
  "sync-mfs"
  "sync-mf-master"
  "sync-news"
  "sync-nse-stocks"
  "sync-prices"
)

echo "Deploying 12 Edge Functions to UAT Project [$PROJECT_REF]..."

for fn in "${FUNCTIONS[@]}"; do
  echo "----------------------------------------------------"
  echo "🚀 Deploying function: $fn"
  echo "----------------------------------------------------"
  npx supabase functions deploy "$fn" --project-ref "$PROJECT_REF" --no-verify-jwt
done

echo ""
echo "✅ All functions deployed successfully to project $PROJECT_REF!"
