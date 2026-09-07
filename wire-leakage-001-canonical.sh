#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

ADAPTER="html/js/career/tsm-revenue-leakage-career-adapter.js"
BACKUP="${ADAPTER}.bak-$(date +%Y%m%d-%H%M%S)"

echo "============================================================"
echo "TSM — WIRE LEAKAGE-001 TO CANONICAL PORTFOLIO CONTRACT"
echo "============================================================"
echo

[[ -f "$ADAPTER" ]] || {
  echo "FAIL: missing $ADAPTER"
  exit 1
}

cp "$ADAPTER" "$BACKUP"
echo "BACKUP: $BACKUP"

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()

# ------------------------------------------------------------
# 1. Remove any existing demo-snapshot source references.
# ------------------------------------------------------------
demo_patterns = [
    r"\s*source:\s*['\"]honorhealth-revenue-leak-snapshot['\"],?",
    r"\s*source:\s*['\"]honorhealth-revenue-leak-snapshot:table-fallback['\"],?",
]

for pattern in demo_patterns:
    text = re.sub(pattern, "", text)

# ------------------------------------------------------------
# 2. Locate discoverLeakage().
# ------------------------------------------------------------
match = re.search(
    r"function\s+discoverLeakage\s*\([^)]*\)\s*\{",
    text
)

if not match:
    raise SystemExit("FAIL: discoverLeakage() not found")

start = match.start()
brace = text.find("{", match.start())

depth = 0
end = None

for i in range(brace, len(text)):
    if text[i] == "{":
        depth += 1
    elif text[i] == "}":
        depth -= 1
        if depth == 0:
            end = i + 1
            break

if end is None:
    raise SystemExit("FAIL: could not determine discoverLeakage() boundary")

# ------------------------------------------------------------
# 3. Replace discovery with canonical-contract-only discovery.
#
# Supported canonical producer handoff:
#
#   window.TSMHCPortfolioTwin
#
# Expected:
#
#   {
#     leakageOpportunities: [...]
#   }
#
# Also supports:
#
#   window.TSMHealthcarePortfolio.getPortfolioTwin()
#
# if a future producer exposes the twin through a getter.
#
# No demo fallback.
# No Strategist KPI fallback.
# No HTML table scraping.
# ------------------------------------------------------------
replacement = r'''function getCanonicalPortfolioTwin() {
    try {
      if (
        window.TSMHCPortfolioTwin &&
        typeof window.TSMHCPortfolioTwin === 'object'
      ) {
        return window.TSMHCPortfolioTwin;
      }
    } catch (e) {}

    try {
      if (
        window.TSMHealthcarePortfolio &&
        typeof window.TSMHealthcarePortfolio.getPortfolioTwin === 'function'
      ) {
        const twin = window.TSMHealthcarePortfolio.getPortfolioTwin();
        if (twin && typeof twin === 'object') return twin;
      }
    } catch (e) {}

    return null;
  }

  function normalizeCanonicalOpportunity(item, index) {
    if (!item || typeof item !== 'object') return null;

    const claimId =
      item.claimId ||
      item.claim_id ||
      item.accountId ||
      item.account_id ||
      null;

    if (!claimId) return null;

    const exposure =
      item.exposure === null || item.exposure === undefined
        ? null
        : Number(item.exposure);

    const ageDays =
      item.ageDays === null || item.ageDays === undefined
        ? null
        : Number(item.ageDays);

    return {
      id: item.opportunityId || ('LEAKAGE-' + claimId),
      opportunityId: item.opportunityId || null,
      claimId: String(claimId),
      accountId: item.accountId || item.account_id || null,
      payer: item.payer || null,
      exposure: Number.isFinite(exposure) ? exposure : null,
      ageDays: Number.isFinite(ageDays) ? ageDays : null,
      denialReasonCode:
        item.denialReasonCode ||
        item.denial_reason_code ||
        null,
      denialCategory:
        item.denialCategory ||
        item.denial_category ||
        null,
      rootCause:
        item.rootCause ||
        item.root_cause ||
        item.rootCauseHypothesis ||
        item.root_cause_hypothesis ||
        null,
      opportunityType:
        item.opportunityType ||
        item.opportunity_type ||
        null,
      recommendedAction:
        item.recommendedAction ||
        item.recommended_action ||
        null,
      urgency: item.urgency || null,
      appealable:
        item.appealable === undefined
          ? null
          : Boolean(item.appealable),
      appealDeadline:
        item.appealDeadline ||
        item.appeal_deadline ||
        null,
      recoveryLikelihood:
        item.recoveryLikelihood ||
        item.recovery_likelihood ||
        null,
      confidence:
        typeof item.confidence === 'number'
          ? item.confidence
          : null,
      evidenceProvenance:
        Array.isArray(item.evidenceProvenance)
          ? item.evidenceProvenance
          : [],
      runtimeSource:
        item.runtimeSource ||
        item.source ||
        'healthcare-portfolio',
      sourceIndex:
        item.sourceIndex === undefined
          ? index
          : item.sourceIndex,

      // Career adapter provenance.
      careerSource: 'canonical-healthcare-portfolio-leakage'
    };
  }

  function discoverLeakage() {
    const twin = getCanonicalPortfolioTwin();

    if (
      !twin ||
      !Array.isArray(twin.leakageOpportunities)
    ) {
      return [];
    }

    return twin.leakageOpportunities
      .map(normalizeCanonicalOpportunity)
      .filter(Boolean);
  }'''

text = text[:start] + replacement + text[end:]

# ------------------------------------------------------------
# 4. Add explicit canonical handoff API before the public API.
# ------------------------------------------------------------
public_match = re.search(
    r"\s*window\.TSMRevenueLeakageCareer\s*=\s*\{",
    text
)

if not public_match:
    raise SystemExit(
        "FAIL: window.TSMRevenueLeakageCareer public API not found"
    )

handoff = r'''
  /*
   * CANONICAL PORTFOLIO HANDOFF
   *
   * LEAKAGE-001 consumes the structured Healthcare Portfolio Twin.
   * The producer is responsible for supplying:
   *
   *   {
   *     leakageOpportunities: [...]
   *   }
   *
   * This deliberately does NOT accept the HonorHealth demo snapshot
   * or Strategist KPI values as a career source.
   */
  function setPortfolioTwin(twin) {
    if (!twin || typeof twin !== 'object') return false;

    try {
      window.TSMHCPortfolioTwin = twin;
      return true;
    } catch (e) {
      return false;
    }
  }

'''

text = text[:public_match.start()] + "\n" + handoff + text[public_match.start():]

# ------------------------------------------------------------
# 5. Expose setPortfolioTwin().
# ------------------------------------------------------------
api_match = re.search(
    r"(window\.TSMRevenueLeakageCareer\s*=\s*\{)",
    text
)

if not api_match:
    raise SystemExit("FAIL: public API assignment disappeared")

text = (
    text[:api_match.start()]
    + api_match.group(1)
    + "\n"
    + "    setPortfolioTwin: setPortfolioTwin,"
    + text[api_match.end():]
)

path.write_text(text)
PY

echo
echo "=== 1. SYNTAX ==="
node --check "$ADAPTER"
echo "PASS: leakage adapter syntax"

echo
echo "=== 2. DEMO SOURCE REMOVAL ==="
if grep -nEi \
  "honorhealth-revenue-leak-snapshot|revenue-leak-snapshot" \
  "$ADAPTER"; then
  echo "FAIL: demo snapshot reference remains in adapter"
  exit 1
else
  echo "PASS: no demo snapshot reference in adapter"
fi

echo
echo "=== 3. STRATEGIST KPI PROTECTION ==="
if grep -nEi \
  "48K|2\.8M|18\.4%|Revenue at Risk|getKpiByLabel" \
  "$ADAPTER"; then
  echo "FAIL: Strategist/demo KPI dependency remains"
  exit 1
else
  echo "PASS: no Strategist KPI dependency"
fi

echo
echo "=== 4. CANONICAL SOURCE CONTRACT ==="
grep -nE \
  "TSMHCPortfolioTwin|TSMHealthcarePortfolio|getPortfolioTwin|leakageOpportunities|canonical-healthcare-portfolio-leakage|setPortfolioTwin" \
  "$ADAPTER"

echo
echo "=== 5. CANONICAL DISCOVERY PROBE ==="
node - "$ADAPTER" <<'NODE'
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');

const sandbox = {
  window: {},
  console,
  Number,
  String,
  Boolean,
  Array,
  Object,
  Date,
  Math
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

if (!sandbox.window.TSMRevenueLeakageCareer) {
  throw new Error('TSMRevenueLeakageCareer API missing');
}

const api = sandbox.window.TSMRevenueLeakageCareer;

if (typeof api.discoverLeakage !== 'function') {
  throw new Error('discoverLeakage() missing');
}

if (typeof api.setPortfolioTwin !== 'function') {
  throw new Error('setPortfolioTwin() missing');
}

const empty = api.discoverLeakage();

if (!Array.isArray(empty) || empty.length !== 0) {
  throw new Error('Expected zero opportunities with no canonical portfolio');
}

const twin = {
  leakageOpportunities: [
    {
      contractVersion: '1.0.0',
      opportunityId: 'claims:CLM-001',
      source: 'healthcare-portfolio:claims',
      claimId: 'CLM-001',
      payer: 'Aetna',
      exposure: 12400,
      ageDays: 97,
      denialReasonCode: 'CO-197',
      denialCategory: 'timely_filing',
      opportunityType: 'timely_filing',
      recommendedAction: 'appeal',
      urgency: 'CRITICAL',
      appealable: true,
      recoveryLikelihood: 'STRONG',
      confidence: 85,
      evidenceProvenance: []
    }
  ]
};

if (!api.setPortfolioTwin(twin)) {
  throw new Error('setPortfolioTwin() failed');
}

const opportunities = api.discoverLeakage();

if (opportunities.length !== 1) {
  throw new Error(
    `Expected 1 canonical opportunity, got ${opportunities.length}`
  );
}

const o = opportunities[0];

const checks = {
  claimId: o.claimId === 'CLM-001',
  payer: o.payer === 'Aetna',
  exposure: o.exposure === 12400,
  ageDays: o.ageDays === 97,
  denialReasonCode: o.denialReasonCode === 'CO-197',
  denialCategory: o.denialCategory === 'timely_filing',
  opportunityType: o.opportunityType === 'timely_filing',
  recommendedAction: o.recommendedAction === 'appeal',
  urgency: o.urgency === 'CRITICAL',
  source: o.careerSource === 'canonical-healthcare-portfolio-leakage'
};

for (const [name, ok] of Object.entries(checks)) {
  if (!ok) {
    console.error('FAIL:', name, o);
    process.exit(1);
  }
  console.log('PASS:', name);
}

console.log('PASS: canonical LEAKAGE-001 discovery contract');
NODE

echo
echo "=== 6. PORTFOLIO CONTRACT VERIFICATION ==="
node - <<'NODE'
const p = require('./server/healthcare/portfolio-intelligence');
const contract = require('./server/healthcare/revenue-leakage-contract');

const input = {
  sections: {
    claims: [
      {
        claimId: 'CLM-001',
        payer: 'Aetna',
        financialExposure: 12400,
        ageDays: 97,
        denialReasonCode: 'CO-197',
        denialCategory: 'timely_filing'
      }
    ]
  }
};

const twin = p.buildPortfolioTwin(input, []);

if (!Array.isArray(twin.leakageOpportunities)) {
  throw new Error('Portfolio twin missing leakageOpportunities');
}

if (twin.leakageOpportunities.length !== 1) {
  throw new Error(
    `Expected 1 leakage opportunity, got ${twin.leakageOpportunities.length}`
  );
}

const o = twin.leakageOpportunities[0];

if (o.exposure !== 12400) {
  throw new Error(`Expected exposure 12400, got ${o.exposure}`);
}

if (o.opportunityType !== 'timely_filing') {
  throw new Error(
    `Expected timely_filing, got ${o.opportunityType}`
  );
}

const summary = twin.leakageSummary;

if (!summary) {
  throw new Error('Missing leakageSummary');
}

console.log(JSON.stringify({
  opportunityCount: twin.leakageOpportunities.length,
  opportunityId: o.opportunityId,
  exposure: o.exposure,
  opportunityType: o.opportunityType,
  recommendedAction: o.recommendedAction,
  urgency: o.urgency,
  totalExplicitExposure: summary.totalExplicitExposure
}, null, 2));

if (summary.totalExplicitExposure !== 12400) {
  throw new Error(
    `Expected totalExplicitExposure 12400, got ${summary.totalExplicitExposure}`
  );
}

console.log('PASS: Portfolio Intelligence → canonical leakage contract');
NODE

echo
echo "=== 7. DIFF CHECK ==="
git diff --check
echo "PASS: git diff --check"

echo
echo "=== 8. CHANGE SUMMARY ==="
git diff --stat -- "$ADAPTER"

echo
echo "============================================================"
echo "PASS — LEAKAGE-001 CANONICAL ADAPTER WIRED"
echo "============================================================"
echo
echo "Career source:"
echo "  Healthcare Portfolio Twin"
echo "        ↓"
echo "  leakageOpportunities[]"
echo "        ↓"
echo "  LEAKAGE-001"
echo
echo "Demo snapshot:        DISABLED"
echo "Strategist KPI:       DISABLED"
echo "Table scraping:       DISABLED"
echo "Unknown exposure:     PRESERVED AS NULL"
echo "Server started:       NO"
echo "Localhost requests:   NO"
echo
echo "NEXT: run the browser/contract regression against the Career"
echo "platform and the Healthcare Portfolio producer."
echo "============================================================"