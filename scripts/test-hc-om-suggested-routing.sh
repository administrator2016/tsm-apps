#!/usr/bin/env bash
set -euo pipefail

FILE="html/healthcare/hc-office-manager-doc-intake.html"

echo "============================================================"
echo " TSM HC OM — SUGGESTED ROUTING INTEGRATION TEST"
echo "============================================================"

echo
echo "=== 1. FUNCTION ORDER ==="

ROUTE_LINE="$(grep -n 'function routeDocument(fileName, classification, attachment, extraction)' "$FILE" | head -1 | cut -d: -f1)"
VERTICAL_LINE="$(grep -n 'const verticals = classification.verticals || \[\];' "$FILE" | head -1 | cut -d: -f1)"
BRIDGE_LINE="$(grep -n 'const hcVerticalKey' "$FILE" | head -1 | cut -d: -f1)"

echo "routeDocument=$ROUTE_LINE"
echo "verticals=$VERTICAL_LINE"
echo "hcVerticalKey=$BRIDGE_LINE"

if [ "$VERTICAL_LINE" -le "$ROUTE_LINE" ]; then
  echo "ERROR: verticals declaration is not inside routeDocument() after its opening."
  exit 1
fi

if [ "$VERTICAL_LINE" -ge "$BRIDGE_LINE" ]; then
  echo "ERROR: HC OM bridge still executes before verticals declaration."
  exit 1
fi

echo "PASS: variable order is correct."

echo
echo "=== 2. ROUTING FOUNDATION ==="

for pattern in \
  "window.hcOmRouteDocument" \
  "window.hcOmBuildRoutingEnvelope" \
  "routing.hcOmSuggested" \
  "suggestedRoutes" \
  "suggestedNodes"; do

  if grep -q "$pattern" "$FILE"; then
    echo "PASS: $pattern"
  else
    echo "FAIL: missing $pattern"
    exit 1
  fi
done

echo
echo "=== 3. MERGE SEMANTICS ==="

grep -n -A18 -B5 \
  "routing.nodes = \[" \
  "$FILE" | head -30

echo
echo "=== 4. INLINE JAVASCRIPT EXTRACTION ==="

python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()

scripts = re.findall(
    r'<script\b[^>]*>(.*?)</script>',
    text,
    re.S | re.I
)

js = "\n\n".join(scripts)
out = Path("/tmp/hc-om-runtime-check.js")
out.write_text(js)

print(f"Extracted {len(js.splitlines())} JS lines.")
print(f"Runtime check file: {out}")
PY

echo
echo "=== 5. NODE SYNTAX ==="
node --check /tmp/hc-om-runtime-check.js
echo "PASS: Node syntax"

echo
echo "=== 6. DIFF CHECK ==="
git diff --check -- "$FILE"
echo "PASS: git diff --check"

echo
echo "=== 7. HC OM ROUTING SECTION ==="

grep -n -B8 -A55 \
  "TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER" \
  "$FILE" | head -75

echo
echo "============================================================"
echo " HC OM SUGGESTED ROUTING TEST COMPLETE"
echo "============================================================"
