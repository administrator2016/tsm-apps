#!/usr/bin/env bash
# Run from the InDaCrib app directory: indacrib/apps/web
# Fetches the current live Vercel deployment URL for this project.
#
# First run will prompt you to log in (opens a browser) and to link this
# directory to the "tsm-apps" project you already created on vercel.com —
# pick the TSM team/scope and the existing project when asked, don't create
# a new one. After that, .vercel/project.json caches the link and future
# runs are non-interactive.

set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "Vercel CLI not found — installing..."
  npm install -g vercel
fi

if [ ! -f ".vercel/project.json" ]; then
  echo "This directory isn't linked to a Vercel project yet."
  echo "Linking now — choose the TSM scope and the existing tsm-apps project when prompted."
  vercel link
fi

echo
echo "== Logged in as =="
vercel whoami

echo
echo "== Latest deployments =="
vercel ls

echo
echo "== Current production URL =="
PROD_URL=$(vercel inspect --wait 2>/dev/null | grep -m1 "https://" | awk '{print $NF}' || true)

if [ -z "$PROD_URL" ]; then
  # Fallback: ask the Vercel API for the production alias directly.
  PROD_URL=$(vercel ls --prod 2>/dev/null | grep -m1 "https://" | awk '{print $2}' || true)
fi

if [ -n "$PROD_URL" ]; then
  echo "$PROD_URL"
  echo
  echo "Paste this URL into the InDaCrib tab in the HotelOps war room to generate the QR code."
else
  echo "Couldn't auto-extract the URL from CLI output above — copy it manually from the"
  echo "'vercel ls' list above, or check the Vercel dashboard directly."
fi
