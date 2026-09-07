#!/usr/bin/env bash
set -u

echo "============================================================"
echo "TSM RCM CAREER COMMAND — PRE-BUILD AUDIT"
echo "============================================================"
echo "ROOT=$(pwd)"
echo

FILES=(
  "html/tsm-career-training-platform.html"
  "html/finops-suite/crcr-study-mode.html"
  "html/healthcare/crcr-scenarios.html"
  "html/healthcare/crc-hc-exam.html"
  "html/healthcare/crc-hc-practice.html"
  "html/healthcare/hc-denial-war-room.html"
  "html/healthcare/hc-financial/index.html"
  "html/healthcare/hc-anomaly-advisor.html"
  "html/js/core/tsm-war-room-registry.js"
  "honorhealth-revenue-leak-snapshot.html"
)

echo "=== FILE EXISTENCE ==="
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    printf "FOUND    %s\n" "$f"
  else
    printf "MISSING  %s\n" "$f"
  fi
done

echo
echo "=== CAREER PLATFORM STATE / MODULE HOOKS ==="
grep -nE \
  "localStorage|sessionStorage|crcr_state|mastery|progress|streak|Interview|A\\+|MLO|module|track" \
  html/tsm-career-training-platform.html 2>/dev/null \
  | head -250

echo
echo "=== CRCR STATE USAGE ==="
grep -RniE \
  "crcr_state|localStorage|sessionStorage|mastery|progress|score" \
  html/finops-suite/crcr-study-mode.html \
  html/healthcare/crcr-scenarios.html \
  html/healthcare/crc-hc-exam.html \
  html/healthcare/crc-hc-practice.html \
  2>/dev/null \
  | head -300

echo
echo "=== DENIAL WAR ROOM ENGINES / OUTPUTS ==="
grep -nE \
  "runPipeline|Engine 0|Engine 1|Engine 2|Engine 3|Engine 4|Engine 5|RECOVERY|LIKELIHOOD|localStorage|sessionStorage|fetch\\(" \
  html/healthcare/hc-denial-war-room.html 2>/dev/null \
  | head -300

echo
echo "=== HC FINANCIAL / A-R EXISTING CAPABILITIES ==="
grep -nEi \
  "AR Aging|A/R|accounts receivable|aging|recovery|leak|underpay|write.?off|priority" \
  html/healthcare/hc-financial/index.html 2>/dev/null \
  | head -250

echo
echo "=== REVENUE LEAKAGE ==="
grep -nEi \
  "revenue|leak|static|sample|illustrative|recovery|denial|underpay" \
  honorhealth-revenue-leak-snapshot.html 2>/dev/null \
  | head -250

echo
echo "=== WAR ROOM REGISTRY ==="
grep -nEi \
  "health|denial|financial|ar|recovery|register|alias" \
  html/js/core/tsm-war-room-registry.js 2>/dev/null \
  | head -250

echo
echo "=== RCM / CAREER API ROUTES ==="
grep -RniE \
  "/api/(hc|career|rcm|revenue)|crcr|denial|recovery" \
  server html/js \
  --include='*.js' \
  --include='*.html' \
  2>/dev/null \
  | head -350

echo
echo "=== EXISTING CAREER / MASTERY ENGINES ==="
find html server -type f \
  \( -iname '*career*' -o -iname '*mastery*' -o -iname '*training*' -o -iname '*interview*' \) \
  2>/dev/null \
  | sort

echo
echo "=== GIT STATUS ==="
git status --short

echo
echo "=== CURRENT COMMIT ==="
git rev-parse --short HEAD

echo
echo "============================================================"
echo "AUDIT COMPLETE — NO FILES MODIFIED"
echo "============================================================"
