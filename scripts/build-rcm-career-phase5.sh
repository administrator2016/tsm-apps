#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

ENGINE="html/js/career/tsm-rcm-career-engine.js"
ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"
CAREER_PLATFORM="html/tsm-career-training-platform.html"
AR_WAR_ROOM="html/healthcare/ar-recovery-war-room.html"
CRCR_STUDY="html/finops-suite/crcr-study-mode.html"
DENIAL_WAR_ROOM="html/healthcare/hc-denial-war-room.html"
LEAKAGE_DEMO="html/honorhealth-revenue-leak-snapshot.html"

echo "============================================================"
echo "TSM RCM CAREER — PHASE 5 FOUNDATION"
echo "UNIFIED RCM CAREER PROGRESSION"
echo "============================================================"
echo

echo "=== 1. VERIFY CORE FILES ==="

FILES=(
  "$ENGINE"
  "$ADAPTER"
  "$CAREER_PLATFORM"
  "$AR_WAR_ROOM"
  "$CRCR_STUDY"
  "$DENIAL_WAR_ROOM"
  "$LEAKAGE_DEMO"
)

for file in "${FILES[@]}"; do
  if [[ -f "$file" ]]; then
    echo "PASS $file"
  else
    echo "FAIL missing: $file"
    exit 1
  fi
done

echo
echo "=== 2. BACKUP ADAPTER ==="

BACKUP="${ADAPTER}.pre-phase5-comment.bak"
cp "$ADAPTER" "$BACKUP"
echo "PASS backup: $BACKUP"

echo
echo "=== 3. CORRECT AR-ACTION COMMENT ==="

python3 - "$ADAPTER" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

old = """     * recordDecision() internally records:
     *   1. recovery_strategy
     *   2. payer_strategy
     *   3. documentation
"""

new = """     * recordDecision() internally records:
     *   1. decision_reasoning
     *   2. recovery_action
"""

if old in text:
    text = text.replace(old, new, 1)
    path.write_text(text)
    print("PASS inaccurate recordDecision comment corrected")
elif new in text:
    print("PASS recordDecision comment already correct")
else:
    print("WARN expected comment not found; leaving source unchanged")
PY

echo
echo "=== 4. VERIFY CAREER ENGINE API ==="

node <<'NODE'
const fs = require('fs');
const vm = require('vm');

const file = 'html/js/career/tsm-rcm-career-engine.js';
const code = fs.readFileSync(file, 'utf8');

const context = {
  console,
  window: {},
  localStorage: {
    getItem() { return null; },
    setItem() {}
  },
  sessionStorage: {
    getItem() { return null; },
    setItem() {}
  }
};

context.window = context;
vm.createContext(context);
vm.runInContext(code, context);

if (!context.TSMRCMEngine) {
  throw new Error('TSMRCMEngine not exposed');
}

const required = [
  'getState',
  'getReadiness',
  'recordAttempt',
  'recordDecision',
  'competencyScore',
  'resetState'
];

for (const key of required) {
  if (typeof context.TSMRCMEngine[key] !== 'function') {
    throw new Error(`Missing TSMRCMEngine.${key}`);
  }
  console.log(`PASS TSMRCMEngine.${key}`);
}
NODE

echo
echo "=== 5. VERIFY AR-ACTION CONTRACT ==="

grep -Fq "AR-ACTION-001" "$ADAPTER"
echo "PASS AR-ACTION-001"

grep -Fq "recovery_strategy" "$ADAPTER"
echo "PASS recovery_strategy"

grep -Fq "payer_strategy" "$ADAPTER"
echo "PASS payer_strategy"

grep -Fq "documentation" "$ADAPTER"
echo "PASS documentation"

echo
echo "=== 6. VERIFY PROGRESSION SOURCE MATERIAL ==="

python3 - <<'PY'
from pathlib import Path

checks = {
    "CRCR": Path("html/finops-suite/crcr-study-mode.html"),
    "A/R Recovery": Path("html/healthcare/ar-recovery-war-room.html"),
    "Denial Recovery": Path("html/healthcare/hc-denial-war-room.html"),
    "Revenue Leakage": Path("html/honorhealth-revenue-leak-snapshot.html"),
    "Career Command": Path("html/tsm-career-training-platform.html"),
}

for name, path in checks.items():
    text = path.read_text(errors="ignore")

    if len(text.strip()) < 100:
        raise SystemExit(f"FAIL {name}: source appears empty")

    print(f"PASS {name}: {len(text):,} bytes")
PY

echo
echo "=== 7. VERIFY RCM CAREER DOMAIN IN ENGINE ==="

python3 - "$ENGINE" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()

required = [
    "'ar_recovery'",
    "ar_prioritization",
    "recovery_action",
    "payer_follow_up",
    "timely_filing",
    "writeoff_risk",
]

for token in required:
    if token not in text:
        raise SystemExit(f"FAIL missing engine competency: {token}")
    print(f"PASS engine contains {token}")
PY

echo
echo "=== 8. NODE SYNTAX ==="

node --check "$ENGINE"
echo "PASS engine syntax"

node --check "$ADAPTER"
echo "PASS adapter syntax"

echo
echo "=== 9. DIFF CHECK ==="

git diff --check -- \
  "$ENGINE" \
  "$ADAPTER" \
  "$CAREER_PLATFORM" \
  "$AR_WAR_ROOM"

echo "PASS git diff --check"

echo
echo "=== 10. CREATE PHASE 5 PROGRESSION CONTRACT ==="

CONTRACT="html/js/career/tsm-rcm-career-progression.js"

if [[ -f "$CONTRACT" ]]; then
  echo "PASS progression contract already exists: $CONTRACT"
else
  cat > "$CONTRACT" <<'JS'
/*
 * TSM RCM Career Progression
 *
 * Thin progression contract only.
 *
 * This does NOT create another mastery engine.
 * TSMRCMEngine remains the canonical career mastery store.
 *
 * TRAIN → PRACTICE → RECOVER
 *
 * CRCR
 *   ↓
 * AR-QUEUE-001
 *   ↓
 * AR-ACTION-001
 *   ↓
 * DENIAL-001
 *   ↓
 * LEAKAGE-001
 *   ↓
 * JOB-READY
 */

(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  var STAGES = [
    {
      id: 'CRCR',
      title: 'Certified Revenue Cycle Representative',
      domain: 'crcr',
      type: 'certification'
    },
    {
      id: 'AR-QUEUE-001',
      title: 'A/R Recovery Queue Prioritization',
      domain: 'ar_recovery',
      competency: 'ar_prioritization',
      type: 'scenario'
    },
    {
      id: 'AR-ACTION-001',
      title: 'A/R Recovery Action Selection',
      domain: 'ar_recovery',
      competency: 'recovery_strategy',
      type: 'scenario'
    },
    {
      id: 'DENIAL-001',
      title: 'Denial Recovery',
      domain: 'denial_recovery',
      competency: 'denial_resolution',
      type: 'scenario'
    },
    {
      id: 'LEAKAGE-001',
      title: 'Revenue Leakage Detection',
      domain: 'revenue_leakage',
      competency: 'leakage_detection',
      type: 'scenario'
    },
    {
      id: 'JOB-READY',
      title: 'Revenue Cycle Recovery Job Ready',
      domain: 'career_readiness',
      type: 'readiness'
    }
  ];

  function getStages() {
    return STAGES.slice();
  }

  function getStage(id) {
    for (var i = 0; i < STAGES.length; i += 1) {
      if (STAGES[i].id === id) {
        return STAGES[i];
      }
    }

    return null;
  }

  function getEngine() {
    return global.TSMRCMEngine || null;
  }

  function getReadiness() {
    var engine = getEngine();

    if (!engine || typeof engine.getReadiness !== 'function') {
      return {
        available: false,
        stages: getStages()
      };
    }

    return {
      available: true,
      stages: getStages(),
      mastery: engine.getReadiness()
    };
  }

  global.TSMRCMCareerProgression = {
    version: VERSION,
    stages: getStages,
    getStage: getStage,
    getReadiness: getReadiness
  };

})(window);
JS

  echo "PASS created $CONTRACT"
fi

echo
echo "=== 11. VERIFY PROGRESSION CONTRACT ==="

node --check "$CONTRACT"
echo "PASS progression contract syntax"

grep -Fq "AR-QUEUE-001" "$CONTRACT"
echo "PASS progression includes AR-QUEUE-001"

grep -Fq "AR-ACTION-001" "$CONTRACT"
echo "PASS progression includes AR-ACTION-001"

grep -Fq "DENIAL-001" "$CONTRACT"
echo "PASS progression includes DENIAL-001"

grep -Fq "LEAKAGE-001" "$CONTRACT"
echo "PASS progression includes LEAKAGE-001"

grep -Fq "JOB-READY" "$CONTRACT"
echo "PASS progression includes JOB-READY"

echo
echo "=== 12. FINAL STATUS ==="

git status --short -- \
  "$ENGINE" \
  "$ADAPTER" \
  "$CONTRACT" \
  "$CAREER_PLATFORM" \
  "$AR_WAR_ROOM"

echo
echo "============================================================"
echo "RCM CAREER PHASE 5 FOUNDATION: PASS"
echo "============================================================"
echo
echo "NEXT:"
echo "  1. bash scripts/test-rcm-career-ar-action-browser.sh"
echo "  2. We then wire the progression contract into Career Command"
echo "  3. Next competency: DENIAL-001"
