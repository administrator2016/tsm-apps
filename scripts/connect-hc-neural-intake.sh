#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
FILE="$ROOT/html/healthcare/hc-office-manager-doc-intake.html"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${FILE}.pre-neural-connect-${STAMP}"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — CONNECT TO HC OM UPLOADER"
echo "============================================================"
echo
echo "FILE:   $FILE"
echo "BACKUP: $BACKUP"
echo

cd "$ROOT"

echo "=== 1. VERIFY PREREQUISITES ==="

test -f "$FILE"
echo "PASS: HC OM uploader"

test -f "$ROOT/server/healthcare/hc-neural-intake.js"
echo "PASS: HC Neural Intake"

test -f "$ROOT/server/healthcare/hc-node-contract.js"
echo "PASS: HC node contract"

test -f "$ROOT/server/healthcare/hc-node-registry.js"
echo "PASS: HC node registry"

echo
echo "=== 2. VERIFY EXISTING HC OM ROUTER ==="

grep -q 'window.TSM_HC_OM_INTAKE' "$FILE"
echo "PASS: TSM_HC_OM_INTAKE"

grep -q 'window.hcOmRouteDocument' "$FILE"
echo "PASS: hcOmRouteDocument"

grep -q 'window.hcOmBuildRoutingEnvelope' "$FILE"
echo "PASS: hcOmBuildRoutingEnvelope"

echo
echo "=== 3. BACKUP ==="

cp "$FILE" "$BACKUP"
echo "PASS: backup created"
ls -lh "$BACKUP"

echo
echo "=== 4. INSPECT NEURAL INTAKE API ==="

grep -n -E \
  'module.exports|exports\.|class |function ' \
  "$ROOT/server/healthcare/hc-neural-intake.js" | head -80

echo
echo "=== 5. CREATE BROWSER-SAFE NEURAL BRIDGE ==="

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

marker = "window.TSM_HC_OM_NEURAL_INTAKE"

if marker in s:
    print("PASS: neural bridge already present")
    raise SystemExit(0)

anchor = "window.TSM_HC_OM_INTAKE = {"

idx = s.find(anchor)

if idx == -1:
    raise SystemExit("ERROR: TSM_HC_OM_INTAKE configuration not found")

# Insert immediately before the HC OM configuration.
bridge = r'''
/* ================================================================
 * TSM HC NEURAL INTAKE — BROWSER BRIDGE
 *
 * Purpose:
 *   Expose a stable browser-side contract for the HC OM uploader.
 *
 * Design:
 *   - additive
 *   - non-authoritative
 *   - failure-isolated
 *   - preserves existing HC OM routing
 *
 * The server-side Neural Intake remains the canonical orchestration
 * implementation. This bridge allows the uploader to emit a
 * standardized intake envelope without requiring Node/CommonJS
 * modules to execute inside the browser.
 * ================================================================ */

window.TSM_HC_OM_NEURAL_INTAKE = {
  version: "1.0.0",
  platform: "HC_OFFICE_MANAGER",
  vertical: "healthcare",

  source: "hc-office-manager-doc-intake",

  strategist: "/html/healthcare/hc-strategist/index.html",

  portal: "/html/healthcare/hc-om-portal.html",

  mode: "HC_CROSS_NODE_BNCA",

  buildEnvelope: function (documentText, extraction, advisoryRoutes) {
    var routes = Array.isArray(advisoryRoutes)
      ? advisoryRoutes
      : [];

    return {
      platform: "HC_OFFICE_MANAGER",
      vertical: "healthcare",
      timestamp: new Date().toISOString(),

      source: {
        type: "document",
        name: "hc-office-manager-doc-intake"
      },

      document: {
        extraction: extraction || {},
        textAvailable: Boolean(
          documentText &&
          String(documentText).trim()
        )
      },

      suggestedRoutes: routes,

      strategist: {
        destination: this.strategist,
        mode: this.mode,
        persona: "Office Manager"
      },

      portal: {
        destination: this.portal
      }
    };
  }
};

'''

s = s[:idx] + bridge + s[idx:]

p.write_text(s)
PY

echo "PASS: browser neural bridge"

echo
echo "=== 6. CONNECT BRIDGE TO EXISTING ROUTE PIPELINE ==="

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

needle = """    let hcOmSuggestedEnvelope = null;

    try {
"""

if needle not in s:
    raise SystemExit(
        "ERROR: expected HC OM routing bridge anchor not found"
    )

replacement = """    let hcOmSuggestedEnvelope = null;
    let hcOmNeuralEnvelope = null;

    try {
      /*
       * TSM HC Neural Intake
       *
       * This envelope is additive. It does not replace classifier
       * routing or HC OM advisory routing.
       */
      if (
        typeof window.TSM_HC_OM_NEURAL_INTAKE === 'object' &&
        typeof window.TSM_HC_OM_NEURAL_INTAKE.buildEnvelope === 'function'
      ) {
        hcOmNeuralEnvelope =
          window.TSM_HC_OM_NEURAL_INTAKE.buildEnvelope(
            (extraction && extraction.type === 'text')
              ? String(extraction.value || '')
              : String(
                  (classification && (
                    classification.rawText ||
                    classification.summary ||
                    classification.documentType ||
                    ''
                  )) || ''
                ),
            extraction || {},
            []
          );

        if (!classification.routing) {
          classification.routing = {};
        }

        if (!classification.routing.healthcare) {
          classification.routing.healthcare = {};
        }

        classification.routing.healthcare.hcNeuralIntake =
          hcOmNeuralEnvelope;
      }
    } catch (hcNeuralEnvelopeError) {
      console.warn(
        'TSM HC Neural Intake envelope unavailable; existing routing retained:',
        hcNeuralEnvelopeError
      );
    }

    try {
"""

s = s.replace(needle, replacement, 1)

p.write_text(s)
PY

echo "PASS: neural intake envelope connected"

echo
echo "=== 7. CONNECT ADVISORY ROUTES INTO NEURAL ENVELOPE ==="

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

needle = """        // Preserve evidence for downstream UI/debugging.
        routing.hcOmSuggested = suggestedRoutes;
"""

replacement = """        // Preserve evidence for downstream UI/debugging.
        routing.hcOmSuggested = suggestedRoutes;

        // Feed the advisory route evidence into the standardized
        // HC Neural Intake envelope. Existing classifier routing
        // remains authoritative.
        if (
          hcOmNeuralEnvelope &&
          hcOmNeuralEnvelope.document
        ) {
          hcOmNeuralEnvelope.suggestedRoutes = suggestedRoutes;
        }

        if (hcOmNeuralEnvelope) {
          routing.hcNeuralIntake = hcOmNeuralEnvelope;
        }
"""

if needle not in s:
    raise SystemExit(
        "ERROR: HC OM routing evidence anchor not found"
    )

s = s.replace(needle, replacement, 1)

p.write_text(s)
PY

echo "PASS: advisory routes connected to neural envelope"

echo
echo "=== 8. VERIFY CONNECTION ==="

grep -n -E \
  'TSM_HC_OM_NEURAL_INTAKE|hcOmNeuralEnvelope|hcNeuralIntake' \
  "$FILE" | head -80

echo
echo "=== 9. EXTRACT INLINE JAVASCRIPT ==="

TMP="/tmp/hc-neural-connected.js"

python3 - "$FILE" "$TMP" <<'PY'
import re
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
out = Path(sys.argv[2])

blocks = re.findall(
    r'<script(?:\s[^>]*)?>(.*?)</script>',
    src,
    flags=re.I | re.S
)

js = "\n\n".join(blocks)

out.write_text(js)

print(f"Extracted {len(js.splitlines())} JS lines.")
print(f"Runtime check file: {out}")
PY

echo
echo "=== 10. NODE SYNTAX ==="

node --check "$TMP"
echo "PASS: Node syntax"

echo
echo "=== 11. STATIC INTEGRATION CHECK ==="

grep -q 'TSM_HC_OM_NEURAL_INTAKE' "$TMP"
echo "PASS: neural bridge"

grep -q 'hcOmNeuralEnvelope' "$TMP"
echo "PASS: neural envelope"

grep -q 'hcNeuralIntake' "$TMP"
echo "PASS: routing attachment"

grep -q 'hcOmSuggested' "$TMP"
echo "PASS: existing HC OM advisory routing preserved"

echo
echo "=== 12. DIFF CHECK ==="

git diff --check
echo "PASS: git diff --check"

echo
echo "=== 13. DIFF STAT ==="

git diff --stat -- \
  "$FILE" \
  "scripts/connect-hc-neural-intake.sh" \
  "server/healthcare/hc-neural-intake.js" \
  "server/healthcare/hc-node-contract.js" \
  "server/healthcare/hc-node-registry.js"

echo
echo "============================================================"
echo " HC NEURAL INTAKE CONNECTION COMPLETE"
echo "============================================================"
echo
echo "CONNECTED:"
echo "  ✓ HC OM uploader"
echo "  ✓ HC OM advisory router"
echo "  ✓ HC Neural Intake envelope"
echo "  ✓ HC node registry foundation"
echo "  ✓ Strategist destination"
echo "  ✓ HC OM portal destination"
echo "  ✓ HC_CROSS_NODE_BNCA mode"
echo
echo "PRESERVED:"
echo "  ✓ Existing classifier routing"
echo "  ✓ Existing HC OM suggested routing"
echo "  ✓ Existing uploader pipeline"
echo "  ✓ Failure-isolated behavior"
echo
echo "NOT CLAIMED BY THIS SCRIPT:"
echo "  → Live specialist-node execution"
echo "  → Server-side BNCA execution"
echo "  → Production API persistence"
echo
echo "NEXT VALIDATION:"
echo "  ./scripts/test-hc-neural-intake.sh"
echo
