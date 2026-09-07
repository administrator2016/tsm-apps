#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 RECORD ORDER REPAIR v4"
echo "============================================================"

echo
echo "=== 1. VERIFY ==="

test -f "$ADAPTER"
echo "PASS adapter"

echo
echo "=== 2. BACKUP ==="

BACKUP="${ADAPTER}.pre-record-order-v4.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. LOCATE AR-ACTION FUNCTION ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()

start = text.find("function recordActionResult(result)")
if start == -1:
    raise SystemExit("FAIL recordActionResult() not found")

next_func = text.find("\n  function ", start + 10)
next_global = text.find("\n  global.TSMARRecoveryCareer", start + 10)

ends = [x for x in (next_func, next_global) if x != -1]
if not ends:
    raise SystemExit("FAIL recordActionResult() boundary not found")

end = min(ends)
func = text[start:end]

# Locate the three canonical Phase-4 competency attempts.
attempt_marker = re.compile(
    r"(?P<indent>    )if\s*\(\s*engine\s*&&\s*"
    r"typeof\s+engine\.recordAttempt\s*===\s*['\"]function['\"]\s*\)\s*\{"
)

attempt_matches = list(attempt_marker.finditer(func))

if len(attempt_matches) != 1:
    raise SystemExit(
        f"FAIL expected exactly 1 recordAttempt block, found {len(attempt_matches)}"
    )

attempt_match = attempt_matches[0]
attempt_start = attempt_match.start()

# Locate the matching closing brace for the attempt block.
def matching_brace(source, open_pos):
    depth = 0
    quote = None
    escape = False

    for i in range(open_pos, len(source)):
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

    return None

attempt_open = func.find("{", attempt_start)
attempt_end = matching_brace(func, attempt_open)

if attempt_end is None:
    raise SystemExit("FAIL attempt block closing brace not found")

attempt_block = func[attempt_start:attempt_end]

for token in (
    "competency: 'recovery_strategy'",
    "competency: 'payer_strategy'",
    "competency: 'documentation'",
):
    if token not in attempt_block:
        raise SystemExit(f"FAIL missing canonical competency: {token}")

print("PASS canonical Phase-4 attempt block located")

# Locate recordDecision with whitespace-flexible matching.
decision_marker = re.compile(
    r"(?P<indent>    )if\s*\(\s*engine\s*&&\s*"
    r"typeof\s+engine\.recordDecision\s*===\s*['\"]function['\"]\s*\)\s*\{"
)

decision_matches = list(decision_marker.finditer(func))

if len(decision_matches) != 1:
    raise SystemExit(
        f"FAIL expected exactly 1 AR-ACTION recordDecision block, "
        f"found {len(decision_matches)}"
    )

decision_match = decision_matches[0]
decision_start = decision_match.start()

decision_open = func.find("{", decision_start)
decision_end = matching_brace(func, decision_open)

if decision_end is None:
    raise SystemExit("FAIL decision block closing brace not found")

decision_block = func[decision_start:decision_end]

if "scenario: ACTION_SCENARIO.id" not in decision_block:
    raise SystemExit("FAIL located decision block is not AR-ACTION-001")

print("PASS AR-ACTION recordDecision block located")

print()
print("Current order:")
print(
    "  recordAttempt -> recordDecision"
    if attempt_start < decision_start
    else "  recordDecision -> recordAttempt"
)

# Already correct: do nothing.
if decision_start < attempt_start:
    print("PASS order already correct")
    raise SystemExit(0)

# Preserve everything outside the two blocks.
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

# Safety validation before writing.
if new_func.count("competency: 'recovery_strategy'") != 1:
    raise SystemExit("FAIL recovery_strategy count changed")

if new_func.count("competency: 'payer_strategy'") != 1:
    raise SystemExit("FAIL payer_strategy count changed")

if new_func.count("competency: 'documentation'") != 1:
    raise SystemExit("FAIL documentation count changed")

if new_func.count("recordDecision") != 1:
    raise SystemExit("FAIL AR-ACTION recordDecision count changed")

text = text[:start] + new_func + text[end:]
path.write_text(text)

print("PASS decision block moved before Phase-4 attempts")
print("PASS source written")
PY

echo
echo "=== 4. SYNTAX ==="

node --check "$ADAPTER"
echo "PASS adapter syntax"

echo
echo "=== 5. VERIFY FINAL ORDER ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text()

start = text.find("function recordActionResult(result)")
end = text.find("\n  function ", start + 10)

if start == -1 or end == -1:
    raise SystemExit("FAIL could not isolate recordActionResult()")

func = text[start:end]

decision = func.find("recordDecision")
recovery = func.find("competency: 'recovery_strategy'")
payer = func.find("competency: 'payer_strategy'")
documentation = func.find("competency: 'documentation'")

if not all(x >= 0 for x in (decision, recovery, payer, documentation)):
    raise SystemExit("FAIL one or more recording contracts missing")

if not (decision < recovery < payer < documentation):
    raise SystemExit(
        "FAIL final order is not decision -> recovery_strategy -> "
        "payer_strategy -> documentation"
    )

print("PASS recordDecision precedes recovery_strategy")
print("PASS recovery_strategy precedes payer_strategy")
print("PASS payer_strategy precedes documentation")
PY

echo
echo "=== 6. DIFF CHECK ==="

git diff --check
echo "PASS git diff --check"

echo
echo "============================================================"
echo "AR-ACTION-001 RECORD ORDER REPAIR v4: PASS"
echo "============================================================"
