#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

FILE="html/healthcare/hc-main-strategist.html"

echo "============================================================"
echo "TSM HC — TRACE KPI DATA ORIGIN"
echo "READ ONLY — NO SERVER REQUESTS"
echo "============================================================"

echo
echo "=== 1. DENIAL HOTSPOT KPI ==="

grep -n -B 12 -A 12 \
  "Denial Hotspot" \
  "$FILE" || true

echo
echo "=== 2. REVENUE AT RISK KPI ==="

grep -n -B 12 -A 12 \
  "Revenue at Risk" \
  "$FILE" || true

echo
echo "=== 3. KPI ROW ==="

grep -n -B 5 -A 35 \
  'class="kpi-row"' \
  "$FILE" | head -180 || true

echo
echo "=== 4. KPI VALUE ASSIGNMENTS ==="

grep -n -E \
  'getKpiByLabel|\.textContent.*(revenue|denial|risk|auth)|innerHTML.*(revenue|denial|risk|auth)|textContent.*=' \
  "$FILE" \
  | head -250 || true

echo
echo "=== 5. PAYLOAD / RELAY SOURCES ==="

grep -n -E \
  'localStorage|sessionStorage|relay|warRoomBrief|payload|window\.[A-Za-z0-9_]+.*=' \
  "$FILE" \
  | head -300 || true

echo
echo "=== 6. HC API REFERENCES IN STRATEGIST ==="

grep -n -E \
  "fetch\\(['\"]/api/hc|fetch\\([^)]*api/hc|/api/hc/" \
  "$FILE" \
  | head -200 || true

echo
echo "============================================================"
echo "TRACE COMPLETE"
echo "NO SERVER REQUESTS"
echo "NO NODE START"
echo "NO FILE MODIFICATIONS"
echo "============================================================"
