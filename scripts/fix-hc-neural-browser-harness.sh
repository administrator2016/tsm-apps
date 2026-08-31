#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
TEST="$ROOT/scripts/test-hc-neural-intake.sh"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — FIX BROWSER HARNESS"
echo "============================================================"
echo
echo "TEST: $TEST"
echo

cd "$ROOT"

test -f "$TEST"

cp "$TEST" "${TEST}.pre-browser-harness-$(date +%Y%m%d-%H%M%S)"

python3 - "$TEST" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

# Add browser-compatible globals to the vm context.
old = """const context = {
  console,
  globalThis: {},
  window: {},
  document: {},
};"""

new = """const context = {
  console,

  // Browser globals required by the HC OM uploader.
  URLSearchParams,
  URL,
  TextEncoder,
  TextDecoder,

  globalThis: {},
  window: {},
  document: {},

  location: {
    search: ''
  }
};

// Browser aliases.
context.globalThis = context;
context.window = context;"""

if old in s:
    s = s.replace(old, new)
else:
    # Handle slightly different harness formatting.
    marker = "const context = {"
    start = s.find(marker)

    if start == -1:
        print("ERROR: browser vm context not found")
        sys.exit(1)

    end = s.find("};", start)

    if end == -1:
        print("ERROR: browser vm context terminator not found")
        sys.exit(1)

    replacement = """const context = {
  console,
  URLSearchParams,
  URL,
  TextEncoder,
  TextDecoder,
  globalThis: {},
  window: {},
  document: {},
  location: {
    search: ''
  }
};

context.globalThis = context;
context.window = context;"""

    s = s[:start] + replacement + s[end + 2:]

p.write_text(s)

print("PASS: browser globals added to vm harness")
PY

echo
echo "=== HARNESS SYNTAX ==="
bash -n "$TEST"
echo "PASS: bash syntax"

echo
echo "=== RUN CONNECTED TEST ==="
"$TEST"
