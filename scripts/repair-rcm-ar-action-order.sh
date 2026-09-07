#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

FILE="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 ORDER REPAIR"
echo "============================================================"

if [ ! -f "$FILE" ]; then
  echo "FAIL     Missing $FILE"
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="/tmp/tsm-ar-recovery-career-adapter.order.${STAMP}.bak"
cp "$FILE" "$BACKUP"
echo "BACKUP   $BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

registration = """  global.TSM_AR_TRAINING_SCENARIOS =
    global.TSM_AR_TRAINING_SCENARIOS || {};

  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;
  global.TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO;

"""

old_registration = """  global.TSM_AR_TRAINING_SCENARIOS =
    global.TSM_AR_TRAINING_SCENARIOS || {};

  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;
  global.TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO;
"""

if old_registration not in text:
    print("FAIL     Expected training registration block not found")
    sys.exit(1)

text = text.replace(old_registration, "", 1)

# The action scenario ends immediately before normalizeActionText().
anchor = """  function normalizeActionText(value) {
"""

if anchor not in text:
    print("FAIL     ACTION_SCENARIO boundary not found")
    sys.exit(1)

text = text.replace(
    anchor,
    registration + anchor,
    1
)

path.write_text(text)
print("PASS     Moved training registration after ACTION_SCENARIO definition")
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
echo "=== 2. VERIFY ORDER ==="

ACTION_LINE="$(grep -n "id: 'AR-ACTION-001'" "$FILE" | head -1 | cut -d: -f1)"
REGISTER_LINE="$(grep -n "TSM_AR_TRAINING_SCENARIOS\[ACTION_SCENARIO.id\]" "$FILE" | head -1 | cut -d: -f1)"

echo "ACTION   line=$ACTION_LINE"
echo "REGISTER line=$REGISTER_LINE"

if [ -z "$ACTION_LINE" ] || [ -z "$REGISTER_LINE" ]; then
  echo "FAIL     Could not determine contract order"
  exit 1
fi

if [ "$REGISTER_LINE" -gt "$ACTION_LINE" ]; then
  echo "PASS     ACTION_SCENARIO defined before registration"
else
  echo "FAIL     ACTION_SCENARIO registration still occurs too early"
  exit 1
fi

echo
echo "=== 3. VERIFY BOTH CONTRACTS ==="

grep -n -E \
  "TSM_AR_TRAINING_SCENARIOS.*SCENARIO|AR-ACTION-001" \
  "$FILE" | head -30

if grep -Fq \
  "TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;" \
  "$FILE"; then
  echo "PASS     AR-QUEUE-001 contract registration"
else
  echo "FAIL     AR-QUEUE-001 registration missing"
  exit 1
fi

if grep -Fq \
  "TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO;" \
  "$FILE"; then
  echo "PASS     AR-ACTION-001 contract registration"
else
  echo "FAIL     AR-ACTION-001 registration missing"
  exit 1
fi

echo
echo "=== 4. VERIFY PUBLIC API ==="

for token in \
  "actionScenario: ACTION_SCENARIO" \
  "scoreRecoveryAction: scoreRecoveryAction" \
  "scoreActionReasoning: scoreActionReasoning" \
  "scoreDocumentation: scoreDocumentation" \
  "recordActionResult: recordActionResult"
do
  if grep -Fq "$token" "$FILE"; then
    echo "PASS     $token"
  else
    echo "FAIL     Missing API: $token"
    exit 1
  fi
done

echo
echo "=== 5. DIFF CHECK ==="
git diff --check -- "$FILE"
if [ $? -ne 0 ]; then
  echo "FAIL     git diff --check"
  exit 1
fi
echo "PASS     git diff --check"

echo
echo "============================================================"
echo "AR-ACTION-001 ORDER REPAIR COMPLETE"
echo "============================================================"
echo
echo "NEXT:"
echo "  ./scripts/test-rcm-career-browser.sh"
echo
