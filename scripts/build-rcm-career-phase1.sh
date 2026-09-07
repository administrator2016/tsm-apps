#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

CANONICAL="html/healthcare/ar-recovery-war-room.html"
DUPLICATE="ar-recovery-war-room.html"
ENGINE="html/js/career/tsm-rcm-career-engine.js"

echo "============================================================"
echo "TSM RCM CAREER COMMAND — PHASE 1"
echo "A/R RECOVERY FOUNDATION"
echo "============================================================"
echo "ROOT=$ROOT"
echo

FAIL=0

fail() {
  echo "FAIL: $1"
  FAIL=1
}

echo "=== 1. VERIFY INPUT FILES ==="

if [ -f "$CANONICAL" ]; then
  echo "FOUND    $CANONICAL"
else
  fail "Missing canonical A/R War Room: $CANONICAL"
fi

if [ -f "$DUPLICATE" ]; then
  echo "FOUND    $DUPLICATE"
else
  echo "INFO     Root-level duplicate not present."
fi

echo

if [ "$FAIL" -ne 0 ]; then
  echo
  echo "ABORTED — required input missing."
  exit 1
fi

echo "=== 2. COMPARE A/R WAR ROOM COPIES ==="

if [ -f "$DUPLICATE" ]; then
  if cmp -s "$CANONICAL" "$DUPLICATE"; then
    echo "MATCH    The two A/R files are identical."
  else
    echo "DIFFER   The two A/R files are NOT identical."
    echo
    echo "--- unified diff: canonical vs duplicate ---"
    diff -u "$CANONICAL" "$DUPLICATE" || true
    echo
    echo "IMPORTANT: No file will be deleted automatically."
    echo "The canonical healthcare file remains authoritative."
  fi
fi

echo
echo "=== 3. VERIFY CAREER DIRECTORY ==="

mkdir -p html/js/career

if [ -d html/js/career ]; then
  echo "READY    html/js/career/"
fi

echo
echo "=== 4. CREATE / REFRESH RCM CAREER ENGINE ==="

cat > "$ENGINE" <<'JS'
(function (global) {
  'use strict';

  /*
   * TSM RCM Career Engine
   *
   * Purpose:
   *   Shared career-readiness layer for the Healthcare / RCM track.
   *
   * Architecture:
   *
   *   CRCR
   *      \
   *       -> TSM RCM Career Engine -> Career Command Center
   *      /
   *   A/R Recovery
   *      \
   *       -> Denial Recovery
   *      \
   *       -> Revenue Recovery / Leakage
   *
   * This engine is intentionally lightweight.
   * Existing CRCR state remains authoritative for CRCR.
   */

  const STORAGE_KEY = 'tsm_rcm_career_state_v1';

  const DEFAULT_STATE = {
    version: 1,
    track: 'rcm',
    attempts: [],
    decisions: [],
    competencies: {},
    scenariosCompleted: 0,
    lastActivity: null
  };

  const COMPETENCIES = {
    ar_recovery: [
      'ar_prioritization',
      'aging_analysis',
      'root_cause_identification',
      'recovery_action',
      'payer_follow_up',
      'underpayment_recovery',
      'timely_filing',
      'writeoff_risk'
    ],

    denial_recovery: [
      'denial_root_cause',
      'appeal_strategy',
      'documentation',
      'payer_rules',
      'recovery_probability'
    ],

    revenue_cycle: [
      'claims',
      'eligibility',
      'authorization',
      'coding',
      'billing',
      'collections',
      'compliance'
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    try {
      const raw = global.localStorage &&
        global.localStorage.getItem(STORAGE_KEY);

      if (!raw) return clone(DEFAULT_STATE);

      const parsed = JSON.parse(raw);

      return Object.assign(
        clone(DEFAULT_STATE),
        parsed || {},
        {
          attempts: Array.isArray(parsed && parsed.attempts)
            ? parsed.attempts
            : [],
          decisions: Array.isArray(parsed && parsed.decisions)
            ? parsed.decisions
            : [],
          competencies: (parsed && parsed.competencies) || {}
        }
      );
    } catch (err) {
      return clone(DEFAULT_STATE);
    }
  }

  function saveState(state) {
    state.lastActivity = new Date().toISOString();

    try {
      if (global.localStorage) {
        global.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(state)
        );
      }
    } catch (err) {
      // Storage failure must never break the training application.
    }

    return state;
  }

  function clampScore(score) {
    const n = Number(score);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function competencyScore(competency) {
    const state = loadState();
    const values = state.competencies[competency];

    if (!Array.isArray(values) || !values.length) {
      return null;
    }

    const total = values.reduce(function (sum, value) {
      return sum + clampScore(value);
    }, 0);

    return total / values.length;
  }

  function recordAttempt(input) {
    input = input || {};

    const state = loadState();

    const attempt = {
      id:
        input.id ||
        ('RCM-' + Date.now() + '-' +
          Math.random().toString(36).slice(2, 8)),

      timestamp: new Date().toISOString(),

      domain: input.domain || 'rcm',

      concept: input.concept || 'general_rcm',

      competency: input.competency || 'general_rcm',

      score: clampScore(input.score),

      scenario: input.scenario || null,

      source: input.source || 'career_command',

      metadata: input.metadata || {}
    };

    state.attempts.push(attempt);

    if (!state.competencies[attempt.competency]) {
      state.competencies[attempt.competency] = [];
    }

    state.competencies[attempt.competency].push(attempt.score);

    /*
     * Keep history bounded so localStorage does not grow forever.
     */
    if (state.attempts.length > 500) {
      state.attempts = state.attempts.slice(-500);
    }

    if (state.competencies[attempt.competency].length > 100) {
      state.competencies[attempt.competency] =
        state.competencies[attempt.competency].slice(-100);
    }

    saveState(state);

    return attempt;
  }

  function recordDecision(input) {
    input = input || {};

    const state = loadState();

    const decision = {
      id:
        input.id ||
        ('DEC-' + Date.now() + '-' +
          Math.random().toString(36).slice(2, 8)),

      timestamp: new Date().toISOString(),

      scenario: input.scenario || null,

      selectedAccounts: Array.isArray(input.selectedAccounts)
        ? input.selectedAccounts
        : [],

      reasoningScore: clampScore(input.reasoningScore),

      recoveryActionScore: clampScore(input.recoveryActionScore),

      prioritizationScore:
        input.prioritizationScore == null
          ? null
          : clampScore(input.prioritizationScore),

      source: input.source || 'ar_recovery_war_room',

      metadata: input.metadata || {}
    };

    state.decisions.push(decision);
    state.scenariosCompleted += 1;

    if (state.decisions.length > 250) {
      state.decisions = state.decisions.slice(-250);
    }

    saveState(state);

    /*
     * Feed decision dimensions into shared competencies.
     */
    recordAttempt({
      domain: 'ar_recovery',
      concept: 'decision_reasoning',
      competency: 'ar_prioritization',
      score:
        decision.prioritizationScore != null
          ? decision.prioritizationScore
          : decision.reasoningScore,
      scenario: decision.scenario,
      source: decision.source
    });

    recordAttempt({
      domain: 'ar_recovery',
      concept: 'recovery_action',
      competency: 'recovery_action',
      score: decision.recoveryActionScore,
      scenario: decision.scenario,
      source: decision.source
    });

    return decision;
  }

  function getReadiness() {
    const state = loadState();

    const domains = {};

    Object.keys(COMPETENCIES).forEach(function (domain) {
      const scores = COMPETENCIES[domain]
        .map(function (competency) {
          return competencyScore(competency);
        })
        .filter(function (score) {
          return score != null;
        });

      domains[domain] = {
        score:
          scores.length
            ? scores.reduce(function (a, b) {
                return a + b;
              }, 0) / scores.length
            : null,

        competencies: {}
      };

      COMPETENCIES[domain].forEach(function (competency) {
        domains[domain].competencies[competency] =
          competencyScore(competency);
      });
    });

    const allScores = Object.keys(domains)
      .map(function (domain) {
        return domains[domain].score;
      })
      .filter(function (score) {
        return score != null;
      });

    return {
      track: 'rcm',

      certification: {
        score: domains.revenue_cycle.score
      },

      practical: {
        score: domains.ar_recovery.score
      },

      denialRecovery: {
        score: domains.denial_recovery.score
      },

      overall:
        allScores.length
          ? allScores.reduce(function (a, b) {
              return a + b;
            }, 0) / allScores.length
          : null,

      scenariosCompleted: state.scenariosCompleted,

      lastActivity: state.lastActivity,

      domains: domains
    };
  }

  function getState() {
    return loadState();
  }

  function resetState() {
    const fresh = clone(DEFAULT_STATE);
    saveState(fresh);
    return fresh;
  }

  function getCompetencies() {
    return clone(COMPETENCIES);
  }

  const API = {
    version: '1.0.0',

    storageKey: STORAGE_KEY,

    competencies: getCompetencies,

    getState: getState,

    getReadiness: getReadiness,

    recordAttempt: recordAttempt,

    recordDecision: recordDecision,

    competencyScore: competencyScore,

    resetState: resetState
  };

  /*
   * Browser-global API.
   *
   * Do not overwrite an existing engine if one is already present.
   */
  if (!global.TSMRCMEngine) {
    global.TSMRCMEngine = API;
  }

  /*
   * CommonJS compatibility for Node-based tests.
   */
  if (
    typeof module !== 'undefined' &&
    module.exports
  ) {
    module.exports = API;
  }

})(typeof window !== 'undefined' ? window : globalThis);
JS

echo "CREATED  $ENGINE"

echo
echo "=== 5. VALIDATE ENGINE SYNTAX ==="

if command -v node >/dev/null 2>&1; then
  node --check "$ENGINE"
  if [ "$?" -eq 0 ]; then
    echo "PASS     Node syntax check"
  else
    fail "Node syntax check failed."
  fi
else
  echo "WARN     node command unavailable; syntax check skipped."
fi

echo
echo "=== 6. VERIFY CAREER ENGINE API ==="

if command -v node >/dev/null 2>&1; then
  node - <<'NODE'
const engine = require('./html/js/career/tsm-rcm-career-engine.js');

const required = [
  'getState',
  'getReadiness',
  'recordAttempt',
  'recordDecision',
  'competencyScore',
  'resetState'
];

let fail = false;

for (const key of required) {
  if (typeof engine[key] !== 'function') {
    console.error('MISSING API:', key);
    fail = true;
  } else {
    console.log('FOUND API:', key);
  }
}

if (engine.version !== '1.0.0') {
  console.error('Unexpected version:', engine.version);
  fail = true;
}

if (fail) process.exit(1);

console.log('PASS     RCM Career Engine API');
NODE

  if [ "$?" -ne 0 ]; then
    fail "RCM Career Engine API validation failed."
  fi
else
  echo "WARN     node unavailable; API test skipped."
fi

echo
echo "=== 7. CHECK EXISTING CAREER PLATFORM HOOKS ==="

CAREER="html/tsm-career-training-platform.html"

if [ -f "$CAREER" ]; then
  echo "Career platform:"
  grep -nE \
    "crcr_state|mastery|localStorage|A\\+|MLO|Interview|script.*src" \
    "$CAREER" \
    | head -120 || true
else
  echo "WARN     Career platform file not found."
fi

echo
echo "=== 8. CHECK EXISTING CRCR STATE — READ ONLY ==="

for f in \
  "html/finops-suite/crcr-study-mode.html" \
  "html/healthcare/crcr-scenarios.html" \
  "html/healthcare/crc-hc-exam.html" \
  "html/healthcare/crc-hc-practice.html"
do
  if [ -f "$f" ]; then
    echo "--- $f ---"
    grep -nE \
      "crcr_state|localStorage|mastery|progress|score" \
      "$f" \
      | head -60 || true
  fi
done

echo
echo "=== 9. CHECK A/R WAR ROOM FOR EXISTING CAREER HOOK ==="

grep -nE \
  "TSMRCMEngine|rcm-career|recordAttempt|recordDecision|localStorage|sessionStorage" \
  "$CANONICAL" \
  | head -120 || true

echo
echo "=== 10. DIFF CHECK ==="

git diff --check
if [ "$?" -ne 0 ]; then
  fail "git diff --check failed."
else
  echo "PASS     git diff --check"
fi

echo
echo "=== 11. CHANGE SUMMARY ==="

git status --short -- \
  "$ENGINE" \
  "$CANONICAL" \
  "$DUPLICATE" \
  "scripts/build-rcm-career-phase1.sh"

echo
echo "--- diff stat for our canonical/engine files ---"
git diff --stat -- \
  "$ENGINE" \
  "$CANONICAL" \
  "$DUPLICATE" \
  "scripts/build-rcm-career-phase1.sh" || true

echo
echo "============================================================"

if [ "$FAIL" -eq 0 ]; then
  echo "PHASE 1 FOUNDATION COMPLETE"
  echo
  echo "NO EXISTING CRCR SYSTEM WAS MODIFIED."
  echo "NO EXISTING A/R WAR ROOM CONTENT WAS MODIFIED."
  echo
  echo "NEXT:"
  echo "  1. Review the duplicate A/R diff above."
  echo "  2. Wire the canonical A/R War Room to TSMRCMEngine."
  echo "  3. Add the A/R competency scenario layer."
  echo "  4. Then integrate the Career Command Center."
else
  echo "PHASE 1 STOPPED WITH VALIDATION ERRORS."
  exit 1
fi

echo "============================================================"
