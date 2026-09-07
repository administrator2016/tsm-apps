#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "============================================================"
echo "TSM RCM CAREER — WORKING TREE SAFETY AUDIT"
echo "============================================================"
echo "ROOT=$ROOT"
echo

echo "=== 1. CURRENT STATUS SUMMARY ==="
git status --short | awk '
  BEGIN {A=0;M=0;D=0;U=0}
  /^\?\?/ {U++; next}
  /^.M|^M./ {M++; next}
  /^.D|^D./ {D++; next}
  {A++}
  END {
    printf "MODIFIED   %d\n", M
    printf "DELETED    %d\n", D
    printf "UNTRACKED  %d\n", U
    printf "OTHER      %d\n", A
  }
'
echo

echo "=== 2. RCM CAREER FILES ==="

for f in \
  html/healthcare/ar-recovery-war-room.html \
  html/js/career/tsm-rcm-career-engine.js \
  html/js/career/tsm-ar-recovery-career-adapter.js \
  scripts/build-rcm-career-phase1.sh \
  scripts/wire-rcm-career-ar.sh \
  scripts/build-rcm-career-phase3.sh
do
  if [[ -f "$f" ]]; then
    echo "PRESENT   $f"
  else
    echo "MISSING   $f"
  fi
done

echo

echo "=== 3. DELETED FILE COUNT ==="

DELETED="$(git status --short | awk '$1 ~ /D/ || $2 ~ /D/ {print}' | wc -l)"

echo "DELETED=$DELETED"

echo

echo "=== 4. FIRST 40 DELETIONS ==="

git status --short |
  awk '$1 ~ /D/ || $2 ~ /D/ {print}' |
  head -40

echo

echo "=== 5. RCM-SPECIFIC DIFF ==="

echo "--- A/R War Room ---"
git diff -- \
  html/healthcare/ar-recovery-war-room.html \
  | head -120

echo

echo "--- Career Engine ---"
git diff -- \
  html/js/career/tsm-rcm-career-engine.js \
  | head -120

echo

echo "--- Career Adapter ---"
git diff -- \
  html/js/career/tsm-ar-recovery-career-adapter.js \
  | head -120

echo

echo "=== 6. UNTRACKED RCM FILES ==="

git status --short |
  grep -E \
    'ar-recovery-war-room|tsm-rcm-career|build-rcm-career|wire-rcm-career' \
    || true

echo

echo "=== 7. GIT DIFF CHECK ==="

git diff --check

echo

echo "============================================================"
echo "SAFETY AUDIT COMPLETE"
echo "============================================================"

if [[ "$DELETED" -gt 0 ]]; then
  echo
  echo "WARNING:"
  echo "There are $DELETED deleted tracked files."
  echo
  echo "DO NOT COMMIT YET."
  echo "We need to establish whether those deletions predate"
  echo "the RCM Career work."
else
  echo
  echo "GOOD:"
  echo "No deleted tracked files detected."
fi
