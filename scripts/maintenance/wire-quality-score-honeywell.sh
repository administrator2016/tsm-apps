#!/usr/bin/env bash
# wire-quality-score-honeywell.sh
# --------------------------------------------------------------------------
# Wires TSMQualityScoreEngine.fromExplainItems() into the Honeywell
# executive portal's exportClientPackage(), so the delivery package's
# executiveSummary.whatHappened (recordsProcessed/accuracy/band) stops being
# null and reflects a real score computed from the same explain items
# already on the page.
#
# What it does:
#   1. Adds a <script> tag for tsm-quality-score-engine.js, loaded before
#      the inline <script> block that defines exportClientPackage.
#   2. Updates the TSMDeliveryPackage.build({...}) call inside
#      exportClientPackage to compute and pass qualityScore.
#
# Run from the repo root:
#   bash wire-quality-score-honeywell.sh
# --------------------------------------------------------------------------
set -euo pipefail

FILE="/workspaces/tsm-apps/html/war-rooms/honeywell-executive-portal.html"

if [ ! -f "$FILE" ]; then
  echo "ERROR: $FILE not found. Run this from the repo root." >&2
  exit 1
fi

echo "==> Backing up original file to ${FILE}.bak-quality-score-$(date +%Y%m%d-%H%M%S)"
cp "$FILE" "${FILE}.bak-quality-score-$(date +%Y%m%d-%H%M%S)"

echo "==> Checking current state..."
if grep -q "tsm-quality-score-engine.js" "$FILE"; then
  echo "Script tag already present — skipping insertion."
else
  echo "==> Adding <script> tag for tsm-quality-score-engine.js"
  # Insert it right before the tsm-delivery-package-deps.js tag, since that's
  # the last script tag loaded and this needs to be available before the
  # inline exportClientPackage() function runs (which happens earlier in the
  # file, in the <script> block, but functions aren't *called* until a user
  # clicks the export button — by which time all script tags, including ones
  # appearing after the inline block, have already loaded).
  sed -i 's|<script src="/html/shared/tsm-delivery-package-deps.js"></script>|<script src="/html/shared/tsm-quality-score-engine.js"></script>\n  <script src="/html/shared/tsm-delivery-package-deps.js"></script>|' "$FILE"
fi

echo "==> Updating exportClientPackage() to compute and pass qualityScore"

# Replace the old two-field build() call with one that also computes and
# passes qualityScore, using the same lastExplainItems already in scope.
python3 - "$FILE" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = """  const pkg = TSMDeliveryPackage.build({
    domain: 'Honeywell',
    explainItems: lastExplainItems
  });"""

new = """  // Real quality score computed from the same explain items the page
  // already rendered — no new data invented, matches the existing
  // fromExplainItems(items, opts) contract (tsm-quality-score-engine.js).
  const qs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'Honeywell',
    explainItems: lastExplainItems,
    documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
    qualityScore: qs
  });"""

if old not in content:
    print("ERROR: expected build() call not found verbatim — file may have changed since this script was written. No changes made.", file=sys.stderr)
    sys.exit(1)

content = content.replace(old, new)
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Patched exportClientPackage() successfully.")
PYEOF

echo ""
echo "==> Done. Review with:"
echo "   git diff $FILE"
echo "   fly deploy"
