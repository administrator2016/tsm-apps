#!/usr/bin/env bash
# Regenerates a Fly.io deploy token for the tsm-shell app and pushes it
# into this repo's FLY_API_TOKEN Actions secret, so fly-deploy.yml can
# actually authenticate. Run this from the Codespaces terminal.
set -euo pipefail

APP_NAME="tsm-shell"
REPO="administrator2016/tsm-apps"

echo "== 1. Checking flyctl =="
if ! command -v flyctl >/dev/null 2>&1; then
  echo "flyctl not found, installing..."
  curl -L https://fly.io/install.sh | sh
  export FLYCTL_INSTALL="$HOME/.fly"
  export PATH="$FLYCTL_INSTALL/bin:$PATH"
fi
flyctl version

echo
echo "== 2. Checking Fly auth =="
if ! flyctl auth whoami >/dev/null 2>&1; then
  echo "Not logged in to Fly. Opening login..."
  flyctl auth login
fi
flyctl auth whoami

echo
echo "== 3. Creating a fresh deploy token for $APP_NAME =="
TOKEN=$(flyctl tokens create deploy -a "$APP_NAME" 2>&1)

if [[ "$TOKEN" != FlyV1* ]]; then
  echo "!! Token creation did not return an expected FlyV1 token. Raw output:"
  echo "$TOKEN"
  exit 1
fi
echo "Token created (not printing it in full)."

echo
echo "== 4. Checking gh CLI auth =="
if ! command -v gh >/dev/null 2>&1; then
  echo "!! gh CLI not found. Install it, or set the secret manually in:"
  echo "   github.com/$REPO/settings/secrets/actions"
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "!! gh CLI not authenticated. Run 'gh auth login' first, then re-run this script."
  exit 1
fi

echo
echo "== 5. Setting FLY_API_TOKEN secret on $REPO =="
echo -n "$TOKEN" | gh secret set FLY_API_TOKEN --repo "$REPO"

echo
echo "== 6. Verifying secret exists (name/date only, not value) =="
gh secret list --repo "$REPO" | grep FLY_API_TOKEN || echo "!! FLY_API_TOKEN not showing in secret list — something went wrong."

echo
echo "Done. Secret is set. Let Claude know and it'll re-trigger fly-deploy.yml."
