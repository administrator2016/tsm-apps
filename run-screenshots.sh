#!/usr/bin/env bash
set -e

echo "=== Preparing screenshots folder ==="
mkdir -p screenshots

echo "=== Checking server is up on localhost:3000 ==="
if ! curl -s http://localhost:3000 > /dev/null; then
  echo "Server doesn't seem to be running on localhost:3000."
  echo "Start it first (e.g. npm start) in another terminal, then re-run this script."
  exit 1
fi

echo "=== Running test-honeywell-pilot.js (all 3 scenarios) ==="
node test-honeywell-pilot.js

echo ""
echo "=== Done. Screenshots produced: ==="
ls -la screenshots/

EXPECTED="cyber-strategist.png cyber-executive.png plant-strategist.png plant-executive.png supplier-strategist.png supplier-executive.png"
MISSING=""
for f in $EXPECTED; do
  if [ ! -f "screenshots/$f" ]; then
    MISSING="$MISSING $f"
  fi
done

if [ -n "$MISSING" ]; then
  echo ""
  echo "⚠️  Missing expected files:$MISSING"
  echo "Check the filenames used in your page.screenshot() calls match these."
else
  echo ""
  echo "✅ All 6 expected screenshots present. Upload the screenshots/ folder contents to Claude."
fi