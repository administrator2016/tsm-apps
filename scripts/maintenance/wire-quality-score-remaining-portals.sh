#!/usr/bin/env bash
# wire-quality-score-remaining-portals.sh
# --------------------------------------------------------------------------
# Same fix as wire-quality-score-honeywell.sh, applied to the 9 executive
# portals that call TSMDeliveryPackage.build() without a qualityScore:
#   Concierge, FinOps, HotelOps, NOC, Insurance, Legal, Mortgage,
#   PM Copilot, Schools
#
# (Healthcare and Construction already pass qualityScore: lastQualityScore
#  and are left untouched.)
#
# For each page:
#   1. Ensures tsm-quality-score-engine.js is loaded (adds it right before
#      the tsm-delivery-package-deps.js tag if missing).
#   2. Patches the TSMDeliveryPackage.build({...}) call to compute and pass
#      qualityScore + documentCount from whatever explainItems expression
#      that page already uses.
#
# Run from the repo root:
#   bash wire-quality-score-remaining-portals.sh
# --------------------------------------------------------------------------
set -euo pipefail

STAMP=$(date +%Y%m%d-%H%M%S)

python3 - "$STAMP" << 'PYEOF'
import sys, re, os

stamp = sys.argv[1]

# (file, domain label used only for logging, explainItems expression as it
#  appears in that file's build() call, old full old-block text, quote style)
targets = [
    {
        "file": "html/concierge/concierge-executive-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'Concierge',
    explainItems: toDeliveryPackageItems(lastMissions),
    sections: { kpis: lastKpis }
  });""",
        "new": """  const _pkgItems = toDeliveryPackageItems(lastMissions);
  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(_pkgItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'Concierge',
    explainItems: _pkgItems,
    documentCount: Array.isArray(_pkgItems) ? _pkgItems.length : null,
    qualityScore: _pkgQs,
    sections: { kpis: lastKpis }
  });"""
    },
    {
        "file": "html/finops-suite/finops-war/finops-executive-portal.html",
        "old": """    var pkg = TSMDeliveryPackage.build({
      domain: 'FinOps',
      explainItems: lastExplainItems
    });""",
        "new": """    var _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
      ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
      : null;
    var pkg = TSMDeliveryPackage.build({
      domain: 'FinOps',
      explainItems: lastExplainItems,
      documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
      qualityScore: _pkgQs
    });"""
    },
    {
        "file": "html/hotelops/hotelops-executive-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'HotelOps',
    explainItems: toDeliveryPackageItems(lastExplainItems),
    sections: { financials: lastFinancials, riskRegister: lastRiskData, portfolio: lastPortfolio }
  });""",
        "new": """  const _pkgItems = toDeliveryPackageItems(lastExplainItems);
  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(_pkgItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'HotelOps',
    explainItems: _pkgItems,
    documentCount: Array.isArray(_pkgItems) ? _pkgItems.length : null,
    qualityScore: _pkgQs,
    sections: { financials: lastFinancials, riskRegister: lastRiskData, portfolio: lastPortfolio }
  });"""
    },
    {
        "file": "html/l1-copilot/noc/noc-executive-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'NOC',
    explainItems: lastExplainItems,
    sections: { financials: lastFinancials, bncaExposure: lastBncaExposure, incidentWip: lastIncidentWip }
  });""",
        "new": """  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'NOC',
    explainItems: lastExplainItems,
    documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
    qualityScore: _pkgQs,
    sections: { financials: lastFinancials, bncaExposure: lastBncaExposure, incidentWip: lastIncidentWip }
  });"""
    },
    {
        "file": "html/war-rooms/insure-war/insurance-executive-portal.html",
        "old": """    var pkg = TSMDeliveryPackage.build({
      domain: 'Insurance',
      explainItems: lastExplainItems
    });""",
        "new": """    var _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
      ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
      : null;
    var pkg = TSMDeliveryPackage.build({
      domain: 'Insurance',
      explainItems: lastExplainItems,
      documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
      qualityScore: _pkgQs
    });"""
    },
    {
        "file": "html/war-rooms/legal-war/legal-executive-portal.html",
        "old": """    var pkg = TSMDeliveryPackage.build({
      domain: 'Legal',
      explainItems: lastExplainItems,
      sections: { strategistRelay: window.tsmLastLegalRelay }
    });""",
        "new": """    var _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
      ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
      : null;
    var pkg = TSMDeliveryPackage.build({
      domain: 'Legal',
      explainItems: lastExplainItems,
      documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
      qualityScore: _pkgQs,
      sections: { strategistRelay: window.tsmLastLegalRelay }
    });"""
    },
    {
        "file": "html/war-rooms/mortgage/mortgage-executive-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'Mortgage',
    explainItems: lastExplainItems,
    sections: sections
  });""",
        "new": """  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'Mortgage',
    explainItems: lastExplainItems,
    documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
    qualityScore: _pkgQs,
    sections: sections
  });"""
    },
    {
        "file": "html/war-rooms/pm-copilot/pm-exec-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'PM Copilot',
    explainItems: lastExplainItems,
    sections: { kpis: lastKpis, financials: lastFinancials }
  });""",
        "new": """  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'PM Copilot',
    explainItems: lastExplainItems,
    documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
    qualityScore: _pkgQs,
    sections: { kpis: lastKpis, financials: lastFinancials }
  });"""
    },
    {
        "file": "html/war-rooms/schools-command/schools-executive-portal.html",
        "old": """  const pkg = TSMDeliveryPackage.build({
    domain: 'Schools',
    explainItems: lastExplainItems,
    sections: { financials: lastFinancials, grantWip: lastGrantWip }
  });""",
        "new": """  const _pkgQs = (window.TSMQualityScoreEngine && typeof TSMQualityScoreEngine.fromExplainItems === 'function')
    ? TSMQualityScoreEngine.fromExplainItems(lastExplainItems, {})
    : null;
  const pkg = TSMDeliveryPackage.build({
    domain: 'Schools',
    explainItems: lastExplainItems,
    documentCount: Array.isArray(lastExplainItems) ? lastExplainItems.length : null,
    qualityScore: _pkgQs,
    sections: { financials: lastFinancials, grantWip: lastGrantWip }
  });"""
    },
]

QS_TAG = '  <script src="/html/shared/tsm-quality-score-engine.js"></script>\n'

results = []
for t in targets:
    path = t["file"]
    if not os.path.exists(path):
        results.append((path, "MISSING FILE — skipped"))
        continue

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    backup_path = f"{path}.bak-quality-score-{stamp}"
    with open(backup_path, "w", encoding="utf-8") as f:
        f.write(content)

    changed = False

    # 1. Ensure the quality score engine script tag is present.
    if "tsm-quality-score-engine.js" not in content:
        # Insert it right before tsm-delivery-package-deps.js if present,
        # else before tsm-delivery-package.js as a fallback, else skip
        # (and flag it below) since we don't know where scripts live on
        # this page.
        if '<script src="/html/shared/tsm-delivery-package-deps.js"></script>' in content:
            content = content.replace(
                '<script src="/html/shared/tsm-delivery-package-deps.js"></script>',
                QS_TAG.strip() + '\n  <script src="/html/shared/tsm-delivery-package-deps.js"></script>',
                1
            )
            changed = True
        elif '<script src="/html/shared/tsm-delivery-package.js"></script>' in content:
            content = content.replace(
                '<script src="/html/shared/tsm-delivery-package.js"></script>',
                QS_TAG.strip() + '\n  <script src="/html/shared/tsm-delivery-package.js"></script>',
                1
            )
            changed = True
        else:
            results.append((path, "WARN: no delivery-package script tag found to anchor insertion — script tag NOT added, please add manually"))

    # 2. Patch the build() call itself.
    if t["old"] in content:
        content = content.replace(t["old"], t["new"])
        changed = True
    else:
        results.append((path, "ERROR: expected build() block not found verbatim — no code change made, check manually"))
        # Still write back any script-tag-only change made above, then continue.
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        continue

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

    results.append((path, "OK: patched"))

print("")
for path, status in results:
    print(f"{status:60s} {path}")
PYEOF

echo ""
echo "==> Done. Review with:"
echo "   git diff"
echo "   fly deploy"