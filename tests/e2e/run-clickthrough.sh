#!/usr/bin/env bash
set -euo pipefail

SUITE_ONLY_ARG="${1:-}"
SERVER_LOG="/tmp/server.log"
PORT=3000

echo "=== TSM click-through: one-shot runner ==="

if [ -z "${TSM_ADMIN_PASSWORD:-}" ]; then
  read -r -s -p "Admin password: " TSM_ADMIN_PASSWORD
  echo
fi
if [ -z "$TSM_ADMIN_PASSWORD" ]; then
  echo "ERROR: admin password was empty -- aborting." >&2
  exit 1
fi

if [ -z "${GROQ_API_KEY:-}" ]; then
  read -r -s -p "GROQ_API_KEY: " GROQ_API_KEY
  echo
fi
if [ -z "$GROQ_API_KEY" ]; then
  echo "ERROR: GROQ_API_KEY was empty -- aborting." >&2
  exit 1
fi

if [ -z "${TSM_SESSION_SECRET:-}" ]; then
  TSM_SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  echo "Generated a random TSM_SESSION_SECRET for this run."
fi

export TSM_ADMIN_PASSWORD GROQ_API_KEY TSM_SESSION_SECRET

echo "Clearing port ${PORT}..."
kill -9 "$(lsof -ti:${PORT})" 2>/dev/null || true
sleep 1

echo "Starting server.js..."
node server.js > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

BOUND=0
for i in $(seq 1 20); do
  if lsof -i:${PORT} >/dev/null 2>&1; then
    BOUND=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [ "$BOUND" -ne 1 ]; then
  echo "ERROR: server never bound to port ${PORT}. Log follows:" >&2
  cat "$SERVER_LOG" >&2
  exit 1
fi

echo "Server is listening on port ${PORT} (pid ${SERVER_PID})."

# TSM FIX: this wrapper was written against an earlier version of
# puppeteer-clickthrough.js that read SUITE_LOGIN_PASS / SUITE_ONLY. The
# file was rebuilt 2026-08-29 and now reads TSM_AUTH_PASSWORD / TSM_ONLY
# instead -- the old names were silently ignored (no error, the script
# just ran unauthenticated against every vertical regardless of the arg).
if [ -n "$SUITE_ONLY_ARG" ]; then
  echo "Running click-through for vertical: ${SUITE_ONLY_ARG}"
  TSM_AUTH_PASSWORD="$TSM_ADMIN_PASSWORD" TSM_ONLY="$SUITE_ONLY_ARG" \
    node tests/e2e/puppeteer-clickthrough.js
else
  echo "Running full click-through suite (all verticals)."
  TSM_AUTH_PASSWORD="$TSM_ADMIN_PASSWORD" \
    node tests/e2e/puppeteer-clickthrough.js
fi
TEST_EXIT=$?

echo
echo "Server (pid ${SERVER_PID}) left running on port ${PORT} for follow-up debugging."
echo "Stop it with: kill -9 ${SERVER_PID}"

exit $TEST_EXIT
