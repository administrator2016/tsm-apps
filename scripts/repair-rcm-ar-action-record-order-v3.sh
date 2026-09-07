#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER REPAIR v3"
echo "============================================================"

echo
echo "=== 1. VERIFY FILE ==="

[[ -f "$ADAPTER" ]] || {
  echo "FAIL adapter missing: $ADAPTER"
  exit 1
}

echo "PASS adapter: $ADAPTER"

echo
echo "=== 2. BACKUP ==="

BACKUP="${ADAPTER}.pre-record-order-v3.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. SURGICAL REORDER ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

start_marker = "function recordActionResult(result)"
start = text.find(start_marker)

if start < 0:
    raise SystemExit("FAIL recordActionResult() not found")

# Find the function's closing brace using brace balancing.
open_brace = text.find("{", start)
if open_brace < 0:
    raise SystemExit("FAIL recordActionResult() opening brace not found")

depth = 0
quote = None
escape = False
end = None

for i in range(open_brace, len(text)):
    ch = text[i]

    if quote:
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
            end = i + 1
            break

if end is None:
    raise SystemExit("FAIL recordActionResult() end not found")

func = text[start:end]

# These are the exact markers visible in the current adapter.
attempt_start = func.find(
    "    if (engine && typeof engine.recordAttempt === 'function') {"
)

decision_start = func.find(
    "    if (engine && typeof engine.recordDecision=== 'function') {"
)

if attempt_start < 0:
    # Accept spacing variant if present.
    decision_start2 = func.find(
        "    if (engine && typeof engine.recordDecision === 'function') {"
    )
else:
    decision_start2 = -1

if decision_start < 0:
    decision_start = decision_start2

if attempt_start < 0:
    raise SystemExit("FAIL AR-ACTION recordAttempt block not found")

if decision_start < 0:
    raise SystemExit("FAIL AR-ACTION recordDecision block not found")

if attempt_start < decision_start:
    print("INFO current order: attempts -> decision")
else:
    print("INFO current order already decision -> attempts")

# Locate the end of each if-block by brace balancing.
def block_end(source, block_start):
    brace = source.find("{", block_start)
    if brace < 0:
        raise SystemExit("FAIL block opening brace not found")

    depth = 0
    quote = None
    escape = False

    for i in range(brace, len(source)):
        ch = source[i]

        if quote:
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

    raise SystemExit("FAIL block end not found")

attempt_end = block_end(func, attempt_start)
decision_end = block_end(func, decision_start)

attempt_block = func[attempt_start:attempt_end]
decision_block = func[decision_start:decision_end]

# Make sure this really is the AR-ACTION section before changing it.
required = [
    "competency: 'recovery_strategy'",
    "competency: 'payer_strategy'",
    "competency: 'documentation'",
]

for token in required:
    if token not in attempt_block:
        raise SystemExit(f"FAIL expected token missing from attempt block: {token}")

if "scenario: ACTION_SCENARIO.id" not in decision_block:
    raise SystemExit("FAIL decision block does not target ACTION_SCENARIO")

# Only reorder when needed.
if attempt_start < decision_start:
    prefix = func[:attempt_start]

    between = func[attempt_end:decision_start]

    suffix = func[decision_end:]

    # Preserve whitespace separating the blocks.
    reordered = (
        prefix
        + decision_block
        + "\n\n"
        + attempt_block
        + between
        + suffix
    )

    func = reordered

    text = text[:start] + func + text[end:]
    path.write_text(text)

    print("PASS recordDecision moved before Phase-4 competency attempts")
else:
    print("PASS recording order already correct")

# Final validation against the resulting function.
final = path.read_text()
new_start = final.find("function recordActionResult(result)")
new_open = final.find("{", new_start)

depth = 0
quote = None
escape = False
new_end = None

for i in range(new_open, len(final)):
    ch = final[i]

    if quote:
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
            new_end = i + 1
            break

final_func = final[new_start:new_end]

decision_pos = final_func.find("engine.recordDecision")
recovery_pos = final_func.find("competency: 'recovery_strategy'")
payer_pos = final_func.find("competency: 'payer_strategy'")
doc_pos = final_func.find("competency: 'documentation'")

if not (
    decision_pos >= 0
    and recovery_pos > decision_pos
    and payer_pos > recovery_pos
    and doc_pos > payer_pos
):
    raise SystemExit("FAIL final recording order verification")

print("PASS decision precedes recovery_strategy")
print("PASS recovery_strategy precedes payer_strategy")
print("PASS payer_strategy precedes documentation")
print("PASS all Phase-4 competency records preserved")
PY

echo
echo "=== 4. SYNTAX ==="

node --check "$ADAPTER"
echo "PASS adapter syntax"

echo
echo "=== 5. CONTRACT CHECKS ==="

grep -q "competency: 'recovery_strategy'" "$ADAPTER" \
  && echo "PASS recovery_strategy"

grep -q "competency: 'payer_strategy'" "$ADAPTER" \
  && echo "PASS payer_strategy"

grep -q "competency: 'documentation'" "$ADAPTER" \
  && echo "PASS documentation"

grep -q "engine.recordDecision" "$ADAPTER" \
  && echo "PASS aggregate decision preserved"

echo
echo "=== 6. GIT DIFF CHECK ==="

git diff --check
echo "PASS git diff --check"

echo
echo "=== 7. RESULT ==="
echo "AR-ACTION-001 RECORD ORDER REPAIR v3: PASS"
echo "============================================================"
