/*
 * TSM RCM Career Progression
 *
 * Thin progression/evidence contract.
 *
 * TSMRCMEngine remains the ONLY canonical mastery store.
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

  var VERSION = '2.0.0';

  var STAGES = [
    {
      id: 'CRCR',
      title: 'Certified Revenue Cycle Representative',
      domain: 'crcr',
      type: 'certification',
      evidence: []
    },
    {
      id: 'AR-QUEUE-001',
      title: 'A/R Recovery Queue Prioritization',
      domain: 'ar_recovery',
      competency: 'ar_prioritization',
      type: 'scenario',
      minimumScore: 0.80
    },
    {
      id: 'AR-ACTION-001',
      title: 'A/R Recovery Action Selection',
      domain: 'ar_recovery',
      competencies: [
        'recovery_action',
        'recovery_strategy'
      ],
      type: 'scenario',
      minimumScore: 0.80
    },
    {
      id: 'DENIAL-001',
      title: 'Denial Recovery',
      domain: 'denial_recovery',
      competencies: [
        'denial_resolution',
        'appeal_strategy',
        'documentation'
      ],
      type: 'scenario',
      minimumScore: 0.80
    },
    {
      id: 'LEAKAGE-001',
      title: 'Revenue Leakage Detection',
      domain: 'revenue_leakage',
      competencies: [
        'leakage_detection',
        'recovery_strategy',
        'documentation'
      ],
      type: 'scenario',
      minimumScore: 0.80
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

  function scoreForCompetency(engine, competency) {
    if (
      !engine ||
      typeof engine.competencyScore !== 'function'
    ) {
      return null;
    }

    return engine.competencyScore(competency);
  }

  function stageEvidence(stage) {
    var engine = getEngine();

    if (stage.type === 'certification') {
      return {
        available: !!engine,
        complete: false,
        score: null,
        competencies: {}
      };
    }

    if (stage.type === 'readiness') {
      return {
        available: !!engine,
        complete: false,
        score: null,
        competencies: {}
      };
    }

    var competencies =
      stage.competencies ||
      (stage.competency ? [stage.competency] : []);

    var values = {};
    var scores = [];

    competencies.forEach(function (competency) {
      var score = scoreForCompetency(engine, competency);

      values[competency] = score;

      if (score != null) {
        scores.push(score);
      }
    });

    var score =
      scores.length
        ? scores.reduce(function (a, b) {
            return a + b;
          }, 0) / scores.length
        : null;

    return {
      available: !!engine,
      complete:
        score != null &&
        score >= (stage.minimumScore || 0.80),
      score: score,
      competencies: values
    };
  }

  function getReadiness() {
    var engine = getEngine();

    if (
      !engine ||
      typeof engine.getReadiness !== 'function'
    ) {
      return {
        available: false,
        stages: getStages(),
        stageEvidence: {},
        jobReady: false,
        readinessScore: null,
        gaps: getStages().map(function (stage) {
          return stage.id;
        })
      };
    }

    var mastery = engine.getReadiness();
    var evidence = {};
    var completed = [];
    var gaps = [];

    STAGES.forEach(function (stage) {
      if (stage.type === 'readiness') {
        return;
      }

      var result = stageEvidence(stage);
      evidence[stage.id] = result;

      /*
       * CRCR remains certification-authoritative.
       *
       * The career engine does not fabricate a CRCR certification score.
       */
      if (stage.id === 'CRCR') {
        gaps.push('CRCR');
        return;
      }

      if (result.complete) {
        completed.push(stage.id);
      } else {
        gaps.push(stage.id);
      }
    });

    /*
     * JOB-READY requires demonstrated practical recovery evidence.
     * CRCR certification remains an external/certification requirement.
     */
    var practicalStages = [
      'AR-QUEUE-001',
      'AR-ACTION-001',
      'DENIAL-001',
      'LEAKAGE-001'
    ];

    var practicalCompleted =
      practicalStages.filter(function (id) {
        return evidence[id] && evidence[id].complete;
      }).length;

    var practicalScoreValues =
      practicalStages
        .map(function (id) {
          return evidence[id] ? evidence[id].score : null;
        })
        .filter(function (score) {
          return score != null;
        });

    var practicalScore =
      practicalScoreValues.length
        ? practicalScoreValues.reduce(function (a, b) {
            return a + b;
          }, 0) /
          practicalScoreValues.length
        : null;

    var jobReady =
      practicalCompleted === practicalStages.length &&
      practicalScore != null &&
      practicalScore >= 0.80;

    var readinessScore =
      practicalScore == null
        ? null
        : practicalScore;

    return {
      available: true,
      stages: getStages(),
      stageEvidence: evidence,
      completedStages: completed,
      gaps: gaps,
      jobReady: jobReady,
      readinessScore: readinessScore,
      mastery: mastery
    };
  }

  global.TSMRCMCareerProgression = {
    version: VERSION,
    stages: getStages,
    getStages: getStages,
    getStage: getStage,
    getReadiness: getReadiness,
    stageEvidence: stageEvidence
  };

})(window);
