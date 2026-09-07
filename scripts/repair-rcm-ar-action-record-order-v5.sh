#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER REPAIR v5"
echo "============================================================"
echo

echo "=== 1. VERIFY ==="

if [[ ! -f "$ADAPTER" ]]; then
  echo "FAIL adapter not found: $ADAPTER"
  exit 1
fi

echo "PASS adapter"

echo
echo "=== 2. BACKUP ==="

BACKUP="${ADAPTER}.pre-record-order-v5.bak"
cp "$ADAPTER" "$BACKUP"

echo "PASS backup: $BACKUP"

echo
echo "=== 3. SURGICAL REORDER ==="

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
    raise SystemExit("FAIL recordActionResult end marker not found")

fn = text[start:end]

decision_marker = "    if (engine && typeof engine.recordDecision=== 'function') {"
attempt_marker = "    if (engine && typeof engine.recordAttempt === 'function') {"

decision_start = fn.find(decision_marker)
attempt_start = fn.find(attempt_marker)

if decision_start == -1:
    raise SystemExit("FAIL recordDecision block not found")

if attempt_start == -1:
    raise SystemExit("FAIL recordAttempt block not found")

if decision_start < attempt_start:
    print("PASS recordDecision is already before recordAttempt")
    raise SystemExit(0)

# Locate the end of the recordDecision block.
decision_close = fn.find(
    "\n    return {",
    decision_start
)

if decision_close == -1:
    raise SystemExit("FAIL recordDecision block end not found")

decision_block = fn[decision_start:decision_close]

# Locate the end of the Phase-4 recordAttempt block.
attempt_close = fn.find(
    "\n\n    if (engine && typeof engine.recordDecision",
    attempt_start
)

if attempt_close == -1:
    raise SystemExit("FAIL Phase-4 attempt block end not found")

attempt_block = fn[attempt_start:attempt_close]

# Verify the expected Phase-4 competencies are actually in the block.
required = [
    "concept: 'recovery_strategy'",
    "concept: 'payer_strategy'",
    "concept: 'documentation'",
]

for token in required:
    if token not in attempt_block:
        raise SystemExit(
            f"FAIL expected Phase-4 token missing: {token}"
        )

print("PASS canonical Phase-4 attempt block located")
print("PASS AR-ACTION recordDecision block located")
print()
print("Current order:")
print("  recordAttempt -> recordDecision")
print()
print("Moving:")
print("  recordDecision -> recordAttempt")

# Remove both blocks from their current positions.
fn_without = fn.replace(attempt_block, "", 1)
fn_without = fn_without.replace(decision_block, "", 1)

# Recalculate insertion point after removal.
return_marker = "\n    return {"
return_pos = fn_without.find(return_marker)

if return_pos == -1:
    raise SystemExit("FAIL return block not found after extraction")

# Insert decision first, then Phase-4 attempts.
replacement = (
    "\n\n" +
    decision_block +
    "\n\n" +
    attempt_block
)

fn_new = (
    fn_without[:return_pos] +
    replacement +
    fn_without[return_pos:]
)

text_new = text[:start] + fn_new + text[end:]

path.write_text(text_new)

print("PASS recordDecision moved before Phase-4 attempts")
PY

echo
echo "=== 4. VERIFY ORDER ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

start = text.find("  function recordActionResult(result) {")
end = text.find("  global.TSMARRecoveryCareer = {", start)

if start == -1 or end == -1:
    raise SystemExit("FAIL AR-ACTION function boundary missing")

fn = text[start:end]

decision = fn.find(
    "if (engine && typeof engine.recordDecision=== 'function')"
)

attempt = fn.find(
    "if (engine && typeof engine.recordAttempt === 'function')"
)

if decision == -1:
    raise SystemExit("FAIL recordDecision missing")

if attempt == -1:
    raise SystemExit("FAIL recordAttempt missing")

if decision >= attempt:
    raise SystemExit(
        "FAIL recordDecision is still after recordAttempt"
    )

print("PASS order is now:")
print("  recordDecision")
print("    -> decision_reasoning")
print("    -> recovery_action")
print("  recordAttempt")
print("    -> recovery_strategy")
print("    -> payer_strategy")
print("    -> documentation")
PY

echo
echo "=== 5. VERIFY COMPETENCY TOKENS ==="

for token in \
  "concept: 'recovery_strategy'" \
  "concept: 'payer_strategy'" \
  "concept: 'documentation'" \
  "recordDecision=== 'function'"
do
  if grep -Fq "$token" "$ADAPTER"; then
    echo "PASS $token"
  else
    echo "FAIL missing: $token"
    exit 1
  fi
done

echo
echo "=== 6. NODE SYNTAX ==="

node --check "$ADAPTER"
echo "PASS node syntax"

echo
echo "=== 7. DIFF CHECK ==="

git diff --check -- "$ADAPTER"
echo "PASS git diff --check"

echo
echo "=== 8. SHOW FUNCTION ORDER ==="

sed -n '/function recordActionResult(result) {/,/global.TSMARRecoveryCareer = {/p' \
  "$ADAPTER" \
  | grep -E \
      "function recordActionResult|recordAttempt|recordDecision|recovery_strategy|payer_strategy|documentation|return \{" \
  | head -40

echo
echo "============================================================"
echo "AR-ACTION-001 RECORD ORDER REPAIR v5: PASS"
echo "============================================================"
echo
echo "Next:"
echo "  bash scripts/test-rcm-career-ar-action-browser.sh"
