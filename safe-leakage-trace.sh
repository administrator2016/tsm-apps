#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

echo "============================================================"
echo "TSM RCM — SAFE LEAKAGE SOURCE TRACE"
echo "READ-ONLY / DOES NOT TOUCH RUNNING SERVER"
echo "============================================================"

FILES=(
  "html/healthcare/hc-main-strategist.html"
  "html/healthcare/hc-denial-war-room.html"
  "html/healthcare/executive-portal.html"
  "server/healthcare/portfolio-intelligence.js"
  "server/healthcare/decision-engine.js"
  "server/healthcare/hc-node-contract.js"
  "server/shared/decision-engine-core.js"
  "server/tsm-output-contract.js"
  "html/js/career/tsm-revenue-leakage-career-adapter.js"
)

echo
echo "=== FILES PRESENT ==="

for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    printf 'FOUND  %s\n' "$f"
  else
    printf 'MISS   %s\n' "$f"
  fi
done

echo
echo "============================================================"
echo "1. CLM-0334 REFERENCES"
echo "============================================================"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  matches="$(grep -n -E 'CLM-0334|claimId|claim_id' "$f" 2>/dev/null || true)"

  if [ -n "$matches" ]; then
    echo
    echo "--- $f ---"
    echo "$matches" | head -80
  fi
done

echo
echo "============================================================"
echo "2. FINANCIAL EXPOSURE / LEAKAGE OBJECTS"
echo "============================================================"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  matches="$(grep -n -E \
    'financialExposure|financial_exposure|exposure|revenueLeak|leakage|writeoff|write.off|atRisk|at_risk' \
    "$f" 2>/dev/null || true)"

  if [ -n "$matches" ]; then
    echo
    echo "--- $f ---"
    echo "$matches" | head -120
  fi
done

echo
echo "============================================================"
echo "3. DENIAL / TIMELY FILING / UNDERPAYMENT SIGNALS"
echo "============================================================"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  matches="$(grep -n -E \
    'timely.?filing|appeal.?deadline|underpaid|underpayment|denial|write.?off|variance|CO-29|CO-197|CO-50' \
    "$f" 2>/dev/null || true)"

  if [ -n "$matches" ]; then
    echo
    echo "--- $f ---"
    echo "$matches" | head -160
  fi
done

echo
echo "============================================================"
echo "4. STRUCTURED CASE / OUTPUT CONTRACT"
echo "============================================================"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  matches="$(grep -n -E \
    'structuredCase|buildHCStructuredCase|outputContract|evidenceProvenance|recoveryLikelihood|humanReviewRequired' \
    "$f" 2>/dev/null || true)"

  if [ -n "$matches" ]; then
    echo
    echo "--- $f ---"
    echo "$matches" | head -160
  fi
done

echo
echo "============================================================"
echo "5. API / NODE REPORT CONTRACT REFERENCES"
echo "============================================================"

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  matches="$(grep -n -E \
    '/api/hc|node-report|nodeReport|portfolio|report|claim|exposure' \
    "$f" 2>/dev/null || true)"

  if [ -n "$matches" ]; then
    echo
    echo "--- $f ---"
    echo "$matches" | head -160
  fi
done

echo
echo "============================================================"
echo "6. CAREER ADAPTER SOURCE ASSUMPTIONS"
echo "============================================================"

if [ -f "html/js/career/tsm-revenue-leakage-career-adapter.js" ]; then
  grep -n -E \
    'discoverLeakage|revenueLeakageData|REVENUE_LEAKAGE|TSMRevenueLeakage|leakageData|LEAKAGE_DATA|querySelectorAll|table' \
    "html/js/career/tsm-revenue-leakage-career-adapter.js" \
    | head -200 || true
fi

echo
echo "============================================================"
echo "SAFE TRACE COMPLETE"
echo "NO SERVER REQUESTS WERE MADE"
echo "NO NODE PROCESS WAS STARTED"
echo "============================================================"