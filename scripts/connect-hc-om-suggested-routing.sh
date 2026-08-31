#!/usr/bin/env bash
set -euo pipefail

FILE="html/healthcare/hc-office-manager-doc-intake.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.pre-hc-om-routing-${STAMP}"

echo "============================================================"
echo " TSM HC OFFICE MANAGER — SUGGESTED NODE ROUTING INTEGRATION"
echo "============================================================"
echo
echo "FILE:   $FILE"
echo "BACKUP: $BACKUP"
echo

[[ -f "$FILE" ]] || {
  echo "ERROR: target file not found: $FILE"
  exit 1
}

cp "$FILE" "$BACKUP"

echo "=== 1. BACKUP CREATED ==="
ls -lh "$BACKUP"
echo

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(errors="replace")

MARKER = "TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER"

if MARKER in text:
    print("PATCH ALREADY PRESENT.")
    print("No duplicate routing bridge inserted.")
    sys.exit(0)

# ------------------------------------------------------------
# Confirm HC OM routing foundation exists.
# ------------------------------------------------------------
required = [
    "window.hcOmRouteDocument",
    "window.hcOmBuildRoutingEnvelope",
    "window.TSM_HC_OM_INTAKE",
]

missing = [x for x in required if x not in text]

if missing:
    print("ERROR: HC OM routing foundation is incomplete.")
    for item in missing:
        print("  missing:", item)
    sys.exit(1)

# ------------------------------------------------------------
# Find routeDocument structurally.
# ------------------------------------------------------------
needle = "function routeDocument(fileName, classification, attachment, extraction) {"
idx = text.find(needle)

if idx == -1:
    print("ERROR: routeDocument() signature not found.")
    sys.exit(1)

insert_at = idx + len(needle)

patch = r'''

    // ================================================================
    // TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER
    // ================================================================
    //
    // HC Office Manager suggested routing is ADVISORY and ADDITIVE.
    //
    // Existing classifier-selected routes remain authoritative.
    // Suggested specialist nodes are merged into those routes.
    //
    // Flow:
    //
    //   extracted document
    //        ↓
    //   classifier
    //        ↓
    //   hcOmBuildRoutingEnvelope()
    //        ↓
    //   suggested HC specialist nodes
    //        ↓
    //   classification.routing.healthcare
    //        ↓
    //   existing routeDocument() pipeline
    //
    // The bridge is deliberately non-fatal. If the HC OM router
    // fails, the existing uploader continues exactly as before.
    // ================================================================

    let hcOmSuggestedEnvelope = null;

    try {
      const hcVerticalKey =
        verticals.includes('healthcare') ? 'healthcare' :
        verticals.includes('health') ? 'health' :
        null;

      if (
        hcVerticalKey &&
        typeof window.hcOmBuildRoutingEnvelope === 'function'
      ) {
        const routingText =
          (extraction && extraction.type === 'text')
            ? String(extraction.value || '')
            : String(
                (classification && (
                  classification.rawText ||
                  classification.summary ||
                  classification.documentType ||
                  ''
                )) || ''
              );

        hcOmSuggestedEnvelope =
          window.hcOmBuildRoutingEnvelope(
            routingText,
            extraction || {}
          );

        const suggestedRoutes =
          hcOmSuggestedEnvelope &&
          Array.isArray(hcOmSuggestedEnvelope.routedNodes)
            ? hcOmSuggestedEnvelope.routedNodes
            : [];

        if (!classification.routing) {
          classification.routing = {};
        }

        if (!classification.routing[hcVerticalKey]) {
          classification.routing[hcVerticalKey] = {};
        }

        const routing = classification.routing[hcVerticalKey];

        const existingNodes =
          Array.isArray(routing.nodes)
            ? routing.nodes.slice()
            : [];

        const suggestedNodes = suggestedRoutes
          .filter(function (route) {
            return route &&
              typeof route.node === 'string' &&
              Number(route.score) > 0;
          })
          .map(function (route) {
            return route.node;
          });

        // Existing classifier routes FIRST.
        // Suggested HC OM nodes are additive.
        routing.nodes = [
          ...existingNodes,
          ...suggestedNodes
        ].filter(function (node, index, array) {
          return node && array.indexOf(node) === index;
        });

        // Do not overwrite an explicit classifier sourceNode.
        if (
          !routing.sourceNode &&
          suggestedRoutes.length &&
          suggestedRoutes[0] &&
          suggestedRoutes[0].node
        ) {
          routing.sourceNode = suggestedRoutes[0].node;
        }

        // Preserve evidence for downstream UI/debugging.
        routing.hcOmSuggested = suggestedRoutes;

        console.log(
          'TSM HC OM suggested routing:',
          suggestedRoutes.map(function (r) {
            return r.node + ':' + r.score;
          }).join(', ') || 'none'
        );
      }
    } catch (hcOmRoutingError) {
      console.warn(
        'TSM HC OM suggested routing unavailable; existing classification retained:',
        hcOmRoutingError
      );
    }

    // ================================================================
    // END TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER
    // ================================================================
'''

text = text[:insert_at] + patch + text[insert_at:]

path.write_text(text)

print("PATCH APPLIED.")
print("HC OM suggested routing is now connected to routeDocument().")
PY

echo
echo "=== 2. ROUTING BRIDGE ==="

grep -n -A75 -B5 \
  "TSM HC OM — CONNECT SUGGESTED ROUTING TO UPLOADER" \
  "$FILE"

echo
echo "=== 3. ROUTING FOUNDATION ==="

grep -n -E \
  "hcOmRouteDocument|hcOmBuildRoutingEnvelope|hcOmSuggested|classification.routing|suggestedNodes" \
  "$FILE"

echo
echo "=== 4. EXTRACT INLINE JAVASCRIPT ==="

python3 - "$FILE" > /tmp/hc-om-inline-js.js <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text(errors="replace")

scripts = re.findall(
    r"<script(?:\s[^>]*)?>(.*?)</script>",
    text,
    flags=re.I | re.S
)

for i, js in enumerate(scripts, 1):
    if js.strip():
        print(f"\n/* ===== INLINE SCRIPT {i} ===== */")
        print(js)
PY

echo "Extracted $(wc -l < /tmp/hc-om-inline-js.js) JS lines."

echo
echo "=== 5. NODE SYNTAX CHECK ==="

node --check /tmp/hc-om-inline-js.js

echo "NODE CHECK: PASS"

echo
echo "=== 6. GIT DIFF CHECK ==="

git diff --check -- "$FILE"

echo "GIT DIFF CHECK: PASS"

echo
echo "=== 7. ROUTE FUNCTION ==="

grep -n \
  "function routeDocument(fileName, classification, attachment, extraction)" \
  "$FILE"

echo
echo "=== 8. STATUS ==="

git status --short -- "$FILE" "$BACKUP"

echo
echo "============================================================"
echo " HC OM SUGGESTED ROUTING CONNECTION COMPLETE"
echo "============================================================"
