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
      'recovery_strategy',
      'payer_follow_up',
      'payer_strategy',
      'underpayment_recovery',
      'timely_filing',
      'writeoff_risk'
    ],

    denial_recovery: [
      'denial_root_cause',
      'denial_resolution',
      'appeal_strategy',
      'documentation',
      'payer_rules',
      'recovery_probability'
    ],

    revenue_leakage: [
      'leakage_detection',
      'recovery_strategy',
      'payer_strategy',
      'timely_filing',
      'writeoff_risk'
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

    var state = loadState();

    var decision = {
      id:
        input.id ||
        ('DEC-' + Date.now() + '-' +
          Math.random().toString(36).slice(2, 8)),

      timestamp: new Date().toISOString(),

      scenario:
        input.scenario ||
        input.scenarioId ||
        null,

      domain:
        input.domain ||
        'rcm',

      competency:
        input.competency ||
        null,

      selectedAccounts:
        Array.isArray(input.selectedAccounts)
          ? input.selectedAccounts
          : [],

      selectedAction:
        input.selectedAction ||
        input.decision ||
        null,

      expectedAction:
        input.expectedAction ||
        null,

      reasoning:
        input.reasoning ||
        '',

      documentation:
        input.documentation ||
        '',

      score:
        input.score == null
          ? null
          : clampScore(input.score),

      reasoningScore:
        input.reasoningScore == null
          ? null
          : clampScore(input.reasoningScore),

      recoveryActionScore:
        input.recoveryActionScore == null
          ? null
          : clampScore(input.recoveryActionScore),

      prioritizationScore:
        input.prioritizationScore == null
          ? null
          : clampScore(input.prioritizationScore),

      source:
        input.source ||
        'career_command',

      metadata:
        input.metadata || {}
    };

    state.decisions.push(decision);
    state.scenariosCompleted += 1;

    if (state.decisions.length > 250) {
      state.decisions = state.decisions.slice(-250);
    }

    saveState(state);

    /*
     * Domain-neutral competency evidence.
     *
     * Specialized adapters remain responsible for deciding which
     * competency dimensions to record. The engine only stores them.
     */
    if (
      decision.competency &&
      decision.score != null
    ) {
      recordAttempt({
        domain: decision.domain,
        concept: decision.competency,
        competency: decision.competency,
        score: decision.score,
        scenario: decision.scenario,
        source: decision.source,
        metadata: decision.metadata
      });
    }

    /*
     * Backward-compatible A/R dimension recording.
     *
     * Existing A/R scenarios provide these explicit dimensions.
     */
    if (
      decision.prioritizationScore != null
    ) {
      recordAttempt({
        domain: 'ar_recovery',
        concept: 'decision_reasoning',
        competency: 'ar_prioritization',
        score: decision.prioritizationScore,
        scenario: decision.scenario,
        source: decision.source
      });
    }

    if (
      decision.recoveryActionScore != null
    ) {
      recordAttempt({
        domain: 'ar_recovery',
        concept: 'recovery_action',
        competency: 'recovery_action',
        score: decision.recoveryActionScore,
        scenario: decision.scenario,
        source: decision.source
      });
    }

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
