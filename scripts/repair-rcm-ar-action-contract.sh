#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"
ENGINE="html/js/career/tsm-rcm-career-engine.js"

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 CONTRACT REPAIR"
echo "============================================================"

FAIL=0

[ -f "$ADAPTER" ] || { echo "FAIL missing $ADAPTER"; exit 1; }
[ -f "$ENGINE" ] || { echo "FAIL missing $ENGINE"; exit 1; }

cp "$ADAPTER" "${ADAPTER}.bak"
cp "$ENGINE" "${ENGINE}.bak"

python3 - "$ADAPTER" "$ENGINE" <<'PY'
from pathlib import Path
import sys

adapter_path = Path(sys.argv[1])
engine_path = Path(sys.argv[2])

adapter = adapter_path.read_text()
engine = engine_path.read_text()

# ------------------------------------------------------------
# 1. Replace fragile "last column = status" parsing.
# ------------------------------------------------------------

old = """      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      if (accountIndex < 0 || balanceIndex < 0 || agingIndex < 0) {
        continue;
      }
"""

new = """      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      /*
       * Status must be resolved from the STATUS header rather than
       * assuming the last table column is status. The operational
       * queue commonly ends with Recommended Action.
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

if old not in adapter:
    raise SystemExit("Could not find aging/header block")

adapter = adapter.replace(old, new, 1)

old = """        var status = cells.length
          ? normalize(cells[cells.length - 1].textContent)
          : '';

        accounts.push({
"""

new = """        /*
         * Prefer the actual status/issue column. If the operational
         * table has no status column, preserve a safe fallback rather
         * than accidentally treating Recommended Action as status.
         */
        var status = '';

        if (statusIndex >= 0 && cells[statusIndex]) {
          status = normalize(cells[statusIndex].textContent);
        }

        if (!status && actionIndex >= 0 && cells[actionIndex]) {
          /*
           * Only use the action column as a fallback when no status
           * signal exists. This keeps legacy tables functional while
           * preventing the normal table layout from misclassification.
           */
          status = normalize(cells[actionIndex].textContent);
        }

        accounts.push({
"""

if old not in adapter:
    raise SystemExit("Could not find status parsing block")

adapter = adapter.replace(old, new, 1)

# ------------------------------------------------------------
# 2. Improve documentation matching for legitimate synonyms.
# ------------------------------------------------------------

old = """    var matched = expected.documentation.filter(function (item) {
      var target = normalizeActionText(item);
      return supplied.some(function (doc) {
        return normalizeActionText(doc).indexOf(target) !== -1 ||
               target.indexOf(normalizeActionText(doc)) !== -1;
      });
    });
"""

new = """    var suppliedNormalized = supplied.map(function (doc) {
      return normalizeActionText(doc);
    });

    var matched = expected.documentation.filter(function (item) {
      var target = normalizeActionText(item);

      /*
       * Direct/fuzzy matching first.
       */
      if (suppliedNormalized.some(function (doc) {
        return doc.indexOf(target) !== -1 ||
               target.indexOf(doc) !== -1;
      })) {
        return true;
      }

      /*
       * Training synonym matching. This allows realistic answers such
       * as "Medical necessity letter" to satisfy a broader requirement
       * such as "Medical necessity or supporting documentation".
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
                 doc.indexOf('medical necessity') !== -1;
        })
      ) {
        return true;
      }

      return false;
    });
"""

if old not in adapter:
    raise SystemExit("Could not find documentation scoring block")

adapter = adapter.replace(old, new, 1)

adapter_path.write_text(adapter)

# ------------------------------------------------------------
# 3. Add the new Phase-4 competencies to the canonical engine.
# ------------------------------------------------------------

old = """      'root_cause_identification',
      'recovery_action',
      'payer_follow_up',
      'underpayment_recovery',
"""

new = """      'root_cause_identification',
      'recovery_action',
      'recovery_strategy',
      'payer_follow_up',
      'payer_strategy',
      'underpayment_recovery',
"""

if old not in engine:
    raise SystemExit("Could not find canonical A/R competency block")

engine = engine.replace(old, new, 1)

engine_path.write_text(engine)

PY

echo
echo "=== 1. SYNTAX ==="

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
echo "=== 2. CONTRACT CHECKS ==="

grep -q "var statusIndex" "$ADAPTER" \
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
echo "=== 3. DIFF CHECK ==="

if git diff --check; then
  echo "PASS git diff --check"
else
  echo "FAIL git diff --check"
  FAIL=1
fi

echo
echo "=== 4. BACKUPS ==="
echo "Created:"
echo "  ${ADAPTER}.bak"
echo "  ${ENGINE}.bak"

echo
echo "============================================================"

if [ "$FAIL" -eq 0 ]; then
  echo "REPAIR: PASS"
else
  echo "REPAIR: FAIL"
fi

echo "============================================================"

exit "$FAIL"
