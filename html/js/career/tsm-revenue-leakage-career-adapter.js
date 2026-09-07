/*
 * TSM Revenue Leakage Career Adapter
 *
 * LEAKAGE-001
 *
 * Architecture:
 *
 *   Healthcare Portfolio Leakage
 *          ↓
 *   thin career adapter
 *          ↓
 *   LEAKAGE-001
 *          ↓
 *   TSMRCMEngine
 *
 * This adapter does NOT create a second mastery store.
 * TSMRCMEngine remains the canonical competency/evidence store.
 */

(function (window) {
  'use strict';

  window.TSM_LEAKAGE_TRAINING_SCENARIOS =
    window.TSM_LEAKAGE_TRAINING_SCENARIOS || {};

  var SCENARIO = {
    id: 'LEAKAGE-001',
    domain: 'revenue_leakage',
    competency: 'leakage_detection',
    title: 'Revenue Leakage Recovery',
    prompt:
      'Identify the strongest revenue leakage opportunity, quantify the financial exposure, ' +
      'prioritize the recovery opportunity, and explain the evidence and next action.'
  };

  window.TSM_LEAKAGE_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;

  function lower(value) {
    return String(value == null ? '' : value).toLowerCase();
  }

  function number(value) {
    if (typeof value === 'number' && isFinite(value)) {
      return value;
    }

    var cleaned = String(value == null ? '' : value)
      .replace(/[$,%\s,]/g, '');

    var parsed = parseFloat(cleaned);

    return isFinite(parsed) ? parsed : null;
  }

  function textFromDocument() {
    try {
      return document.body ? document.body.innerText || '' : '';
    } catch (error) {
      return '';
    }
  }

  /*
   * Discover leakage opportunities from existing page data.
   *
   * We intentionally inspect structured globals first and only use
   * DOM tables as a compatibility fallback.
   */
  function getCanonicalPortfolioTwin() {
    try {
      if (
        window.TSMHCPortfolioTwin &&
        typeof window.TSMHCPortfolioTwin === 'object'
      ) {
        return window.TSMHCPortfolioTwin;
      }
    } catch (e) {}

    try {
      if (
        window.TSMHealthcarePortfolio &&
        typeof window.TSMHealthcarePortfolio.getPortfolioTwin === 'function'
      ) {
        const twin = window.TSMHealthcarePortfolio.getPortfolioTwin();
        if (twin && typeof twin === 'object') return twin;
      }
    } catch (e) {}

    return null;
  }

  function normalizeCanonicalOpportunity(item, index) {
    if (!item || typeof item !== 'object') return null;

    const claimId =
      item.claimId ||
      item.claim_id ||
      item.accountId ||
      item.account_id ||
      null;

    if (!claimId) return null;

    const exposure =
      item.exposure === null || item.exposure === undefined
        ? null
        : Number(item.exposure);

    const ageDays =
      item.ageDays === null || item.ageDays === undefined
        ? null
        : Number(item.ageDays);

    return {
      id: item.opportunityId || ('LEAKAGE-' + claimId),
      opportunityId: item.opportunityId || null,
      claimId: String(claimId),
      accountId: item.accountId || item.account_id || null,
      payer: item.payer || null,
      exposure: Number.isFinite(exposure) ? exposure : null,
      ageDays: Number.isFinite(ageDays) ? ageDays : null,
      denialReasonCode:
        item.denialReasonCode ||
        item.denial_reason_code ||
        null,
      denialCategory:
        item.denialCategory ||
        item.denial_category ||
        null,
      rootCause:
        item.rootCause ||
        item.root_cause ||
        item.rootCauseHypothesis ||
        item.root_cause_hypothesis ||
        null,
      opportunityType:
        item.opportunityType ||
        item.opportunity_type ||
        null,
      recommendedAction:
        item.recommendedAction ||
        item.recommended_action ||
        null,
      urgency: item.urgency || null,
      appealable:
        item.appealable === undefined
          ? null
          : Boolean(item.appealable),
      appealDeadline:
        item.appealDeadline ||
        item.appeal_deadline ||
        null,
      recoveryLikelihood:
        item.recoveryLikelihood ||
        item.recovery_likelihood ||
        null,
      confidence:
        typeof item.confidence === 'number'
          ? item.confidence
          : null,
      evidenceProvenance:
        Array.isArray(item.evidenceProvenance)
          ? item.evidenceProvenance
          : [],
      runtimeSource:
        item.runtimeSource ||
        item.source ||
        'healthcare-portfolio',
      sourceIndex:
        item.sourceIndex === undefined
          ? index
          : item.sourceIndex,

      // Career adapter provenance.
      careerSource: 'canonical-healthcare-portfolio-leakage'
    };
  }

  function discoverLeakage() {
    const twin = getCanonicalPortfolioTwin();

    if (
      !twin ||
      !Array.isArray(twin.leakageOpportunities)
    ) {
      return [];
    }

    return twin.leakageOpportunities
      .map(normalizeCanonicalOpportunity)
      .filter(Boolean);
  }

  function expectedRecoveryAction(opportunity) {
    var value = lower(
      [
        opportunity && opportunity.leakage_type,
        opportunity && opportunity.operational_action
      ].join(' ')
    );

    if (/underpaid|underpayment|variance|contracted rate|rate variance/.test(value)) {
      return {
        action: 'payer_variance_dispute',
        urgency: 'HIGH'
      };
    }

    if (/denied|denial|appeal/.test(value)) {
      return {
        action: 'appeal',
        urgency: 'HIGH'
      };
    }

    if (/duplicate|rejection|corrected claim/.test(value)) {
      return {
        action: 'corrected_claim',
        urgency: 'MEDIUM'
      };
    }

    if (/eligibility|coverage|cob|coordination/.test(value)) {
      return {
        action: 'eligibility_cob_resolution',
        urgency: 'HIGH'
      };
    }

    if (/write.?off|no response|unresolved/.test(value)) {
      return {
        action: 'escalate_recovery',
        urgency: 'CRITICAL'
      };
    }

    return {
      action: 'root_cause_review',
      urgency: 'MEDIUM'
    };
  }

  function scoreRecoveryAction(opportunity, selectedAction) {
    var expected = expectedRecoveryAction(opportunity);

    return lower(selectedAction) === lower(expected.action) ? 1 : 0;
  }

  function scoreReasoning(text, opportunity, selectedAction) {
    var value = lower(text);
    var score = 0;

    [
      /root cause|cause|why/,
      /leak|leakage|underpaid|variance|revenue/,
      /financial|exposure|amount|dollar|\$/,
      /payer|contract|claim|remittance|eob|era/,
      /recover|recovery|appeal|dispute|rebill|corrected/,
      /priority|urgent|urgency|deadline/
    ].forEach(function (pattern) {
      if (pattern.test(value)) {
        score += 0.14;
      }
    });

    if (
      selectedAction &&
      lower(selectedAction) ===
        lower(expectedRecoveryAction(opportunity).action)
    ) {
      score += 0.16;
    }

    return Math.max(0, Math.min(1, score));
  }

  function scoreDocumentation(text) {
    var value = lower(text);
    var score = 0;

    [
      /remittance|eob|era/,
      /contract|contracted rate|fee schedule/,
      /claim|claim history/,
      /payer/,
      /supporting documentation|medical record|documentation/,
      /financial|exposure|balance|amount/
    ].forEach(function (pattern) {
      if (pattern.test(value)) {
        score += 0.16;
      }
    });

    return Math.max(0, Math.min(1, score));
  }

  /*
   * Record through the canonical mastery engine only.
   *
   * recordDecision() runs first because the canonical decision record
   * is the primary evidence event. Explicit competency attempts follow.
   */
  function recordResult(result) {
    result = result || {};

    var opportunity = result.opportunity || {};
    var selectedAction = result.selectedAction || result.action || '';
    var reasoning = result.reasoning || '';
    var documentation = result.documentation || '';

    var actionScore = scoreRecoveryAction(
      opportunity,
      selectedAction
    );

    var reasoningScore = scoreReasoning(
      reasoning,
      opportunity,
      selectedAction
    );

    var documentationScore = scoreDocumentation(
      documentation
    );

    var overallScore =
      (actionScore + reasoningScore + documentationScore) / 3;

    var engine = window.TSMRCMEngine;

    if (!engine) {
      return {
        recorded: false,
        scenario: SCENARIO.id,
        error: 'TSMRCMEngine unavailable',
        actionScore: actionScore,
        reasoningScore: reasoningScore,
        documentationScore: documentationScore,
        overallScore: overallScore
      };
    }

    /*
     * Canonical decision record.
     */
    if (typeof engine.recordDecision === 'function') {
      engine.recordDecision({
        scenarioId: SCENARIO.id,
        domain: SCENARIO.domain,
        competency: SCENARIO.competency,
        accountId:
          opportunity.account_id ||
          opportunity.claim_id ||
          'LEAKAGE-CASE',
        selectedAction: selectedAction,
        expectedAction:
          expectedRecoveryAction(opportunity).action,
        reasoning: reasoning,
        documentation: documentation,
        score: overallScore
      });
    }

    /*
     * Explicit evidence events.
     */
    if (typeof engine.recordAttempt === 'function') {
      engine.recordAttempt({
        scenarioId: SCENARIO.id,
        domain: SCENARIO.domain,
        competency: 'leakage_detection',
        score: actionScore
      });

      engine.recordAttempt({
        scenarioId: SCENARIO.id,
        domain: SCENARIO.domain,
        competency: 'recovery_strategy',
        score: reasoningScore
      });

      engine.recordAttempt({
        scenarioId: SCENARIO.id,
        domain: SCENARIO.domain,
        competency: 'documentation',
        score: documentationScore
      });
    }

    return {
      recorded: true,
      scenario: SCENARIO.id,
      account_id:
        opportunity.account_id ||
        opportunity.claim_id ||
        'LEAKAGE-CASE',
      actionScore: actionScore,
      reasoningScore: reasoningScore,
      documentationScore: documentationScore,
      overallScore: overallScore
    };
  }

  function getReadiness() {
    if (
      window.TSMRCMEngine &&
      typeof window.TSMRCMEngine.getReadiness === 'function'
    ) {
      return window.TSMRCMEngine.getReadiness();
    }

    return null;
  }

  /*
   * CANONICAL PORTFOLIO HANDOFF
   *
   * LEAKAGE-001 consumes the structured Healthcare Portfolio Twin.
   * The producer is responsible for supplying:
   *
   *   {
   *     leakageOpportunities: [...]
   *   }
   *
   * This deliberately does NOT accept the HonorHealth demo snapshot
   * or Strategist KPI values.
   */
  function setPortfolioTwin(twin) {
    if (!twin || typeof twin !== 'object') return false;

    try {
      window.TSMHCPortfolioTwin = twin;
      return true;
    } catch (e) {
      return false;
    }
  }



  window.TSMRevenueLeakageCareer = {
    setPortfolioTwin: setPortfolioTwin,
    version: '1.0.0',
    scenario: SCENARIO,
    discoverLeakage: discoverLeakage,
    expectedRecoveryAction: expectedRecoveryAction,
    scoreRecoveryAction: scoreRecoveryAction,
    scoreReasoning: scoreReasoning,
    scoreDocumentation: scoreDocumentation,
    recordResult: recordResult,
    getReadiness: getReadiness
  };

})(window);
