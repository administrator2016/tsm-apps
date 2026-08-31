#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="scripts/insurance-intelligent-guide-prep.txt"

{
  echo "============================================================"
  echo "TSM INSURANCE INTELLIGENT GUIDE PREPARATION"
  echo "Generated: $(date -Is)"
  echo "============================================================"
  echo

  echo "=== GIT STATE ==="
  git branch --show-current || true
  git status --short || true
  echo

  echo "============================================================"
  echo "1. EXISTING GUIDE INFRASTRUCTURE"
  echo "============================================================"

  for f in \
    html/js/tsm-guide-engine.js \
    html/shared/tsm-guided-how-to.js \
    html/shared/tsm-guided-how-to.css
  do
    if [[ -f "$f" ]]; then
      echo "FOUND: $f"
      wc -l "$f"
    else
      echo "MISSING: $f"
    fi
  done

  echo
  echo "--- Guide engine functions / public API ---"

  if [[ -f html/js/tsm-guide-engine.js ]]; then
    grep -nE \
      'function |window\.|export |class |guide|step|next|action|progress' \
      html/js/tsm-guide-engine.js | head -200 || true
  fi

  echo
  echo "--- Guided How-To functions / public API ---"

  if [[ -f html/shared/tsm-guided-how-to.js ]]; then
    grep -nE \
      'function |window\.|export |class |guide|step|next|action|progress' \
      html/shared/tsm-guided-how-to.js | head -200 || true
  fi

  echo
  echo "============================================================"
  echo "2. LOCATE ACTUAL INSURANCE COMMAND PAGES"
  echo "============================================================"

  find html -type f \
    \( -iname '*insurance*war*.html' \
    -o -iname '*insurance*strategist*.html' \
    -o -iname '*insurance*executive*.html' \
    -o -iname '*insure*war*.html' \
    -o -iname '*insure*strategist*.html' \
    -o -iname '*insure*executive*.html' \) \
    -print 2>/dev/null | sort

  echo
  echo "--- Files containing Insurance War Room / Strategist / Executive labels ---"

  grep -RilE \
    --exclude-dir=.git \
    'Insurance War Room|Insurance Strategist|Insurance Executive|INSURANCE WAR ROOM|INSURANCE STRATEGIST|INSURANCE EXECUTIVE' \
    html 2>/dev/null | sort || true

  echo
  echo "============================================================"
  echo "3. INSURANCE DIRECTORY STRUCTURE"
  echo "============================================================"

  for dir in \
    html/insure-war \
    html/war-rooms/insure-war \
    html/tsm-insurance
  do
    echo
    echo "--- $dir ---"

    if [[ -d "$dir" ]]; then
      find "$dir" -maxdepth 2 -type f -print | sort
    else
      echo "DIRECTORY NOT FOUND"
    fi
  done

  echo
  echo "============================================================"
  echo "4. GUIDE REFERENCES THROUGH INSURANCE"
  echo "============================================================"

  grep -RniE \
    --exclude-dir=.git \
    'tsm-guide-engine|tsm-guided-how-to|guided-how-to|how-to|next.?step|guide' \
    html/tsm-insurance html/war-rooms 2>/dev/null | \
    grep -Ei 'insurance|insure|guide|how-to' | \
    head -250 || true

  echo
  echo "============================================================"
  echo "5. EXISTING FINOPS APPLICATIONS"
  echo "============================================================"

  find html -type f \
    \( -iname '*finops*' -o -iname '*financial*index*' \) \
    -print 2>/dev/null | sort

  echo
  echo "============================================================"
  echo "6. EXISTING INSURANCE APPLICATIONS"
  echo "============================================================"

  if [[ -d html/tsm-insurance ]]; then
    find html/tsm-insurance -type f -maxdepth 2 -print | sort
  fi

  echo
  echo "============================================================"
  echo "7. APPLICATION CAPABILITY SIGNALS"
  echo "============================================================"

  for target in \
    'finops-accounting' \
    'finops-operations' \
    'financial-index' \
    'ins-claims' \
    'insurance-claims-pro' \
    'ins-underwriting' \
    'ins-compliance' \
    'ins-appeals' \
    'ins-liability' \
    'ins-malpractice' \
    'ins-tax'
  do
    echo
    echo "--- $target ---"

    find html \
      -type f \
      -iname "*${target}*" \
      -print 2>/dev/null | sort

    matches="$(
      grep -RniE \
        --exclude-dir=.git \
        'reconciliation|claims|underwriting|compliance|appeal|liability|malpractice|tax|financial|accounting|operations|premium|policy|risk|billing|ledger|variance|anomaly' \
        html/tsm-insurance html/finops-suite html 2>/dev/null |
        grep -i "$target" |
        head -30 || true
    )"

    if [[ -n "$matches" ]]; then
      echo "$matches"
    fi
  done

  echo
  echo "============================================================"
  echo "8. EXISTING RECOMMENDATION / SUGGESTION LOGIC"
  echo "============================================================"

  grep -RniE \
    --exclude-dir=.git \
    'recommended|recommendation|suggested|suggestion|remediation|recommended.*app|suggest.*app|open.*app|launch.*app' \
    html/tsm-insurance html/finops-suite html/shared html/js 2>/dev/null |
    head -300 || true

  echo
  echo "============================================================"
  echo "9. NEW FOUNDATION FILE STATUS"
  echo "============================================================"

  for f in \
    html/shared/tsm-app-capability-registry.js \
    html/shared/tsm-remediation-recommender.js
  do
    if [[ -e "$f" ]]; then
      echo "EXISTS — WILL NOT OVERWRITE: $f"
    else
      echo "MISSING — SAFE TO CREATE: $f"
    fi
  done

  echo
  echo "============================================================"
  echo "10. ANOMALY ADVISOR CHECK"
  echo "============================================================"

  advisor_hits="$(
    grep -RniE \
      --exclude-dir=.git \
      'anomaly[[:space:]_-]*advisor|anomaly-advisor' \
      html server scripts 2>/dev/null || true
  )"

  if [[ -n "$advisor_hits" ]]; then
    echo "$advisor_hits"
  else
    echo "No Anomaly Advisor references found."
  fi

  echo
  echo "============================================================"
  echo "PREPARATION COMPLETE"
  echo "============================================================"

} | tee "$OUT"

echo
echo "Wrote:"
echo "  $OUT"
