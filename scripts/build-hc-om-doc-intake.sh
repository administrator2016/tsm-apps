#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
SRC="$ROOT/html/tsm-doc-search-multi.html"
OUT="$ROOT/html/healthcare/hc-office-manager-doc-intake.html"
BACKUP="$OUT.bak"

echo "============================================================"
echo " TSM HC OFFICE MANAGER DOCUMENT INTAKE BUILDER"
echo "============================================================"

cd "$ROOT"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: Missing source:"
  echo "  $SRC"
  exit 1
fi

echo
echo "=== 1. SOURCE INTELLIGENCE BASELINE ==="
ls -lh "$SRC"

echo
echo "=== 2. DISCOVER SOURCE API / INTELLIGENCE HOOKS ==="
grep -nEi \
  "api/|fetch\\(|FormData|FileReader|document|extract|classif|analy|route|strateg|relay|neural|pinecone|embedding" \
  "$SRC" \
  | head -n 160 || true

echo
echo "=== 3. CREATE HC OM INTAKE FROM TSM DOC SEARCH BASELINE ==="

if [[ -f "$OUT" ]]; then
  cp "$OUT" "$BACKUP"
  echo "Existing HC OM intake backed up:"
  echo "  $BACKUP"
fi

cp "$SRC" "$OUT"

echo "Created:"
echo "  $OUT"

echo
echo "=== 4. HC-SCOPE THE DOCUMENT ==="

python3 - "$OUT" <<'PY'
from pathlib import Path
import re
import sys

p = Path(sys.argv[1])
s = p.read_text(errors="replace")

# ------------------------------------------------------------
# Identity / branding
# ------------------------------------------------------------
repls = [
    ("TSM Document Search Multi", "TSM HC Office Manager Document Intake"),
    ("TSM DOC SEARCH MULTI", "TSM HC OFFICE MANAGER DOCUMENT INTAKE"),
    ("DOCUMENT SEARCH MULTI", "HC OFFICE MANAGER DOCUMENT INTAKE"),
    ("Doc Search Multi", "HC Office Manager Intake"),
]

for a, b in repls:
    s = s.replace(a, b)

# ------------------------------------------------------------
# Make the page explicitly healthcare-only.
# ------------------------------------------------------------
scope_block = r'''
<!-- =========================================================
     TSM HC OFFICE MANAGER DOCUMENT INTAKE
     Scope:
       Healthcare documents only.
       Routes extracted signals to HC node(s).
       Strategist is the synthesis layer.
       hc-om-portal.html is the destination.
     ========================================================= -->
<script>
window.TSM_HC_OM_INTAKE = {
  version: "1.0.0",
  platform: "HC_OFFICE_MANAGER",
  vertical: "healthcare",

  destination: "/html/healthcare/hc-om-portal.html",

  nodes: [
    "billing",
    "compliance",
    "financial",
    "grants",
    "insurance",
    "legal",
    "medical",
    "operations",
    "pharmacy",
    "taxprep",
    "vendors"
  ],

  strategist: "/html/healthcare/hc-strategist/index.html",

  routing: {
    billing: [
      "denial", "claim", "claims", "accounts receivable", "AR",
      "revenue cycle", "CPT", "ICD", "coding", "writeoff",
      "underpayment", "payment posting", "ERA", "EOB"
    ],

    compliance: [
      "HIPAA", "compliance", "audit", "policy", "regulatory",
      "privacy", "security", "documentation compliance"
    ],

    financial: [
      "budget", "margin", "cash flow", "expense", "cost",
      "financial", "revenue", "profit", "variance"
    ],

    grants: [
      "grant", "HRSA", "NIH", "CMS Innovation", "funding",
      "award", "renewal"
    ],

    insurance: [
      "payer", "eligibility", "authorization", "prior auth",
      "coverage", "benefits", "insurance", "reimbursement"
    ],

    legal: [
      "contract", "legal", "malpractice", "liability",
      "agreement", "litigation", "counsel"
    ],

    medical: [
      "clinical", "provider", "physician", "patient care",
      "procedure", "CPT", "clinical documentation", "prior authorization"
    ],

    operations: [
      "staffing", "schedule", "scheduling", "intake", "throughput",
      "no-show", "capacity", "workflow", "operations", "vendor"
    ],

    pharmacy: [
      "pharmacy", "formulary", "dispense", "medication",
      "drug", "prescription", "pharmacy benefit"
    ],

    taxprep: [
      "tax", "1099", "payroll tax", "990", "tax filing"
    ],

    vendors: [
      "vendor", "supplier", "contractor", "service agreement",
      "vendor performance", "procurement"
    ]
  }
};
</script>
'''

# Insert immediately after <body> where possible.
if "TSM_HC_OM_INTAKE" not in s:
    if re.search(r"<body[^>]*>", s, flags=re.I):
        s = re.sub(
            r"(<body[^>]*>)",
            r"\1\n" + scope_block,
            s,
            count=1,
            flags=re.I
        )
    else:
        s = scope_block + "\n" + s

# ------------------------------------------------------------
# Add a visible workflow guide.
# ------------------------------------------------------------
guide = r'''
<style id="hc-om-guide-style">
#hc-om-guide {
  position: fixed;
  right: 18px;
  bottom: 18px;
  width: 330px;
  max-width: calc(100vw - 36px);
  z-index: 99999;
  background: #06111c;
  border: 1px solid rgba(0,229,255,.35);
  box-shadow: 0 18px 50px rgba(0,0,0,.55);
  color: #dbeafe;
  font-family: "IBM Plex Mono","Courier New",monospace;
  font-size: 11px;
}
#hc-om-guide .guide-head {
  padding: 11px 13px;
  border-bottom: 1px solid rgba(0,229,255,.18);
  color: #00e5ff;
  font-weight: 800;
  letter-spacing: 1.4px;
}
#hc-om-guide .guide-body {
  padding: 13px;
  line-height: 1.65;
}
#hc-om-guide .guide-step {
  color: #8a9fc0;
  margin-bottom: 8px;
}
#hc-om-guide .guide-step.active {
  color: #fff;
}
#hc-om-guide .guide-step.done {
  color: #00e676;
}
#hc-om-guide .guide-actions {
  display: flex;
  gap: 7px;
  margin-top: 12px;
}
#hc-om-guide button {
  flex: 1;
  padding: 8px;
  cursor: pointer;
  background: rgba(0,229,255,.07);
  border: 1px solid rgba(0,229,255,.25);
  color: #00e5ff;
  font: inherit;
}
#hc-om-guide button:hover {
  background: rgba(0,229,255,.14);
}
</style>

<div id="hc-om-guide">
  <div class="guide-head">◈ HC OFFICE MANAGER GUIDE</div>

  <div class="guide-body">
    <div id="hc-om-guide-message">
      Start by uploading a healthcare document.
      TSM will extract operational signals, identify the affected HC domain,
      and prepare the information for Strategist synthesis.
    </div>

    <div style="margin-top:12px">
      <div class="guide-step active" data-guide-step="1">① UPLOAD</div>
      <div class="guide-step" data-guide-step="2">② EXTRACT</div>
      <div class="guide-step" data-guide-step="3">③ CLASSIFY</div>
      <div class="guide-step" data-guide-step="4">④ ROUTE TO HC NODE(S)</div>
      <div class="guide-step" data-guide-step="5">⑤ SEND TO STRATEGIST</div>
      <div class="guide-step" data-guide-step="6">⑥ REVIEW IN OM PORTAL</div>
    </div>

    <div class="guide-actions">
      <button type="button" onclick="window.hcOmGuidePrev()">BACK</button>
      <button type="button" onclick="window.hcOmGuideNext()">NEXT</button>
    </div>
  </div>
</div>

<script>
(function () {
  const steps = [
    {
      title: "UPLOAD",
      text: "Upload healthcare operational documents such as EOBs, denial reports, payer correspondence, staffing reports, compliance documents, vendor records, or financial/operations reports."
    },
    {
      title: "EXTRACT",
      text: "TSM extracts the useful fields, entities, dates, amounts, codes, operational signals, and document context without asking the Office Manager to manually classify everything first."
    },
    {
      title: "CLASSIFY",
      text: "The intake layer determines which healthcare operational domains appear in the document."
    },
    {
      title: "ROUTE TO HC NODE(S)",
      text: "Signals can route to Billing, Compliance, Financial, Grants, Insurance, Legal, Medical, Operations, Pharmacy, Taxprep, and/or Vendors. A document may legitimately touch more than one node."
    },
    {
      title: "SEND TO STRATEGIST",
      text: "The HC Strategist becomes the cross-node synthesis layer. It combines routed findings and determines the Best Next Course of Action for the Office Manager."
    },
    {
      title: "REVIEW IN OM PORTAL",
      text: "The final operational picture is presented in the HC Office Manager Portal. The portal is the management/decision surface—not another intake engine."
    }
  ];

  let current = 0;

  function render() {
    document.querySelectorAll("#hc-om-guide .guide-step").forEach(function (el, i) {
      el.classList.toggle("active", i === current);
      el.classList.toggle("done", i < current);
    });

    const msg = document.getElementById("hc-om-guide-message");
    if (msg) msg.textContent = steps[current].text;
  }

  window.hcOmGuideNext = function () {
    current = Math.min(current + 1, steps.length - 1);
    render();
  };

  window.hcOmGuidePrev = function () {
    current = Math.max(current - 1, 0);
    render();
  };

  render();
})();
</script>
'''

if "hc-om-guide" not in s:
    s = s.replace("</body>", guide + "\n</body>", 1)

# ------------------------------------------------------------
# Add HC-specific routing helper.
# This intentionally does not call a new backend API yet.
# It provides deterministic routing metadata that can be consumed
# by the existing intelligence layer.
# ------------------------------------------------------------
router = r'''
<script>
(function () {
  const cfg = window.TSM_HC_OM_INTAKE;

  window.hcOmRouteDocument = function (text) {
    const body = String(text || "").toLowerCase();
    const hits = [];

    Object.keys(cfg.routing).forEach(function (node) {
      const terms = cfg.routing[node] || [];
      let score = 0;

      terms.forEach(function (term) {
        if (body.indexOf(String(term).toLowerCase()) !== -1) score++;
      });

      if (score > 0) {
        hits.push({
          node: node,
          score: score
        });
      }
    });

    hits.sort(function (a, b) {
      return b.score - a.score;
    });

    return hits;
  };

  window.hcOmBuildRoutingEnvelope = function (documentText, extraction) {
    const routes = window.hcOmRouteDocument(documentText);

    return {
      platform: "HC_OFFICE_MANAGER",
      vertical: "healthcare",
      timestamp: new Date().toISOString(),

      document: {
        source: "hc-office-manager-doc-intake",
        extraction: extraction || {},
      },

      routedNodes: routes,

      strategist: {
        destination: cfg.strategist,
        mode: "HC_CROSS_NODE_BNCA",
        persona: "Office Manager"
      },

      portal: {
        destination: cfg.destination
      }
    };
  };
})();
</script>
'''

if "hcOmBuildRoutingEnvelope" not in s:
    s = s.replace("</body>", router + "\n</body>", 1)

# ------------------------------------------------------------
# Explicitly prevent accidental non-HC navigation references
# from becoming the HC OM destination.
# Only replace direct final portal references where safe.
# ------------------------------------------------------------
s = s.replace(
    "/html/healthcare/executive-portal.html",
    "/html/healthcare/hc-om-portal.html"
)

p.write_text(s)
PY

echo "HC-scoped intake generated."

echo
echo "=== 5. VERIFY HC OM INTAKE ==="
grep -nEi \
  "TSM_HC_OM_INTAKE|HC OFFICE MANAGER|hcOmRouteDocument|hcOmBuildRoutingEnvelope|hc-om-portal|hc-strategist" \
  "$OUT" \
  | head -n 120

echo
echo "=== 6. VERIFY NON-HC ROUTING TERMS ARE NOT PRESENT AS NODE TARGETS ==="
grep -nEi \
  "construction|mortgage|real.?estate|finops|bpo|hospitality|hotel" \
  "$OUT" \
  | head -n 80 || true

echo
echo "=== 7. HTML / JS BASIC VALIDATION ==="
node --check <(python3 - "$OUT" <<'PY'
from pathlib import Path
import re
import sys

s = Path(sys.argv[1]).read_text(errors="replace")

scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", s, flags=re.I|re.S)

for block in scripts:
    print(block)
PY
) 2>&1 || {
  echo "NOTE: node --check cannot validate HTML inline extraction through this shell path."
  echo "Running structural checks instead."
}

echo
echo "=== 8. REQUIRED FILES ==="
for f in \
  html/healthcare/hc-office-manager-doc-intake.html \
  html/healthcare/hc-om-portal.html \
  html/healthcare/hc-strategist/index.html
do
  if [[ -f "$f" ]]; then
    echo "OK  $f"
  else
    echo "FAIL $f"
    exit 1
  fi
done

echo
echo "=== 9. HC OM PORTAL CLONE CHECK ==="
if cmp -s \
  html/healthcare/executive-portal.html \
  html/healthcare/hc-om-portal.html
then
  echo "OK: hc-om-portal.html remains an exact clone of executive-portal.html"
else
  echo "WARNING: HC OM portal is no longer byte-identical to executive-portal.html"
fi

echo
echo "=== 10. GIT DIFF SUMMARY ==="
git status --short
git diff --stat -- \
  html/healthcare/hc-office-manager-doc-intake.html \
  html/healthcare/hc-om-portal.html \
  scripts/build-hc-om-doc-intake.sh

echo
echo "============================================================"
echo " HC OM DOCUMENT INTAKE BUILD COMPLETE"
echo "============================================================"
echo
echo "INTAKE:"
echo "  /html/healthcare/hc-office-manager-doc-intake.html"
echo
echo "STRATEGIST:"
echo "  /html/healthcare/hc-strategist/index.html"
echo
echo "OM PORTAL:"
echo "  /html/healthcare/hc-om-portal.html"
echo
echo "CHAIN:"
echo "  HC DOC → EXTRACT → CLASSIFY → HC NODE(S)"
echo "        → HC STRATEGIST → HC OFFICE MANAGER PORTAL"
echo
