#!/usr/bin/env bash
# Run from the repo root: /workspaces/tsm-apps
# Finishes the InDaCrib + HotelOps + Sentinel integration safely:
#   - applies both patches if not already applied
#   - removes the misplaced indacrib/.env.example (unrelated MongoDB/QBO/
#     Gmail/FHIR placeholders, not InDaCrib config)
#   - guards indacrib.txt via .gitignore
#   - stages ONLY the exact files touched here (never `git add -A`)
#   - scans the diff for secret patterns before committing
#   - commits and pushes

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "== Repo root: $REPO_ROOT =="

# --- 1. Apply patches if present and not already applied ---
for PATCH in indacrib-hotelops-integration.patch sentinel-concierge-fix.patch; do
  if [ -f "$PATCH" ]; then
    if git apply --check "$PATCH" 2>/dev/null; then
      echo "Applying $PATCH ..."
      git apply "$PATCH"
    else
      echo "$PATCH already applied or doesn't match current state — skipping."
    fi
  else
    echo "$PATCH not found in repo root — skipping (place it here if you haven't yet)."
  fi
done

# --- 2. Remove the misplaced env example (confirmed unrelated to InDaCrib) ---
if [ -f "indacrib/.env.example" ]; then
  echo "Removing misplaced indacrib/.env.example ..."
  git rm -f --cached indacrib/.env.example 2>/dev/null || true
  rm -f indacrib/.env.example
fi

# --- 3. Guard indacrib.txt permanently ---
if ! grep -qx "indacrib.txt" .gitignore 2>/dev/null; then
  echo "indacrib.txt" >> .gitignore
  echo "Added indacrib.txt to .gitignore"
fi
if git ls-files --error-unmatch indacrib.txt >/dev/null 2>&1; then
  echo "WARNING: indacrib.txt is still tracked — removing from index."
  git rm --cached indacrib.txt
fi

# --- 4. Stage ONLY the known-good files, never a blanket add ---
FILES_TO_STAGE=(
  "html/hotelops/hotelops-war-room.html"
  "html/hotelops/hotelops/hotelops-tabs.js"
  "html/hotelops/hotelops/indacrib-tab.js"
  "html/sentinel-center.html"
  ".gitignore"
)

for f in "${FILES_TO_STAGE[@]}"; do
  if [ -f "$f" ]; then
    git add "$f"
  fi
done

echo
echo "== Staged files =="
git status --short

# --- 5. Secret scan before commit ---
echo
echo "== Scanning staged diff for secret patterns =="
if git diff --cached | grep -iE "sk-proj-|sb_secret_|service_role.*=.*['\"]" ; then
  echo
  echo "!!! Possible secret detected in staged changes. Aborting commit. !!!"
  echo "Review the lines above, unstage the offending file, and re-run this script."
  exit 1
else
  echo "Clean — no known secret patterns found."
fi

# --- 6. Commit + push ---
echo
read -p "Commit and push these changes? [y/N] " CONFIRM
if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
  git commit -m "Add InDaCrib guest tab to HotelOps, register Concierge in Sentinel, remove stray env example"
  git push origin main:main
  echo "Done."
else
  echo "Skipped commit/push. Changes remain staged for you to review."
fi
