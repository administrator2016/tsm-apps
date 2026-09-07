#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER REPAIR v2"
echo "============================================================"

echo
echo "=== 1. VERIFY FILE ==="

if [[ ! -f "$ADAPTER" ]]; then
  echo "FAIL adapter missing: $ADAPTER"
  exit 1
fi

echo "PASS adapter: $ADAPTER"

echo
echo "=== 2. BACKUP ==="

BACKUP="${ADAPTER}.pre-record-order-v2.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. REORDER RECORDING CONTRACT ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """    if (engine && typeof engine.recordAttempt === 'function') {
      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'recovery_strategy',
          competency: 'recovery_strategy',
          score: actionScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'payer_strategy',
          competency: 'payer_strategy',
          score: reasoningScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'documentation',
          competency: 'documentation',
          score: documentationScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );
    }

    if (engine && typeof engine.recordDecision=== 'function') {
      recorded.push(
        engine.recordDecision({
          scenario: ACTION_SCENARIO.id,
          selectedAccounts: account ? [account] : [],
          reasoningScore: reasoningScore.score,
          recoveryActionScore: actionScore.score
        })
      );
    }
"""

new = """    /*
     * Record the aggregate decision first.
     *
     * TSMRCMEngine.recordDecision() intentionally records its own
     * decision_reasoning / recovery_action attempts.  Those are useful
     * aggregate engine records, but AR-ACTION-001 also has three
     * canonical Phase-4 career competencies:
     *
     *   recovery_strategy
     *   payer_strategy
     *   documentation
     *
     * Recording the aggregate decision first keeps the three canonical
     * AR-ACTION competency attempts together as the latest scenario
     * attempts without removing or weakening the existing decision record.
     */
    if (engine && typeof engine.recordDecision === 'function') {
      recorded.push(
        engine.recordDecision({
          scenario: ACTION_SCENARIO.id,
          selectedAccounts: account ? [account] : [],
          reasoningScore: reasoningScore.score,
          recoveryActionScore: actionScore.score
        })
      );
    }

    if (engine && typeof engine.recordAttempt === 'function') {
      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'recovery_strategy',
          competency: 'recovery_strategy',
          score: actionScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'payer_strategy',
          competency: 'payer_strategy',
          score: reasoningScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'documentation',
          competency: 'documentation',
          score: documentationScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );
    }
"""

if old not in text:
    print("FAIL: expected AR-ACTION recording block not found")
    sys.exit(1)

if text.count(old) != 1:
    print("FAIL: expected exactly one AR-ACTION recording block")
    sys.exit(1)

text = text.replace(old, new, 1)
path.write_text(text)

print("PASS aggregate decision moved before Phase-4 attempts")
print("PASS recovery_strategy remains")
print("PASS payer_strategy remains")
print("PASS documentation remains")
print("PASS existing decision record preserved")
PY

echo
echo "=== 4. SYNTAX ==="

if node --check "$ADAPTER"; then
  echo "PASS adapter syntax"
else
  echo "FAIL adapter syntax"
  exit 1
fi

echo
echo "=== 5. CONTRACT CHECKS ==="

grep -q "competency: 'recovery_strategy'" "$ADAPTER" \
  && echo "PASS recovery_strategy recording" \
  || { echo "FAIL recovery_strategy recording"; exit 1; }

grep -q "competency: 'payer_strategy'" "$ADAPTER" \
  && echo "PASS payer_strategy recording" \
  || { echo "FAIL payer_strategy recording"; exit 1; }

grep -q "competency: 'documentation'" "$ADAPTER" \
  && echo "PASS documentation recording" \
  || { echo "FAIL documentation recording"; exit 1; }

grep -q "engine.recordDecision" "$ADAPTER" \
  && echo "PASS aggregate decision recording preserved" \
  || { echo "FAIL aggregate decision recording missing"; exit 1; }

echo
echo "=== 6. ORDER CHECK ==="

DECISION_LINE="$(grep -n "engine.recordDecision" "$ADAPTER" | tail -1 | cut -d: -f1)"
RECOVERY_LINE="$(grep -n "competency: 'recovery_strategy'" "$ADAPTER" | tail -1 | cut -d: -f1)"
PAYER_LINE="$(grep -n "competency: 'payer_strategy'" "$ADAPTER" | tail -1 | cut -d: -f1)"
DOC_LINE="$(grep -n "competency: 'documentation'" "$ADAPTER" | tail -1 | cut -d: -f1)"

echo "recordDecision:       $DECISION_LINE"
echo "recovery_strategy:    $RECOVERY_LINE"
echo "payer_strategy:      $PAYER_LINE"
echo "documentation:       $DOC_LINE"

if [[ "$DECISION_LINE" -lt "$RECOVERY_LINE" &&
      "$RECOVERY_LINE" -lt "$PAYER_LINE" &&
      "$PAYER_LINE" -lt "$DOC_LINE" ]]; then
  echo "PASS recording order"
else
  echo "FAIL recording order"
  exit 1
fi

echo
echo "=== 7. GIT DIFF CHECK ==="

if git diff --check; then
  echo "PASS git diff --check"
else
  echo "FAIL git diff --check"
  exit 1
fi

echo
echo "=== 8. RESULT ==="
echo "AR-ACTION-001 RECORD ORDER REPAIR v2: PASS"
echo "============================================================"
