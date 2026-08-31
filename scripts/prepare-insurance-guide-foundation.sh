#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== TSM INSURANCE GUIDE FOUNDATION ==="
echo

mkdir -p html/shared

FILES=(
  "html/shared/tsm-app-capability-registry.js"
  "html/shared/tsm-remediation-recommender.js"
  "html/shared/tsm-guide-engine.js"
)

for file in "${FILES[@]}"; do
  if [[ -e "$file" ]]; then
    echo "EXISTS — preserving: $file"
  else
    echo "READY — will create: $file"
  fi
done

echo
echo "=== CANONICAL INSURANCE PAGES ==="

for file in \
  html/insure-war/insurance-war-room.html \
  html/insure-war/insurance-strategist.html \
  html/insure-war/insurance-executive-portal.html
do
  if [[ -f "$file" ]]; then
    echo "FOUND:    $file"
  else
    echo "MISSING:  $file"
  fi
done

echo
echo "=== ANOMALY ADVISOR CHECK ==="

advisor_hits="$(
  grep -RniE \
    --exclude-dir=.git \
    'anomaly[[:space:]_-]*advisor|anomaly-advisor' \
    html/insure-war html/shared html/js 2>/dev/null || true
)"

if [[ -n "$advisor_hits" ]]; then
  echo "$advisor_hits"
  echo
  echo "IMPORTANT: advisor references exist."
  echo "Do NOT delete the advisor yet."
else
  echo "No active anomaly-advisor references found in Insurance/shared UI."
fi

echo
echo "=== FOUNDATION STATUS ==="
echo "Inspection first."
echo "Registry second."
echo "Recommender third."
echo "Guide engine fourth."
echo
echo "No application files were modified."
