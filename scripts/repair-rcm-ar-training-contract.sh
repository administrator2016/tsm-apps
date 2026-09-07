#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

FILE="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR TRAINING CONTRACT REPAIR"
echo "============================================================"

if [ ! -f "$FILE" ]; then
  echo "FAIL     Missing $FILE"
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="/tmp/tsm-ar-recovery-career-adapter.${STAMP}.bak"

cp "$FILE" "$BACKUP"
echo "BACKUP   $BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

anchor = """  global.TSMARRecoveryCareer = {
"""

registration = """  /*
   * Career Training Platform contract.
   *
   * Reuse the canonical AR-QUEUE-001 scenario definition already owned
   * by this adapter. Do not create a second scenario definition.
   */
  global.TSM_AR_TRAINING_SCENARIOS =
    global.TSM_AR_TRAINING_SCENARIOS || {};

  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;

"""

if "global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;" in text:
    print("INFO     Training contract already registered")
else:
    if anchor not in text:
        print("FAIL     Adapter API anchor not found")
        sys.exit(1)

    text = text.replace(anchor, registration + anchor, 1)
    path.write_text(text)
    print("PASS     Registered AR-QUEUE-001 training contract")
PY

echo
echo "=== 1. SYNTAX ==="
node --check "$FILE"
if [ $? -ne 0 ]; then
  echo "FAIL     Adapter syntax"
  exit 1
fi
echo "PASS     Adapter syntax"

echo
echo "=== 2. CONTRACT REGISTRATION ==="
grep -n -A4 -B4 \
  'TSM_AR_TRAINING_SCENARIOS\[SCENARIO.id\]' \
  "$FILE"

if grep -q \
  'TSM_AR_TRAINING_SCENARIOS\[SCENARIO.id\] = SCENARIO;' \
  "$FILE"; then
  echo "PASS     AR-QUEUE-001 contract registered"
else
  echo "FAIL     Contract registration missing"
  exit 1
fi

echo
echo "=== 3. SCENARIO ID ==="
grep -n \
  "id: 'AR-QUEUE-001'" \
  "$FILE"

if grep -q \
  "id: 'AR-QUEUE-001'" \
  "$FILE"; then
  echo "PASS     AR-QUEUE-001 scenario definition present"
else
  echo "FAIL     AR-QUEUE-001 scenario definition missing"
  exit 1
fi

echo
echo "=== 4. DIFF CHECK ==="
git diff --check -- "$FILE"
if [ $? -ne 0 ]; then
  echo "FAIL     git diff --check"
  exit 1
fi
echo "PASS     git diff --check"

echo
echo "============================================================"
echo "AR TRAINING CONTRACT REPAIR COMPLETE"
echo "============================================================"
