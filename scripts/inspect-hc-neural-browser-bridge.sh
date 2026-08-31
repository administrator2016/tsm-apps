#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
FILE="$ROOT/html/healthcare/hc-office-manager-doc-intake.html"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — BROWSER BRIDGE CONTRACT INSPECTION"
echo "============================================================"
echo
echo "FILE: $FILE"
echo

cd "$ROOT"

echo "=== 1. BRIDGE DEFINITION ==="
nl -ba "$FILE" | sed -n '970,1035p'

echo
echo "=== 2. BRIDGE CALL SITE ==="
nl -ba "$FILE" | sed -n '4340,4520p'

echo
echo "=== 3. BRIDGE REFERENCES ==="
grep -n -B8 -A30 \
  "TSM_HC_OM_NEURAL_INTAKE" \
  "$FILE" || true

echo
echo "=== 4. BUILD ENVELOPE REFERENCES ==="
grep -n -B12 -A45 \
  "buildEnvelope" \
  "$FILE" || true

echo
echo "=== 5. SERVER INTAKE CONTRACT ==="
nl -ba "$ROOT/server/healthcare/hc-neural-intake.js" | sed -n '35,180p'

echo
echo "=== 6. TEST'S BROWSER-BRIDGE ASSERTION ==="
grep -n -B20 -A35 \
  "Browser bridge candidates" \
  "$ROOT/scripts/test-hc-neural-intake.sh" || true

echo
echo "============================================================"
echo " INSPECTION COMPLETE"
echo "============================================================"
