/*
 * TSM Denial Recovery Career Adapter
 *
 * Thin career-training adapter for the existing
 * Healthcare Denial War Room.
 *
 * This does NOT create another denial engine.
 *
 * Existing operational workflow:
 *
 *   Denial War Room
 *       ↓
 *   existing denial analysis / recovery engines
 *
 * Career layer:
 *
 *   DENIAL-001
 *       ↓
 *   TSMRCMEngine
 *       ↓
 *   Unified Career Mastery
 */

(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var SCENARIO_ID = 'DENIAL-001';

  var SCENARIO = {
    id: SCENARIO_ID,
    domain: 'denial_recovery',
    competency: 'denial_resolution',
    title: 'Denial Recovery',
    prompt:
      'Analyze the denial, identify the root cause, select the strongest ' +
      'recovery path, and explain what documentation or action is required.'
  };

  function normalize(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/\s+/g, ' ');
  }

  function lower(value) {
    return normalize(value).toLowerCase();
  }

  function money(value) {
    var cleaned = normalize(value)
      .replace(/[$,\s]/g, '');

    var number = Number(cleaned);

    return Number.isFinite(number) ? number : 0;
  }

  function days(value) {
    var match = normalize(value).match(/\d+/);

    return match ? Number(match[0]) : 0;
  }

  function headersFromTable(table) {
    var headerRow =
      table.querySelector('thead tr') ||
      table.querySelector('tr');

    if (!headerRow) {
      return [];
    }

    return Array.from(
      headerRow.querySelectorAll('th,td')
    ).map(function (cell) {
      return lower(cell.textContent);
    });
  }

  function findHeader(headers, patterns) {
    for (var i = 0; i < headers.length; i += 1) {
      for (var j = 0; j < patterns.length; j += 1) {
        if (headers[i].indexOf(patterns[j]) !== -1) {
          return i;
        }
      }
    }

    return -1;
  }

  /*
   * DENIAL-001 discovery intentionally consumes the Denial War Room's
   * canonical structured case contract.
   *
   * Do NOT scrape the defect manifest. The only HTML table on this page is
   * the D-01..D-08 defect manifest, not operational denial inventory.
   *
   * A case exists only after the War Room has completed its denial pipeline
   * and populated lastStructuredCase.
   */
  function discoverDenials() {
    var results = [];

    try {
      var bridge = window.TSMDenialWarRoom;
      var sc = bridge && typeof bridge.getStructuredCase === 'function'
        ? bridge.getStructuredCase()
        : null;

      if (!sc || typeof sc !== 'object') {
        return results;
      }

      var financialExposure =
        typeof sc.financialExposure === 'number'
          ? sc.financialExposure
          : money(sc.financialExposure);

      var ageDays = null;

      /*
       * The structured case contract does not currently expose an explicit
       * aging field. Preserve that fact rather than inventing one.
       */
      if (typeof sc.ageDays === 'number') {
        ageDays = sc.ageDays;
      }

      results.push({
        account_id:
          sc.claimId ||
          'DENIAL-CASE',

        payer:
          normalize(sc.payer || ''),

        balance:
          financialExposure,

        age_days:
          ageDays,

        denial_reason:
          normalize(
            [
              sc.denialReasonCode,
              sc.denialCategory,
              sc.rootCauseHypothesis
            ].filter(Boolean).join(' — ')
          ),

        operational_action:
          sc.appealable === false
            ? 'writeoff_review'
            : (
                sc.recoveryLikelihood
                  ? 'recovery_' + String(sc.recoveryLikelihood).toLowerCase()
                  : ''
              ),

        source:
          'hc-denial-war-room:structured-case',

        claim_id:
          sc.claimId || null,

        denial_reason_code:
          sc.denialReasonCode || null,

        denial_category:
          sc.denialCategory || null,

        root_cause:
          sc.rootCauseHypothesis || null,

        appealable:
          typeof sc.appealable === 'boolean'
            ? sc.appealable
            : null,

        appeal_deadline:
          sc.appealDeadline || null,

        recovery_likelihood:
          sc.recoveryLikelihood || null,

        confidence:
          typeof sc.confidence === 'number'
            ? sc.confidence
            : null,

        confidence_tier:
          sc.confidenceTier || null,

        human_review_required:
          typeof sc.humanReviewRequired === 'boolean'
            ? sc.humanReviewRequired
            : null,

        evidence_provenance:
          Array.isArray(sc.evidenceProvenance)
            ? sc.evidenceProvenance
            : []
      });

      return results;
    } catch (err) {
      console.warn(
        '[TSM DENIAL CAREER] structured-case discovery failed',
        err
      );
      return [];
    }
  }

  function expectedRecoveryAction(account) {
    var text = lower(
      [
        account && account.denial_reason,
        account && account.operational_action
      ].join(' ')
    );

    if (/timely filing|filing deadline|appeal deadline/.test(text)) {
      return {
        action: 'appeal',
        urgency: 'CRITICAL'
      };
    }

    if (/medical necessity|clinical|medical policy/.test(text)) {
      return {
        action: 'appeal',
        urgency: 'HIGH'
      };
    }

    if (/prior auth|authorization|preauthorization|authorization/.test(text)) {
      return {
        action: 'appeal',
        urgency: 'HIGH'
      };
    }

    if (/duplicate/.test(text)) {
      return {
        action: 'corrected_claim',
        urgency: 'MEDIUM'
      };
    }

    if (/eligib|coverage/.test(text)) {
      return {
        action: 'eligibility',
        urgency: 'HIGH'
      };
    }

    if (/cob|coordination/.test(text)) {
      return {
        action: 'cob',
        urgency: 'HIGH'
      };
    }

    if (/coding|modifier|diagnosis|procedure/.test(text)) {
      return {
        action: 'corrected_claim',
        urgency: 'HIGH'
      };
    }

    return {
      action: 'root_cause_review',
      urgency: account && account.age_days >= 91
        ? 'HIGH'
        : 'MEDIUM'
    };
  }


  /* TSM_DENIAL_001_STRUCTURED_SCORING_V2 */
  function scoreRecoveryAction(account, action) {
    var selected = lower(action || '');

    var category = lower(
      account && account.denial_category
    );

    var reason = lower(
      account && account.denial_reason
    );

    var rootCause = lower(
      account && account.root_cause
    );

    var operational = lower(
      account && account.operational_action
    );

    var appealable =
      account &&
      typeof account.appealable === 'boolean'
        ? account.appealable
        : null;

    var expected;

    /*
     * The structured denial contract is authoritative.
     * Legacy text fields remain fallback compatibility signals.
     */

    if (appealable === false) {
      expected = 'writeoff_review';

    } else if (
      category === 'timely_filing' ||
      /timely filing|filing deadline|appeal deadline/.test(
        reason + ' ' + rootCause
      )
    ) {
      expected = 'appeal';

    } else if (
      category === 'medical_necessity' ||
      category === 'authorization' ||
      category === 'documentation'
    ) {
      expected = 'appeal';

    } else if (
      category === 'coding' ||
      /coding|cpt|modifier|duplicate|rejection/.test(reason)
    ) {
      expected = 'corrected_claim';

    } else if (
      category === 'eligibility'
    ) {
      expected = 'eligibility';

    } else if (
      /cob|coordination/.test(reason)
    ) {
      expected = 'cob';

    } else if (
      /underpaid|variance|contracted rate/.test(reason)
    ) {
      expected = 'variance';

    } else if (
      /no response|writeoff|write-off/.test(
        reason + ' ' + operational
      )
    ) {
      expected = 'escalate';

    } else {
      expected = 'root_cause_review';
    }

    return selected === expected ? 1 : 0;
  }

  function scoreReasoning(text, account, selectedAction) {
    var value = lower(text);
    var score = 0;

    var concepts = [
      /root cause|cause|why/,
      /denial|payer|remittance/,
      /appeal|reprocess|rebill|corrected|authorization|eligibility|cob/,
      /documentation|clinical|medical record|supporting/,
      /deadline|urgent|urgency|timely/
    ];

    concepts.forEach(function (pattern) {
      if (pattern.test(value)) {
        score += 0.18;
      }
    });

    var expected = expectedRecoveryAction(account);

    if (
      selectedAction &&
      lower(selectedAction) === lower(expected.action)
    ) {
      score += 0.20;
    }

    return Math.max(0, Math.min(1, score));
  }

  function scoreDocumentation(text) {
    var value = lower(text);
    var score = 0;

    [
      /remittance|eob|era/,
      /clinical|medical record|medical necessity/,
      /authorization|prior auth/,
      /claim|corrected claim|rebill/,
      /appeal|payer documentation/,
      /eligibility|cob/
    ].forEach(function (pattern) {
      if (pattern.test(value)) {
        score += 0.2;
      }
    });

    return Math.max(0, Math.min(1, score));
  }

    /* TSM_DENIAL_001_RECORD_RESULT_V2 */
  function recordResult(result) {
    result = result || {};

    var account =
      result.account ||
      result.denial ||
      {};

    var selectedAction =
      result.selectedAction ||
      result.action ||
      '';

    var reasoning =
      result.reasoning ||
      '';

    var documentation =
      result.documentation ||
      '';

    /*
     * Score against the same normalized account object used by the
     * standalone DENIAL-001 contract functions.
     */
    var actionScore = scoreRecoveryAction(
      account,
      selectedAction
    );

    var reasoningScore = scoreReasoning(
      reasoning,
      account,
      selectedAction
    );

    var documentationScore = scoreDocumentation(
      documentation,
      account
    );

    var overallScore =
      (
        actionScore +
        reasoningScore +
        documentationScore
      ) / 3;

    /*
     * Canonical mastery store first.
     *
     * recordDecision() internally records decision_reasoning and
     * recovery_action. Explicit attempts below add the competency
     * evidence without creating another mastery store.
     */
    var recorded = false;

    if (
      window.TSMRCMEngine &&
      typeof window.TSMRCMEngine.recordDecision === 'function'
    ) {
      window.TSMRCMEngine.recordDecision({
        scenarioId: 'DENIAL-001',
        domain: 'denial_recovery',
        competency: 'denial_resolution',
        selectedAction: selectedAction,
        expectedAction: expectedRecoveryAction(account).action,
        reasoning: reasoning,
        documentation: documentation,
        score: overallScore,
        source: 'hc-denial-war-room:career'
      });

      recorded = true;
    }

    if (
      window.TSMRCMEngine &&
      typeof window.TSMRCMEngine.recordAttempt === 'function'
    ) {
      window.TSMRCMEngine.recordAttempt({
        scenario: 'DENIAL-001',
        competency: 'appeal_strategy',
        score: actionScore,
        account_id:
          account.claim_id ||
          account.account_id ||
          'DENIAL-CASE'
      });

      window.TSMRCMEngine.recordAttempt({
        scenario: 'DENIAL-001',
        competency: 'denial_resolution',
        score: reasoningScore,
        account_id:
          account.claim_id ||
          account.account_id ||
          'DENIAL-CASE'
      });

      window.TSMRCMEngine.recordAttempt({
        scenario: 'DENIAL-001',
        competency: 'documentation',
        score: documentationScore,
        account_id:
          account.claim_id ||
          account.account_id ||
          'DENIAL-CASE'
      });

      recorded = true;
    }

    return {
      recorded: recorded,
      scenario: 'DENIAL-001',
      account_id:
        account.claim_id ||
        account.account_id ||
        'DENIAL-CASE',
      actionScore: actionScore,
      reasoningScore: reasoningScore,
      documentationScore: documentationScore,
      overallScore: overallScore
    };
  }

  function getReadiness() {
    var engine = global.TSMRCMEngine;

    if (
      !engine ||
      typeof engine.getReadiness !== 'function'
    ) {
      return null;
    }

    return engine.getReadiness();
  }

  global.TSM_DENIAL_TRAINING_SCENARIOS =
    global.TSM_DENIAL_TRAINING_SCENARIOS || {};

  global.TSM_DENIAL_TRAINING_SCENARIOS[
    SCENARIO_ID
  ] = SCENARIO;

  global.TSMDenialRecoveryCareer = {
    version: VERSION,
    scenario: SCENARIO,
    discoverDenials: discoverDenials,
    expectedRecoveryAction: expectedRecoveryAction,
    scoreRecoveryAction: scoreRecoveryAction,
    scoreReasoning: scoreReasoning,
    scoreDocumentation: scoreDocumentation,
    recordResult: recordResult,
    getReadiness: getReadiness
  };

})(window);
