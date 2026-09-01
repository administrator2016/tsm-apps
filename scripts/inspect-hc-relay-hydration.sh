#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "============================================================"
echo "TSM HC RELAY HYDRATION — RECONNAISSANCE"
echo "============================================================"

echo
echo "=== 1. GIT STATE ==="
git status --short
echo
git log -1 --oneline

if [ -d "$(git rev-parse --git-path rebase-merge)" ] || \
   [ -d "$(git rev-parse --git-path rebase-apply)" ]; then
  echo
  echo "WARNING: Git rebase/am state still exists."
  git status
fi

echo
echo "=== 2. HC NODE FILES ==="
for f in \
  html/healthcare/hc-medical/index.html \
  html/healthcare/hc-operations/index.html \
  html/healthcare/hc-pharmacy/index.html \
  html/healthcare/hc-taxprep/index.html \
  html/healthcare/hc-vendors/index.html
do
  if [ -f "$f" ]; then
    printf 'FOUND  %s  (%s bytes)\n' "$f" "$(wc -c < "$f")"
  else
    printf 'MISSING %s\n' "$f"
  fi
done

echo
echo "=== 3. RELAY REFERENCES IN DOC SEARCH ==="
grep -nEi \
  "relay|localStorage|sessionStorage|postMessage|CustomEvent|dispatchEvent|buildRelayPayload|TSMExtraction" \
  html/tsm-doc-search-multi.html \
  | head -250 || true

echo
echo "=== 4. HC NODE RELAY REFERENCES ==="
for f in \
  html/healthcare/hc-medical/index.html \
  html/healthcare/hc-operations/index.html \
  html/healthcare/hc-pharmacy/index.html \
  html/healthcare/hc-taxprep/index.html \
  html/healthcare/hc-vendors/index.html
do
  echo
  echo "--- $f ---"
  grep -nEi \
    "relay|localStorage|sessionStorage|postMessage|CustomEvent|dispatchEvent|document|client|vendor|amount|summary|defectFlags|DEMO|sample|fixture" \
    "$f" | head -180 || true
done

echo
echo "=== 5. SHARED EXTRACTION / RELAY MODULES ==="
find html server -type f \
  \( -iname '*relay*.js' -o -iname '*extraction*.js' -o -iname '*intake*.js' -o -iname '*mission*.js' \) \
  -print 2>/dev/null | sort | head -200

echo
echo "=== 6. TSM EXTRACTION DEFINITIONS ==="
grep -Rni \
  "buildRelayPayload" \
  html server \
  --include='*.js' \
  --include='*.html' \
  2>/dev/null | head -100 || true

echo
echo "=== 7. RELAY STORAGE KEYS ==="
grep -RhoE \
  "['\"][A-Za-z0-9_.:-]*(relay|RELAY)[A-Za-z0-9_.:-]*['\"]" \
  html server \
  --include='*.js' \
  --include='*.html' \
  2>/dev/null \
  | sort -u | head -200 || true

echo
echo "=== 8. DEMO / SAMPLE DATA SOURCES ==="
grep -RniEi \
  "DEMO_DOCS|DEMO_DATA|SAMPLE_DATA|sample data|demo data|fixture" \
  html/healthcare \
  --include='*.html' \
  2>/dev/null | head -250 || true

echo
echo "=== 9. NODE-SPECIFIC POPULATION FUNCTIONS ==="
for f in \
  html/healthcare/hc-medical/index.html \
  html/healthcare/hc-operations/index.html \
  html/healthcare/hc-pharmacy/index.html \
  html/healthcare/hc-taxprep/index.html \
  html/healthcare/hc-vendors/index.html
do
  echo
  echo "--- $f ---"
  grep -nEi \
    "function .*populate|function .*render|function .*load|function .*init|innerHTML|textContent|\\.value\\s*=" \
    "$f" | head -220 || true
done

echo
echo "============================================================"
echo "RECON COMPLETE"
echo "============================================================"
