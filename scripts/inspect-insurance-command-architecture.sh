#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT="scripts/insurance-command-architecture-inspection.txt"

{
  echo "============================================================"
  echo "TSM INSURANCE COMMAND ARCHITECTURE INSPECTION"
  echo "Generated: $(date -Is)"
  echo "Repo: $ROOT"
  echo "============================================================"
  echo

  echo "=== GIT STATE ==="
  git branch --show-current || true
  git status --short || true
  echo

  echo "============================================================"
  echo "1. INSURANCE WAR ROOM DIRECTORY"
  echo "============================================================"

  if [[ -d html/insure-war ]]; then
    find html/insure-war -maxdepth 2 -type f -print | sort
  else
    echo "MISSING: html/insure-war"
  fi

  echo
  echo "============================================================"
  echo "2. INSURANCE PAGE CANDIDATES"
  echo "============================================================"

  find html -type f \
    \( -iname '*insurance*' \
    -o -iname '*insure*' \) \
    -print | sort

  echo
  echo "============================================================"
  echo "3. ANOMALY ADVISOR REFERENCES"
  echo "============================================================"

  if grep -RniE \
    --exclude-dir=.git \
    --exclude='*.map' \
    'anomaly[[:space:]_-]*advisor|anomaly-advisor' \
    html server scripts 2>/dev/null; then
    true
  else
    echo "No anomaly advisor references found."
  fi

  echo
  echo "============================================================"
  echo "4. GUIDE / HOW-TO INFRASTRUCTURE"
  echo "============================================================"

  find html server scripts \
    -type f \
    \( -iname '*guide*' \
    -o -iname '*how-to*' \
    -o -iname '*howto*' \
    -o -iname '*walkthrough*' \) \
    -print 2>/dev/null | sort

  echo
  echo "--- Existing guide references ---"

  grep -RniE \
    --exclude-dir=.git \
    'tsm-guided-how-to|guide-engine|how-to|next.?step' \
    html/insure-war html/shared html/js 2>/dev/null || true

  echo
  echo "============================================================"
  echo "5. FINOPS APPLICATIONS"
  echo "============================================================"

  if [[ -d html/finops ]]; then
    find html/finops -maxdepth 2 -type f -print | sort
  else
    echo "MISSING: html/finops"
  fi

  echo
  echo "============================================================"
  echo "6. TSM-INSURANCE APPLICATIONS"
  echo "============================================================"

  if [[ -d html/tsm-insurance ]]; then
    find html/tsm-insurance -maxdepth 2 -type f -print | sort
  else
    echo "MISSING: html/tsm-insurance"
  fi

  echo
  echo "============================================================"
  echo "7. SPECIFIC APPLICATIONS REQUESTED"
  echo "============================================================"

  for target in \
    'finops-accounting' \
    'finops-operations' \
    'financial-index'
  do
    echo
    echo "--- $target ---"
    find html \
      -iname "*${target}*" \
      -print 2>/dev/null | sort || true
  done

  echo
  echo "============================================================"
  echo "8. INSURANCE NAVIGATION REFERENCES"
  echo "============================================================"

  grep -RniE \
    --exclude-dir=.git \
    'insurance-(war-room|strategist|executive)|insure-war|insurance-executive|insurance-strategist' \
    html server 2>/dev/null || true

  echo
  echo "============================================================"
  echo "9. EXISTING APP-LAUNCH / RECOMMENDATION PATTERNS"
  echo "============================================================"

  grep -RniE \
    --exclude-dir=.git \
    'recommended|recommendation|suggested|suggestion|open.*app|launch.*app|next.?step' \
    html/insure-war html/shared html/finops html/tsm-insurance 2>/dev/null || true

  echo
  echo "============================================================"
  echo "10. INSURANCE SCRIPT INVENTORY"
  echo "============================================================"

  for page in \
    html/insure-war/insurance-war-room.html \
    html/insure-war/insurance-strategist.html \
    html/insure-war/insurance-executive-portal.html
  do
    echo
    echo "--- $page ---"

    if [[ -f "$page" ]]; then
      grep -n '<script' "$page" || true
    else
      echo "MISSING"
    fi
  done

  echo
  echo "============================================================"
  echo "INSPECTION COMPLETE"
  echo "============================================================"

} | tee "$OUT"

echo
echo "Inspection written to:"
echo "  $OUT"
