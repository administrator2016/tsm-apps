#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
TEST="$ROOT/scripts/test-hc-neural-intake.sh"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — ADD BROWSER STORAGE HARNESS"
echo "============================================================"
echo
echo "TEST: $TEST"
echo

cd "$ROOT"

test -f "$TEST"

cp "$TEST" "${TEST}.pre-storage-harness-$(date +%Y%m%d-%H%M%S)"

python3 - "$TEST" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

storage_shim = r'''
function createStorageShim() {
  const store = Object.create(null);

  return {
    getItem(key) {
      key = String(key);
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null;
    },

    setItem(key, value) {
      store[String(key)] = String(value);
    },

    removeItem(key) {
      delete store[String(key)];
    },

    clear() {
      Object.keys(store).forEach(key => delete store[key]);
    },

    key(index) {
      const keys = Object.keys(store);
      return keys[index] || null;
    },

    get length() {
      return Object.keys(store).length;
    }
  };
}
'''

# Insert shim before the vm context.
if "function createStorageShim()" not in s:
    marker = "const context = {"
    pos = s.find(marker)

    if pos == -1:
        print("ERROR: vm context not found")
        sys.exit(1)

    s = s[:pos] + storage_shim + "\n" + s[pos:]

# Add localStorage/sessionStorage to the context.
if "localStorage: createStorageShim()" not in s:
    marker = "  location: {"
    pos = s.find(marker)

    if pos == -1:
        print("ERROR: location block not found")
        sys.exit(1)

    insertion = """  localStorage: createStorageShim(),
  sessionStorage: createStorageShim(),

"""
    s = s[:pos] + insertion + s[pos:]

p.write_text(s)

print("PASS: localStorage/sessionStorage browser shims added")
PY

echo
echo "=== HARNESS SYNTAX ==="
bash -n "$TEST"
echo "PASS: bash syntax"

echo
echo "=== RUN CONNECTED TEST ==="
"$TEST"
