#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER FINAL REPAIR"
echo "============================================================"

echo
echo "=== 1. VERIFY ==="

test -f "$ADAPTER"
echo "PASS adapter"

echo
echo "=== 2. BACKUP ==="

BACKUP="${ADAPTER}.pre-record-order-final.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. MOVE DECISION BLOCK BEFORE ATTEMPTS ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

start = text.find("  function recordActionResult(result) {")
if start == -1:
    raise SystemExit("FAIL recordActionResult() not found")

end = text.find("\n  function ", start + 10)
if end == -1:
    end = text.find("\n  global.TSMARRecoveryCareer", start)

if end == -1:
    raise SystemExit("FAIL recordActionResult() boundary not found")

func = text[start:end]

attempt_marker = """    if (engine && typeof engine.recordAttempt === 'function') {"""
decision_marker = """    if (engine && typeof engine.recordDecision=== 'function') {"""

attempt_start = func.find(attempt_marker)
decision_start = func.find(decision_marker)

if attempt_start == -1:
    raise SystemExit("FAIL recordAttempt block not found")

if decision_start == -1:
    raise SystemExit("FAIL recordDecision block not found")

if decision_start < attempt_start:
    print("PASS decision block already precedes attempts")
    raise SystemExit(0)

def find_block_end(source, start_pos):
    brace = source.find("{", start_pos)
    if brace == -1:
        raise SystemExit("FAIL block opening brace not found")

    depth = 0
    quote = None
    escape = False

    for i in range(brace, len(source)):
        ch = source[i]

        if quote is not None:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            continue

        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1

    raise SystemExit("FAIL block closing brace not found")

attempt_end = find_block_end(func, attempt_start)
decision_end = find_block_end(func, decision_start)

attempt_block = func[attempt_start:attempt_end]
decision_block = func[decision_start:decision_end]

# Validate that these are the AR-ACTION blocks we intend to move.
for token in (
    "competency: 'recovery_strategy'",
    "competency: 'payer_strategy'",
    "competency: 'documentation'",
):
    if token not in attempt_block:
        raise SystemExit(f"FAIL expected competency missing: {token}")

if "scenario: ACTION_SCENARIO.id" not in decision_block:
    raise SystemExit("FAIL decision block is not AR-ACTION-001")

# Preserve whitespace outside the two blocks.
before_attempt = func[:attempt_start]
between = func[attempt_end:decision_start]
after_decision = func[decision_end:]

new_func = (
    before_attempt
    + decision_block
    + "\n\n"
    + attempt_block
    + between
    + after_decision
)

text = text[:start] + new_func + text[end:]
path.write_text(text)

print("PASS decision block moved")
print("PASS recovery_strategy preserved")
print("PASS payer_strategy preserved")
print("PASS documentation preserved")
PY

echo
echo "=== 4. SYNTAX ==="

node --check "$ADAPTER"
echo "PASS adapter syntax"

echo
echo "=== 5. VERIFY ORDER ==="

DECISION_LINE="$(grep -n "engine.recordDecision" "$ADAPTER" | tail -1 | cut -d: -f1)"
RECOVERY_LINE="$(grep -n "competency: 'recovery_strategy'" "$ADAPTER" | tail -1 | cut -d: -f1)"
PAYER_LINE="$(grep -n "competency: 'payer_strategy'" "$ADAPTER" | tail -1 | cut -d: -f1)"
DOC_LINE="$(grep -n "competency: 'documentation'" "$ADAPTER" | tail -1 | cut -d: -f1)"

echo "recordDecision:    $DECISION_LINE"
echo "recovery_strategy: $RECOVERY_LINE"
echo "payer_strategy:   $PAYER_LINE"
echo "documentation:    $DOC_LINE"

test "$DECISION_LINE" -lt "$RECOVERY_LINE"
test "$RECOVERY_LINE" -lt "$PAYER_LINE"
test "$PAYER_LINE" -lt "$DOC_LINE"

echo "PASS decision precedes Phase-4 attempts"
echo "PASS Phase-4 attempt order correct"

echo
echo "=== 6. DIFF CHECK ==="

git diff --check
echo "PASS git diff --check"

echo
echo "============================================================"
echo "AR-ACTION-001 RECORD ORDER FINAL REPAIR: PASS"
echo "============================================================"
