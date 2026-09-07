#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"
ENGINE="html/js/career/tsm-rcm-career-engine.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 CONTRACT REPAIR v3"
echo "============================================================"

FAIL=0

echo
echo "=== 1. VERIFY FILES ==="

if [ -f "$ADAPTER" ]; then
  echo "PASS adapter: $ADAPTER"
else
  echo "FAIL adapter missing: $ADAPTER"
  exit 1
fi

if [ -f "$ENGINE" ]; then
  echo "PASS engine: $ENGINE"
else
  echo "FAIL engine missing: $ENGINE"
  exit 1
fi

echo
echo "=== 2. BACKUP ==="

cp "$ADAPTER" "${ADAPTER}.pre-v3.bak"
cp "$ENGINE" "${ENGINE}.pre-v3.bak"

echo "PASS adapter backup"
echo "PASS engine backup"

python3 - "$ADAPTER" "$ENGINE" <<'PY'
from pathlib import Path
import sys

adapter_path = Path(sys.argv[1])
engine_path = Path(sys.argv[2])

adapter = adapter_path.read_text()
engine = engine_path.read_text()

# ============================================================
# A. Fix discoverAccounts() status parsing.
#
# Current bug:
#
#   var status = cells.length
#     ? normalize(cells[cells.length - 1].textContent)
#     : '';
#
# This treats Recommended Action as the account status.
# ============================================================

old_header = """      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      if (accountIndex < 0 || balanceIndex < 0 || agingIndex < 0) {
        continue;
      }
"""

new_header = """      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      /*
       * Resolve the actual operational status/issue column.
       * Never assume the final column is status because the
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

      if (accountIndex < 0 || balanceIndex < 0 || agingIndex < 0) {
        continue;
      }
"""

if "var statusIndex = headers.findIndex" not in adapter:
    if old_header not in adapter:
        raise SystemExit(
            "ERROR: expected aging/header block not found; "
            "source has changed from inspected version"
        )

    adapter = adapter.replace(old_header, new_header, 1)
    print("PASS status/action header indexes inserted")
else:
    print("PASS status/action header indexes already present")

# ============================================================
# B. Fix status extraction.
# ============================================================

old_status = """        var status = cells.length
          ? normalize(cells[cells.length - 1].textContent)
          : '';

"""

new_status = """        var status = '';

        /*
         * Primary source: actual Status / Issue / Denial column.
         */
        if (statusIndex >= 0 && cells[statusIndex]) {
          status = normalize(cells[statusIndex].textContent);
        }

        /*
         * Legacy fallback only when there is no status-like header.
         * This preserves compatibility without confusing the normal
         * Recommended Action column with the account status.
         */
        if (
          !status &&
          statusIndex < 0 &&
          actionIndex >= 0 &&
          cells[actionIndex]
        ) {
          status = normalize(cells[actionIndex].textContent);
        }

"""

if old_status in adapter:
    adapter = adapter.replace(old_status, new_status, 1)
    print("PASS status extraction repaired")
elif "statusIndex >= 0 && cells[statusIndex]" in adapter:
    print("PASS status extraction already repaired")
else:
    raise SystemExit(
        "ERROR: expected fragile status extraction not found"
    )

# ============================================================
# C. Repair documentation scoring by replacing the complete
#    function. This avoids fragile matching of an internal block.
# ============================================================

doc_start = adapter.find("  function scoreDocumentation(")
if doc_start < 0:
    raise SystemExit("ERROR: scoreDocumentation() not found")

doc_end = adapter.find("  function recordActionResult(", doc_start)
if doc_end < 0:
    raise SystemExit(
        "ERROR: recordActionResult() boundary not found"
    )

old_doc_function = adapter[doc_start:doc_end]

new_doc_function = r"""  function scoreDocumentation(selectedDocumentation, account) {
    var expected = expectedRecoveryAction(account);
    var supplied = Array.isArray(selectedDocumentation)
      ? selectedDocumentation
      : [];

    var suppliedNormalized = supplied
      .map(function (doc) {
        return normalizeActionText(doc);
      })
      .filter(Boolean);

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
       * Medical-necessity synonyms.
       */
      if (
        target.indexOf('medical necessity') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('medical necessity') !== -1;
        })
      ) {
        return true;
      }

      /*
       * Clinical/supporting documentation are valid equivalents
       * when the expected requirement is broad clinical support.
       */
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

      /*
       * Denial/remittance terminology.
       */
      if (
        target.indexOf('denial') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('denial') !== -1 ||
                 doc.indexOf('remittance') !== -1;
        })
      ) {
        return true;
      }

      /*
       * Appeal/timely-filing terminology.
       */
      if (
        target.indexOf('appeal') !== -1 &&
        suppliedNormalized.some(function (doc) {
          return doc.indexOf('appeal') !== -1 ||
                 doc.indexOf('timely filing') !== -1;
        })
      ) {
        return true;
      }

      return false;
    });

    var score =
      matched.length / Math.max(1, expected.documentation.length);

    return {
      score: score,
      percentage: Math.round(score * 100),
      matched: matched
    };
  }

"""

adapter = adapter[:doc_start] + new_doc_function + adapter[doc_end:]
print("PASS documentation scorer repaired")

# ============================================================
# D. Add Phase-4 competencies to canonical engine.
# ============================================================

if "'recovery_strategy'" not in engine:
    old_competencies = """      'root_cause_identification',
      'recovery_action',
      'payer_follow_up',
      'underpayment_recovery',
"""

    new_competencies = """      'root_cause_identification',
      'recovery_action',
      'recovery_strategy',
      'payer_follow_up',
      'payer_strategy',
      'underpayment_recovery',
"""

    if old_competencies not in engine:
        raise SystemExit(
            "ERROR: canonical competency block not found"
        )

    engine = engine.replace(
        old_competencies,
        new_competencies,
        1
    )

    print("PASS canonical Phase-4 competencies added")
else:
    print("PASS canonical Phase-4 competencies already present")

adapter_path.write_text(adapter)
engine_path.write_text(engine)

print("PASS all source changes written")
PY

PY_STATUS=$?

if [ "$PY_STATUS" -ne 0 ]; then
  echo
  echo "FAIL source repair"
  echo "No source write occurred after the failed transformation."
  exit 1
fi

echo
echo "=== 3. SYNTAX ==="

node --check "$ADAPTER" \
  && echo "PASS adapter syntax" \
  || { echo "FAIL adapter syntax"; FAIL=1; }

node --check "$ENGINE" \
  && echo "PASS engine syntax" \
  || { echo "FAIL engine syntax"; FAIL=1; }

echo
echo "=== 4. CONTRACT CHECKS ==="

grep -q "var statusIndex = headers.findIndex" "$ADAPTER" \
  && echo "PASS status header detection" \
  || { echo "FAIL status header detection"; FAIL=1; }

grep -q "var actionIndex = headers.findIndex" "$ADAPTER" \
  && echo "PASS recommended-action detection" \
  || { echo "FAIL recommended-action detection"; FAIL=1; }

grep -q "statusIndex >= 0 && cells\[statusIndex\]" "$ADAPTER" \
  && echo "PASS operational status extraction" \
  || { echo "FAIL operational status extraction"; FAIL=1; }

grep -q "'recovery_strategy'" "$ENGINE" \
  && echo "PASS recovery_strategy canonical competency" \
  || { echo "FAIL recovery_strategy canonical competency"; FAIL=1; }

grep -q "'payer_strategy'" "$ENGINE" \
  && echo "PASS payer_strategy canonical competency" \
  || { echo "FAIL payer_strategy canonical competency"; FAIL=1; }

grep -q "function scoreDocumentation" "$ADAPTER" \
  && echo "PASS documentation scorer" \
  || { echo "FAIL documentation scorer"; FAIL=1; }

echo
echo "=== 5. GIT DIFF CHECK ==="

git diff --check \
  && echo "PASS git diff --check" \
  || { echo "FAIL git diff --check"; FAIL=1; }

echo
echo "=== 6. RESULT ==="

if [ "$FAIL" -eq 0 ]; then
  echo "CONTRACT REPAIR v3: PASS"
else
  echo "CONTRACT REPAIR v3: FAIL"
fi

echo "============================================================"

exit "$FAIL"
