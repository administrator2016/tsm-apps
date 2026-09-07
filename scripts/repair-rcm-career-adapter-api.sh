#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

FILE="html/js/career/tsm-ar-recovery-career-adapter.js"
BACKUP="/tmp/tsm-ar-recovery-career-adapter.$(date +%Y%m%d%H%M%S).bak"

echo "============================================================"
echo "TSM RCM CAREER — ADAPTER API REPAIR"
echo "============================================================"

if [ ! -f "$FILE" ]; then
  echo "FAIL     Missing $FILE"
  exit 1
fi

cp "$FILE" "$BACKUP"
echo "BACKUP   $BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    getReadiness: getReadiness,
    mount: mount
"""

new = """    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    recordResult: recordResult,
    getReadiness: getReadiness,
    mount: mount
"""

if "recordResult: recordResult" in text:
    print("PASS     recordResult already exported")
    raise SystemExit(0)

if old not in text:
    print("FAIL     Expected public API block not found")
    raise SystemExit(1)

path.write_text(text.replace(old, new, 1))
print("PASS     Exported recordResult()")
PY

echo
echo "=== 1. SYNTAX ==="

node --check "$FILE"
if [ "$?" -ne 0 ]; then
  echo "FAIL     Adapter syntax"
  cp "$BACKUP" "$FILE"
  exit 1
fi

echo "PASS     Adapter syntax"

echo
echo "=== 2. API EXPORT ==="

if grep -q "recordResult: recordResult" "$FILE"; then
  echo "PASS     recordResult publicly exported"
else
  echo "FAIL     recordResult export missing"
  cp "$BACKUP" "$FILE"
  exit 1
fi

echo
echo "=== 3. DIFF CHECK ==="

git diff --check -- "$FILE"

if [ "$?" -ne 0 ]; then
  echo "FAIL     git diff --check"
  cp "$BACKUP" "$FILE"
  exit 1
fi

echo "PASS     git diff --check"

echo
echo "============================================================"
echo "ADAPTER API REPAIR COMPLETE"
echo "============================================================"
