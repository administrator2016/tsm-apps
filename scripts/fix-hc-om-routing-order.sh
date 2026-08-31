#!/usr/bin/env bash
set -euo pipefail

FILE="html/healthcare/hc-office-manager-doc-intake.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.pre-routing-order-${STAMP}"

echo "============================================================"
echo " TSM HC OM — FIX ROUTING VARIABLE ORDER"
echo "============================================================"
echo
echo "FILE:   $FILE"
echo "BACKUP: $BACKUP"
echo

cp "$FILE" "$BACKUP"
echo "=== BACKUP CREATED ==="
ls -lh "$BACKUP"
echo

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """function routeDocument(fileName, classification, attachment, extraction) {

    // ================================================================
    // TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER
"""

new = """function routeDocument(fileName, classification, attachment, extraction) {

    // Declare verticals before the HC OM advisory routing bridge uses it.
    // The bridge is intentionally additive/non-authoritative.
    const verticals = classification.verticals || [];

    // ================================================================
    // TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER
"""

if old not in text:
    raise SystemExit(
        "ERROR: routeDocument() opening marker not found; refusing to patch."
    )

text = text.replace(old, new, 1)

old_decl = """  const verticals = classification.verticals || [];
  const routedTo  = [];
  const docClientId = ensureClientRegistered(classification.client);
"""

new_decl = """  const routedTo  = [];
  const docClientId = ensureClientRegistered(classification.client);
"""

if old_decl not in text:
    raise SystemExit(
        "ERROR: original verticals declaration not found; refusing duplicate cleanup."
    )

text = text.replace(old_decl, new_decl, 1)

path.write_text(text)
PY

echo "=== PATCH APPLIED ==="

echo
echo "=== VERIFY VARIABLE ORDER ==="
grep -n -B3 -A5 \
  "const verticals = classification.verticals" \
  "$FILE"

echo
echo "=== VERIFY ROUTE BRIDGE ==="
grep -n -B3 -A8 \
  "const hcVerticalKey" \
  "$FILE"

echo
echo "=== EXTRACT INLINE JAVASCRIPT ==="
python3 - "$FILE" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
text = p.read_text()

scripts = re.findall(r'<script\b[^>]*>(.*?)</script>', text, re.S | re.I)

out = "\n\n".join(scripts)
Path("/tmp/hc-om-inline-check.js").write_text(out)

print(f"Extracted {len(out.splitlines())} JS lines.")
PY

echo
echo "=== NODE SYNTAX CHECK ==="
node --check /tmp/hc-om-inline-check.js
echo "NODE CHECK: PASS"

echo
echo "=== CHECK FOR DUPLICATE VERTICAL DECLARATION ==="
COUNT="$(grep -c "const verticals = classification.verticals" "$FILE" || true)"
echo "vertical declaration count=$COUNT"

if [ "$COUNT" != "1" ]; then
  echo "ERROR: expected exactly one verticals declaration."
  exit 1
fi

echo
echo "=== GIT DIFF CHECK ==="
git diff --check -- "$FILE"
echo "GIT DIFF CHECK: PASS"

echo
echo "=== FINAL ROUTE FUNCTION ==="
grep -n -A35 \
  "function routeDocument(fileName, classification, attachment, extraction)" \
  "$FILE" | head -45

echo
echo "============================================================"
echo " HC OM ROUTING ORDER FIX COMPLETE"
echo "============================================================"
