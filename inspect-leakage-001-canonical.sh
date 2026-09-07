#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

ADAPTER="html/js/career/tsm-revenue-leakage-career-adapter.js"
CONTRACT="server/healthcare/revenue-leakage-contract.js"
PORTFOLIO="server/healthcare/portfolio-intelligence.js"

echo "============================================================"
echo "TSM — LEAKAGE-001 CANONICAL SOURCE INSPECTION"
echo "============================================================"
echo

echo "=== 1. FILE EXISTENCE ==="
for f in "$ADAPTER" "$CONTRACT" "$PORTFOLIO"; do
  if [[ -f "$f" ]]; then
    echo "PASS: $f"
  else
    echo "FAIL: missing $f"
    exit 1
  fi
done

echo
echo "=== 2. LEAKAGE ADAPTER — PUBLIC CONTRACT ==="
grep -nE \
  "LEAKAGE-001|SCENARIO|discoverLeakage|score|recordResult|window\.TSMRevenue|RevenueLeakage|revenueLeakage|LEAKAGE_DATA|leakageData" \
  "$ADAPTER" || true

echo
echo "=== 3. LEAKAGE ADAPTER — DEMO / SNAPSHOT REFERENCES ==="
grep -nEi \
  "honorhealth-revenue-leak-snapshot|revenue-leak-snapshot|demo|sample|benchmark|48K|2\.8M|18\.4%" \
  "$ADAPTER" || true

echo
echo "=== 4. LEAKAGE ADAPTER — DISCOVERY FUNCTION ==="
python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text()

m = re.search(
    r'function\s+discoverLeakage\s*\([^)]*\)\s*\{',
    s
)

if not m:
    print("WARN: discoverLeakage() not found")
    sys.exit(0)

start = m.start()
brace = s.find("{", m.start())
depth = 0
end = None

for i in range(brace, len(s)):
    if s[i] == "{":
        depth += 1
    elif s[i] == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break

print(s[start:end])
PY

echo
echo "=== 5. CANONICAL CONTRACT EXPORTS ==="
grep -nE \
  "module\.exports|buildRevenueLeakageOpportunities|buildRevenueLeakageSummary|normalizeOpportunity|function number|function ageDays" \
  "$CONTRACT" || true

echo
echo "=== 6. PORTFOLIO INTELLIGENCE LEAKAGE BOUNDARY ==="
grep -nE \
  "revenue-leakage-contract|buildRevenueLeakageOpportunities|buildRevenueLeakageSummary|leakageOpportunities|leakageSummary" \
  "$PORTFOLIO" || true

echo
echo "=== 7. POSSIBLE RUNTIME PORTFOLIO PRODUCERS ==="
grep -RInE \
  "buildPortfolioTwin\(|portfolioTwin|leakageOpportunities|agedAccounts|denial_exception_items|appeal_pipeline_items|ar_aging_items" \
  server html \
  --exclude-dir=node_modules \
  --exclude='*.min.js' \
  2>/dev/null | head -n 250 || true

echo
echo "=== 8. EXISTING LEAKAGE CAREER REFERENCES ==="
grep -RInE \
  "LEAKAGE-001|TSMRevenueLeakageCareer|revenue-leakage-career-adapter|discoverLeakage" \
  html server scripts tests \
  --exclude-dir=node_modules \
  2>/dev/null | head -n 250 || true

echo
echo "=== 9. DEMO SNAPSHOT REFERENCES OUTSIDE THE SNAPSHOT ITSELF ==="
grep -RInE \
  "honorhealth-revenue-leak-snapshot|revenue-leak-snapshot" \
  html/js html/healthcare html/tsm-career-training-platform.html server scripts tests \
  --exclude-dir=node_modules \
  2>/dev/null | head -n 250 || true

echo
echo "=== 10. HARD-CODED LEAKAGE KPI REFERENCES ==="
grep -RInE \
  "Revenue at Risk|48K|2\.8M|18\.4%|write.?off risk|revenue leakage" \
  html/healthcare/hc-main-strategist.html \
  html/js/career \
  server/healthcare \
  2>/dev/null | head -n 250 || true

echo
echo "=== 11. SYNTAX ==="
node --check "$ADAPTER"
echo "PASS: leakage adapter syntax"

node --check "$CONTRACT"
echo "PASS: leakage contract syntax"

node --check "$PORTFOLIO"
echo "PASS: portfolio intelligence syntax"

echo
echo "=== 12. DIFF CHECK ==="
git diff --check
echo "PASS: git diff --check"

echo
echo "============================================================"
echo "INSPECTION COMPLETE"
echo "NO FILES MODIFIED"
echo "NO SERVER START"
echo "NO LOCALHOST REQUESTS"
echo "NO LEAKAGE-001 WIRING"
echo "============================================================"