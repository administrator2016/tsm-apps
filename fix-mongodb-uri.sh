#!/usr/bin/env bash
# Creates a real Firestore-with-MongoDB-compatibility user credential,
# grants it access, sets MONGODB_URI as a Fly secret on tsm-shell, updates
# the local .env, and reruns the instrumentals test suite to confirm.
#
# Run this from the Codespace, in the repo root (/workspaces/tsm-apps).
# Requires: gcloud (authed to the right GCP account), fly CLI (authed).
set -euo pipefail

DATABASE_ID="tsm-consultz"
USER_CREDS_NAME="tsm-app-user"
HOST="89da3c40-cf0e-4a06-ae72-e98579dc55cd.nam5.firestore.goog"
FLY_APP="tsm-shell"

echo "== Step 0: sanity checks =="
command -v gcloud >/dev/null || { echo "gcloud CLI not found. Install it first: https://cloud.google.com/sdk/docs/install"; exit 1; }
command -v fly >/dev/null || { echo "fly CLI not found."; exit 1; }
command -v jq >/dev/null || { echo "jq not found. Install with: sudo apt-get install -y jq"; exit 1; }

PROJECT_NAME="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROJECT_NAME" ]; then
  echo "No active gcloud project set. Run: gcloud config set project <PROJECT_ID>"
  echo "(This must be the project that owns the '$DATABASE_ID' Firestore database.)"
  exit 1
fi
echo "Using GCP project: $PROJECT_NAME"

echo
echo "== Step 1: create the user credential =="
echo "(If this fails with a permissions error, you need roles/datastore.userCredsAdmin"
echo " on this project — ask whoever administers it.)"
if gcloud firestore user-creds describe "$USER_CREDS_NAME" --database="$DATABASE_ID" >/dev/null 2>&1; then
  echo "'$USER_CREDS_NAME' already exists — resetting its password instead of creating new creds."
  CREDS_JSON="$(gcloud firestore user-creds reset-password "$USER_CREDS_NAME" \
    --database="$DATABASE_ID" \
    --format=json)"
else
  CREDS_JSON="$(gcloud firestore user-creds create "$USER_CREDS_NAME" \
    --database="$DATABASE_ID" \
    --format=json)"
fi

PASSWORD="$(echo "$CREDS_JSON" | jq -r '.securePassword')"
if [ -z "$PASSWORD" ] || [ "$PASSWORD" = "null" ]; then
  echo "Could not parse password from gcloud output. Raw output:"
  echo "$CREDS_JSON"
  exit 1
fi
echo "Credential '$USER_CREDS_NAME' created. Password captured (not printed here)."

echo
echo "== Step 2: grant it access to the database =="
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_NAME" --format='value(projectNumber)')"
PRINCIPAL="principal://firestore.googleapis.com/projects/${PROJECT_NUMBER}/name/databases/${DATABASE_ID}/userCreds/${USER_CREDS_NAME}"

gcloud projects add-iam-policy-binding "$PROJECT_NAME" \
  --member="$PRINCIPAL" \
  --role="roles/datastore.user" \
  --condition="expression=resource.name == \"projects/${PROJECT_NAME}/databases/${DATABASE_ID}\",title=tsm-app-user-db-access" \
  >/dev/null
echo "IAM binding granted (roles/datastore.user, scoped to $DATABASE_ID)."

echo
echo "== Step 3: build the connection string =="
MONGODB_URI="mongodb://${USER_CREDS_NAME}:${PASSWORD}@${HOST}:443/${DATABASE_ID}?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false"

echo
echo "== Step 4: set the Fly secret (triggers a redeploy) =="
fly secrets set MONGODB_URI="$MONGODB_URI" -a "$FLY_APP"

echo
echo "== Step 5: update local .env =="
if [ -f .env ] && grep -q '^MONGODB_URI=' .env; then
  # Replace the existing (placeholder) line in place.
  sed -i.bak "s|^MONGODB_URI=.*|MONGODB_URI=${MONGODB_URI}|" .env
  rm -f .env.bak
  echo "Replaced existing MONGODB_URI line in .env."
else
  echo "MONGODB_URI=${MONGODB_URI}" >> .env
  echo "Appended MONGODB_URI to .env."
fi

echo
echo "== Step 6: wait for Fly deploy to settle, then verify =="
fly status -a "$FLY_APP"
echo "Waiting 15s for the machine to finish restarting with the new secret..."
sleep 15

node test-music-endpoints.js "https://${FLY_APP}.fly.dev"

echo
echo "Done. Password is stored in .env and as a Fly secret only — it will not"
echo "be printed again (Google doesn't let you retrieve it after creation)."