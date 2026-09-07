#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

echo "============================================================"
echo "TSM REPO — INTENTIONAL ARTIFACT CLEANUP"
echo "============================================================"

echo
echo "=== DELETED TRACKED ARTIFACTS ==="

mapfile -t FILES < <(
  git diff --name-only --diff-filter=D -- \
    '*.sh' '*.py' '*.patch' '*.diff' |
  sort
)

echo "COUNT=${#FILES[@]}"
echo

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Nothing matching .sh/.py/.patch/.diff is currently deleted."
  exit 0
fi

printf '%s\n' "${FILES[@]}"

echo
echo "=== STAGING ONLY THESE INTENTIONAL DELETIONS ==="

git add -u -- "${FILES[@]}"

echo
echo "=== VERIFY STAGED DELETIONS ==="

STAGED=0
while IFS= read -r status; do
  echo "$status"
  STAGED=$((STAGED + 1))
done < <(
  git diff --cached --name-status --diff-filter=D -- \
    '*.sh' '*.py' '*.patch' '*.diff'
)

echo
echo "STAGED_DELETIONS=$STAGED"

echo
echo "=== UNSTAGED DELETIONS LEFT ALONE ==="

git status --short | sed -n '1,80p'

echo
echo "============================================================"
echo "CLEANUP STAGING COMPLETE"
echo "============================================================"
echo
echo "Only deleted .sh/.py/.patch/.diff files were staged."
echo "No other modified/deleted/untracked files were staged."
