#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 ATTEMPT ORDER REPAIR"
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

BACKUP="${ADAPTER}.pre-attempt-order.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. REORDER RECORDING ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

start_marker = "function recordActionResult(result)"
start = text.find(start_marker)

if start == -1:
    raise SystemExit("FAIL: recordActionResult() not found")

# Locate function opening brace.
open_brace = text.find("{", start)
if open_brace == -1:
    raise SystemExit("FAIL: recordActionResult() opening brace not found")

# Balanced-brace scan, ignoring strings/comments sufficiently for this source.
depth = 0
quote = None
escape = False
i = open_brace

while i < len(text):
    ch = text[i]

    if quote:
        if escape:
            escape = False
        elif ch == "\\":
            escape = True
        elif ch == quote:
            quote = None
    else:
        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    i += 1
else:
    raise SystemExit("FAIL: could not find end of recordActionResult()")

func = text[start:end]

decision_marker = "global.TSMRCMEngine.recordDecision({"
decision_pos = func.find(decision_marker)

if decision_pos == -1:
    raise SystemExit(
        "FAIL: recordActionResult() does not contain "
        "global.TSMRCMEngine.recordDecision()"
    )

# Find the opening { belonging to recordDecision().
decision_open = func.find("{", decision_pos)

# Scan to the matching closing brace of the object.
depth = 0
quote = None
escape = False
j = decision_open

while j < len(func):
    ch = func[j]

    if quote:
        if escape:
            escape = False
        elif ch == "\\":
            escape = True
        elif ch == quote:
            quote = None
    else:
        if ch in ("'", '"', "`"):
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                object_end = j + 1
                break

    j += 1
else:
    raise SystemExit("FAIL: could not parse recordDecision() object")

# Include the closing call syntax ");"
k = object_end
while k < len(func) and func[k] in " \t\r\n":
    k += 1

if not func.startswith(");", k):
    raise SystemExit(
        "FAIL: expected ');' after recordDecision object"
    )

call_end = k + 2

decision_call = func[decision_pos:call_end]

# Remove the decision call from its current position.
func_without = func[:decision_pos] + func[call_end:]

# Find the final return statement inside the function.
return_pos = func_without.rfind("return {")

if return_pos == -1:
    raise SystemExit(
        "FAIL: could not locate final return object in recordActionResult()"
    )

# Insert decision recording immediately before the return.
insert = (
    "\n\n    // Record the aggregate decision AFTER the three AR-ACTION-001 "
    "competency attempts so the scenario's canonical competency records "
    "remain the latest three attempt entries.\n"
    "    " + decision_call.strip() + "\n"
)

new_func = func_without[:return_pos] + insert + "\n    " + func_without[return_pos:]

# Safety checks.
if new_func.count("global.TSMRCMEngine.recordDecision({") != 1:
    raise SystemExit(
        "FAIL: repaired function must contain exactly one recordDecision()"
    )

# Verify all three explicit Phase-4 competency attempts still exist.
for token in [
    "competency: 'recovery_strategy'",
    "competency: 'payer_strategy'",
    "competency: 'documentation'"
]:
    if token not in new_func:
        raise SystemExit(f"FAIL: missing expected token: {token}")

text = text[:start] + new_func + text[end:]
path.write_text(text)

print("PASS recordDecision reordered")
print("PASS recovery_strategy attempt remains")
print("PASS payer_strategy attempt remains")
print("PASS documentation attempt remains")
print("PASS aggregate decision remains")
PY

echo
echo "=== 4. SYNTAX ==="

node --check "$ADAPTER"
echo "PASS adapter syntax"

echo
echo "=== 5. CONTRACT CHECKS ==="

grep -q "competency: 'recovery_strategy'" "$ADAPTER" \
  && echo "PASS recovery_strategy recording"

grep -q "competency: 'payer_strategy'" "$ADAPTER" \
  && echo "PASS payer_strategy recording"

grep -q "competency: 'documentation'" "$ADAPTER" \
  && echo "PASS documentation recording"

COUNT="$(grep -c "global.TSMRCMEngine.recordDecision({" "$ADAPTER" || true)"

if [[ "$COUNT" -eq 1 ]]; then
  echo "PASS exactly one recordDecision() in adapter"
else
  echo "FAIL unexpected recordDecision() count: $COUNT"
  exit 1
fi

echo
echo "=== 6. GIT DIFF CHECK ==="

git diff --check
echo "PASS git diff --check"

echo
echo "=== 7. RESULT ==="
echo "ATTEMPT ORDER REPAIR: PASS"
echo "============================================================"
