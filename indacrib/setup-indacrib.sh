#!/bin/bash
set -e

# Always operate relative to the folder this script lives in,
# no matter how or from where it was invoked.
cd "$(dirname "$0")"
echo "Running from: $(pwd)"

# ── Clean up any leftovers from a previous run launched from the wrong ──
# ── directory (e.g. ./indacrib/setup-indacrib.sh from the repo root)   ──
REPO_ROOT="$(cd .. && pwd)"
if [ -f "${REPO_ROOT}/apps/web/.env" ] && [ "${REPO_ROOT}/apps" != "$(pwd)/apps" ]; then
  echo "→ Found a stray .env from a previous misplaced run — fixing it ..."
  mkdir -p apps/web
  mv "${REPO_ROOT}/apps/web/.env" apps/web/.env
  # Only remove the stray tree if nothing else was left in it
  find "${REPO_ROOT}/apps" -type f 2>/dev/null | grep -q . || rm -rf "${REPO_ROOT}/apps"
  echo "  Moved to $(pwd)/apps/web/.env"
fi

# ── InDaCrib one-shot Supabase setup ─────────────────────────────
# Run this from inside the indacrib/ folder in your Codespace:
#   chmod +x setup-indacrib.sh && ./setup-indacrib.sh
#
# It will prompt you once for the Supabase service role/secret key
# (from indacrib.txt) since that's the one value not baked in here.
# Everything else is already filled in from what you've shared.
# ───────────────────────────────────────────────────────────────

PROJECT_REF="dhktthxsalqtsiphiaaq"
SUPABASE_URL="https://dhktthxsalqtsiphiaaq.supabase.co"
SUPABASE_ANON_KEY="sb_publishable_OAunTuq114k38gdFVfNFrg_gZrdYY2m"
TMDB_API_KEY="3ffdfb4bd6cef370558ba2750cd96bcc"
SPOTIFY_CLIENT_ID="2114ad3fe9d943d686990e4ab9c9db7b"
SPOTIFY_CLIENT_SECRET="d12d0747ba614038902861d82a2b492e"
: "${OPENAI_API_KEY:?Set OPENAI_API_KEY before running this script}"

echo "InDaCrib Supabase setup"
echo "========================"

# 1. Get the one missing secret interactively (hidden input)
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  read -s -p "Paste your Supabase SECRET key (from indacrib.txt, sb_secret_...): " SUPABASE_SERVICE_ROLE_KEY
  echo ""
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "No service role key entered — aborting."
  exit 1
fi

# 2. Write apps/web/.env
echo "→ Writing apps/web/.env ..."
mkdir -p apps/web
cat > apps/web/.env << EOF
VITE_SUPABASE_URL=${SUPABASE_URL}
VITE_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
EOF

# 3. Log in to Supabase CLI (opens a browser tab if not already authenticated)
echo "→ Checking Supabase CLI auth ..."
if ! supabase projects list > /dev/null 2>&1; then
  supabase login
fi

# 4. Make sure this folder is a Supabase project (creates config.toml if missing,
#    leaves your existing supabase/migrations and supabase/functions untouched)
if [ ! -f "supabase/config.toml" ]; then
  echo "→ No supabase/config.toml found — running supabase init ..."
  supabase init
fi

# 5. Link this folder to the project
echo "→ Linking to project ${PROJECT_REF} ..."
supabase link --project-ref "${PROJECT_REF}"

# 5. Push the database schema
echo "→ Pushing database migration ..."
supabase db push

# 6. Set Edge Function secrets
# (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
#  Supabase into every Edge Function already — the CLI rejects setting them
#  manually, which is expected, not an error.)
echo "→ Setting Edge Function secrets ..."
supabase secrets set \
  TMDB_API_KEY="${TMDB_API_KEY}" \
  SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID}" \
  SPOTIFY_CLIENT_SECRET="${SPOTIFY_CLIENT_SECRET}" \
  OPENAI_API_KEY="${OPENAI_API_KEY}"

# 7. Deploy all four Edge Functions
echo "→ Deploying Edge Functions ..."
supabase functions deploy get-catchphrase
supabase functions deploy get-charades-word
supabase functions deploy get-karaoke-track
supabase functions deploy seed-content

# 8. Seed content once
echo "→ Seeding initial content (catchphrases + charades words) ..."
supabase functions invoke seed-content || echo "  (seed-content invoke failed — you can retry manually later)"

echo ""
echo "Done. apps/web/.env is set, schema is pushed, secrets are set, functions are deployed."
echo "Next: cd apps/web && npm install && npm run dev"
