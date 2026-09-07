#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"
ENGINE="html/js/career/tsm-rcm-career-engine.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 CONTRACT REPAIR v2"
echo "============================================================"

FAIL=0

[ -f "$ADAPTER" ] || { echo "FAIL missing $ADAPTER"; exit 1; }
[ -f "$ENGINE" ] || { echo "FAIL missing $ENGINE"; exit 1; }

echo
echo "=== 1. BACKUP CURRENT SOURCE ==="

cp "$ADAPTER" "${ADAPTER}.pre-contract-v2.bak"
cp "$ENGINE" "${ENGINE}.pre-contract-v2.bak"

echo "PASS adapter backup"
echo "PASS engine backup"

python3 - "$ADAPTER" "$ENGINE" <<'PY'
from pathlib import Path
import re
import sys

adapter_path = Path(sys.argv[1])
engine_path = Path(sys.argv[2])

adapter = adapter_path.read_text()
engine = engine_path.read_text()

# ============================================================
# 1. Repair discoverAccounts() status parsing.
#
# The old implementation assumes the LAST table column is
# status. That is unsafe because the A/R queue ends with
# Recommended Action.
# ============================================================

discover_start = adapter.find("function discoverAccounts()")
if discover_start < 0:
    raise SystemExit("ERROR: discoverAccounts() not found")

discover_end = adapter.find("function expectedRanking(", discover_start)
if discover_end < 0:
    raise SystemExit("ERROR: expectedRanking() boundary not found")

discover = adapter[discover_start:discover_end]

# Add status/action header indexes after agingIndex if not already
# present.
if "var statusIndex = headers.findIndex" not in discover:

    aging_pattern = re.compile(
        r"""(\s+var agingIndex = headers\.findIndex\(function \(h\) \{.*?
             \n\s+\}\);\n)""",
        re.S | re.X
    )

    match = aging_pattern.search(discover)

    if not match:
        raise SystemExit("ERROR: agingIndex block not found")

    header_indexes = match.group(1) + r"""
      /*
       * Resolve operational status from its actual header.
       * Do NOT assume the final column is status because the
       * queue may end with Recommended Action.
       */
      var statusIndex = headers.findIndex(function (h) {
        return h === 'status' ||
               h.indexOf('status') >= 0 ||
               h.indexOf('reason') >= 0 ||
               h.indexOf('issue') >= 0 ||
               h.indexOf('denial') >= 0;
      });

      var actionIndex = headers.findIndex(function (h) {
        return h.indexOf('recommended action') >= 0 ||
               h.indexOf('recovery action') >= 0 ||
               h === 'action';
      });

"""

    discover = (
        discover[:match.start()]
        + header_indexes
        + discover[match.end():]
    )

# Replace the fragile status assignment wherever it appears.
fragile_status = re.compile(
    r"""(?P<indent>\s+)var status = cells\.length\s*
          \?\s*normalize\(cells\[cells\.length - 1\]\.textContent\)\s*
          :\s*'';\s*""",
    re.S | re.X
)

if fragile_status.search(discover):
    m = fragile_status.search(discover)
    indent = m.group("indent")

    replacement = f"""{indent}var status = '';

{indent}/*
{indent} * Prefer the actual Status/Issue/Denial column.
{indent} * Recommended Action is intentionally NOT used as the
{indent} * primary status signal.
{indent} */
{indent}if (statusIndex >= 0 && cells[statusIndex]) {{
{indent}  status = normalize(cells[statusIndex].textContent);
{indent}}}

{indent}/*
{indent} * Legacy fallback only when no status header exists.
{indent} */
{indent}if (!status && statusIndex < 0 && actionIndex >= 0 && cells[actionIndex]) {{
{indent}  status = normalize(cells[actionIndex].textContent);
{indent}}}

"""

    discover = discover[:m.start()] + replacement + discover[m.end():]

elif "var statusIndex" not in discover:
    raise SystemExit(
        "ERROR: could not locate existing status assignment for repair"
    )

adapter = adapter[:discover_start] + discover + adapter[discover_end:]

# ============================================================
# 2. Make documentation scoring robust to realistic learner
#    answers such as "Medical necessity letter".
# ============================================================

doc_start = adapter.find("function scoreDocumentation(")
if doc_start < 0:
    raise SystemExit("ERROR: scoreDocumentation() not found")

doc_end = adapter.find("function recordActionResult(", doc_start)
if doc_end < 0:
    raise SystemExit("ERROR: recordActionResult() boundary not found")

doc_func = adapter[doc_start:doc_end]

# Replace only the matching-calculation section. Locate the
# "var matched" through the return object.
matched_start = doc_func.find("var matched =")
return_start = doc_func.find("return {", matched_start)

if matched_start < 0 or return_start < 0:
    raise SystemExit(
        "ERROR: could not locate documentation matching section"
    )

replacement = """var suppliedNormalized = supplied.map(function (doc) {
      return normalizeActionText(doc);
    });

    var matched = expected.documentation.filter(function (item) {
      var target = normalizeActionText(item);

      /*
       * Direct/fuzzy matching.
       */
      if (suppliedNormalized.some(function (doc) {
        return doc.indexOf(target) !== -1 ||
               target.indexOf(doc) !== -1;
      })) {
        return true;
      }

      /*
       * Real-world training synonyms.
       */
      if (
        target.indexOf('medical necessity') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('medical necessity') !== -1;
        })
      ) {
        return true;
      }

      if (
        target.indexOf('clinical') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('clinical') !== -1;
        })
      ) {
        return true;
      }

      if (
        target.indexOf('supporting') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('supporting') !== -1 ||
                 doc.indexOf('medical necessity') !== -1 ||
                 doc.indexOf('clinical') !== -1;
        })
      ) {
        return true;
      }

      if (
        target.indexOf('denial') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('denial') !== -1 ||
                 doc.indexOf('remittance') !== -1;
        })
      ) {
        return true;
      }

      return false;
    });

    """

doc_func = (
    doc_func[:matched_start]
    + replacement
    + doc_func[return_start:]
)

adapter = adapter[:doc_start] + doc_func + adapter[doc_end:]

# ============================================================
# 3. Add Phase-4 competencies to the canonical RCM engine.
# ============================================================

if "'recovery_strategy'" not in engine:
    target = """      'recovery_action',
      'payer_follow_up',
"""

    replacement = """      'recovery_action',
      'recovery_strategy',
      'payer_follow_up',
      'payer_strategy',
"""

    if target not in engine:
        raise SystemExit(
            "ERROR: canonical recovery_action/payer_follow_up block not found"
        )

    engine = engine.replace(target, replacement, 1)

adapter_path.write_text(adapter)
engine_path.write_text(engine)

print("PASS source transformations applied")
PY

PY_STATUS=$?

if [ "$PY_STATUS" -ne 0 ]; then
  echo
  echo "FAIL Python repair stage"
  exit 1
fi

echo
echo "=== 2. SYNTAX ==="

if node --check "$ADAPTER"; then
  echo "PASS adapter syntax"
else
  echo "FAIL adapter syntax"
  FAIL=1
fi

if node --check "$ENGINE"; then
  echo "PASS engine syntax"
else
  echo "FAIL engine syntax"
  FAIL=1
fi

echo
echo "=== 3. CONTRACT CHECKS ==="

grep -q "var statusIndex = headers.findIndex" "$ADAPTER" \
  && echo "PASS status header detection" \
  || { echo "FAIL status header detection"; FAIL=1; }

grep -q "recommended action" "$ADAPTER" \
  && echo "PASS recommended-action separation" \
  || { echo "FAIL recommended-action separation"; FAIL=1; }

grep -q "'recovery_strategy'" "$ENGINE" \
  && echo "PASS recovery_strategy canonical competency" \
  || { echo "FAIL recovery_strategy canonical competency"; FAIL=1; }

grep -q "'payer_strategy'" "$ENGINE" \
  && echo "PASS payer_strategy canonical competency" \
  || { echo "FAIL payer_strategy canonical competency"; FAIL=1; }

grep -q "medical necessity" "$ADAPTER" \
  && echo "PASS medical-necessity documentation matching" \
  || { echo "FAIL medical-necessity documentation matching"; FAIL=1; }

echo
echo "=== 4. DIFF CHECK ==="

if git diff --check; then
  echo "PASS git diff --check"
else
  echo "FAIL git diff --check"
  FAIL=1
fi

echo
echo "=== 5. SHOW REPAIRED AREAS ==="

grep -n -A35 -B5 "var statusIndex" "$ADAPTER" | head -60

echo
grep -n -A20 -B5 "'recovery_strategy'" "$ENGINE" | head -40

echo
echo "============================================================"

if [ "$FAIL" -eq 0 ]; then
  echo "CONTRACT REPAIR v2: PASS"
else
  echo "CONTRACT REPAIR v2: FAIL"
fi

echo "============================================================"

exit "$FAIL"
