#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"
BACKUP="${ADAPTER}.pre-record-order-v6.bak"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER REPAIR v6"
echo "============================================================"
echo

echo "=== 1. VERIFY ==="

[[ -f "$ADAPTER" ]] || {
  echo "FAIL adapter not found"
  exit 1
}

echo "PASS adapter"

echo
echo "=== 2. BACKUP ==="

cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. REPLACE EXACT FUNCTION ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

START = "  function recordActionResult(result) {"
END = "  global.TSMARRecoveryCareer = {"

start = text.find(START)
end = text.find(END, start)

if start == -1:
    raise SystemExit("FAIL recordActionResult start not found")

if end == -1:
    raise SystemExit("FAIL recordActionResult end not found")

old_fn = text[start:end]

new_fn = r"""  function recordActionResult(result) {
    result = result || {};

    var account = result.account || null;
    var actionScore = scoreRecoveryAction(
      account,
      result.selectedAction
    );

    var reasoningScore = scoreActionReasoning(
      result.reasoning,
      account,
      result.selectedAction
    );

    var documentationScore = scoreDocumentation(
      result.documentation,
      account
    );

    var recorded = [];

    var engine =
      global.TSMRCMEngine ||
      null;

    /*
     * IMPORTANT ORDER:
     *
     * recordDecision() internally records:
     *   1. decision_reasoning
     *   2. recovery_action
     *
     * We intentionally execute it FIRST.
     *
     * The three explicit AR-ACTION competency attempts then become
     * the latest three attempts:
     *   1. recovery_strategy
     *   2. payer_strategy
     *   3. documentation
     *
     * This keeps the Career Mastery history aligned with the
     * AR-ACTION-001 competency contract.
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

    return {
      scenario: ACTION_SCENARIO.id,
      account_id: account ? account.account_id : null,
      actionScore: actionScore,
      reasoningScore: reasoningScore,
      documentationScore: documentationScore,
      overallScore:
        Math.round(
          (
            actionScore.score +
            reasoningScore.score +
            documentationScore.score
          ) / 3 * 100
        ) / 100,
      recorded: recorded.length > 0
    };
  }

"""

text = text[:start] + new_fn + text[end:]
path.write_text(text)

print("PASS exact recordActionResult replaced")
print("OLD FUNCTION LENGTH:", len(old_fn))
print("NEW FUNCTION LENGTH:", len(new_fn))
PY

echo
echo "=== 4. VERIFY ORDER ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()

start = text.find("  function recordActionResult(result) {")
end = text.find("  global.TSMARRecoveryCareer = {", start)

if start == -1 or end == -1:
    raise SystemExit("FAIL function boundaries missing")

fn = text[start:end]

decision_pos = fn.find(
    "if (engine && typeof engine.recordDecision === 'function')"
)

attempt_pos = fn.find(
    "if (engine && typeof engine.recordAttempt === 'function')"
)

if decision_pos == -1:
    raise SystemExit("FAIL recordDecision missing")

if attempt_pos == -1:
    raise SystemExit("FAIL recordAttempt missing")

if decision_pos >= attempt_pos:
    raise SystemExit(
        "FAIL recordDecision is still after recordAttempt"
    )

print("PASS recordDecision precedes recordAttempt")
PY

echo
echo "=== 5. VERIFY AR-ACTION COMPETENCIES ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()

start = text.find("  function recordActionResult(result) {")
end = text.find("  global.TSMARRecoveryCareer = {", start)

fn = text[start:end]

expected = [
    "concept: 'recovery_strategy'",
    "concept: 'payer_strategy'",
    "concept: 'documentation'",
]

for token in expected:
    if token not in fn:
        raise SystemExit(f"FAIL missing {token}")
    print(f"PASS {token}")

positions = [fn.find(token) for token in expected]

if positions != sorted(positions):
    raise SystemExit(
        "FAIL competency order is incorrect"
    )

print("PASS competency order is correct")
PY

echo
echo "=== 6. VERIFY ONLY TARGET FUNCTION CHANGED ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()

start = text.find("  function recordActionResult(result) {")
end = text.find("  global.TSMARRecoveryCareer = {", start)

fn = text[start:end]

if fn.count("engine.recordDecision(") != 1:
    raise SystemExit("FAIL expected exactly one decision call in target function")

if fn.count("engine.recordAttempt(") != 3:
    raise SystemExit("FAIL expected exactly three attempt calls in target function")

print("PASS exactly 1 recordDecision call")
print("PASS exactly 3 recordAttempt calls")
PY

echo
echo "=== 7. NODE SYNTAX ==="

node --check "$ADAPTER"
echo "PASS node syntax"

echo
echo "=== 8. DIFF CHECK ==="

git diff --check -- "$ADAPTER"
echo "PASS git diff --check"

echo
echo "=== 9. FINAL ORDER ==="

sed -n '/function recordActionResult(result) {/,/global.TSMARRecoveryCareer = {/p' \
  "$ADAPTER" \
  | grep -E \
      "recordDecision|recordAttempt|recovery_strategy|payer_strategy|documentation"

echo
echo "============================================================"
echo "AR-ACTION-001 RECORD ORDER REPAIR v6: PASS"
echo "============================================================"
echo
echo "NEXT:"
echo "  bash scripts/test-rcm-career-ar-action-browser.sh"
