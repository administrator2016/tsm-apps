'use strict';

/**
 * Healthcare Recovery Orchestrator
 *
 * Purpose:
 *   Translate an already-classified canonical Healthcare Revenue Leakage
 *   Opportunity into a governed recovery execution plan.
 *
 * This module does NOT:
 *   - classify denial/recovery opportunities
 *   - invent exposure
 *   - calculate recovery probability
 *   - fabricate evidence
 *   - submit to payers/clearinghouses
 *
 * Canonical classification remains:
 *   server/healthcare/revenue-leakage-contract.js
 *
 * Phase 1 execution boundary:
 *   targetSystem   = MANUAL_BPO
 *   submissionMode = HUMAN_REVIEW
 *   approval       = required
 */

const VERSION = '1.0.0';

const WORK_TYPES = {
  timely_filing: 'APPEAL',
  medical_necessity: 'APPEAL',
  authorization: 'APPEAL',
  underpayment: 'VARIANCE_REVIEW',
  claim_correction: 'CORRECTED_CLAIM',
  eligibility: 'ELIGIBILITY_REVIEW',
  cob: 'ELIGIBILITY_COB',
  payer_escalation: 'PAYER_ESCALATION',
  aged_ar: 'AGED_AR_ESCALATION',
  recovery_review: 'RECOVERY_REVIEW'
};

const EVIDENCE_BY_TYPE = {
  timely_filing: [
    'claim_record',
    'denial_record',
    'filing_history'
  ],

  medical_necessity: [
    'claim_record',
    'denial_record',
    'clinical_documentation'
  ],

  authorization: [
    'claim_record',
    'denial_record',
    'authorization_record'
  ],

  underpayment: [
    'claim_record',
    'remittance_or_payment_record',
    'contract_rate_or_allowed_amount'
  ],

  claim_correction: [
    'claim_record',
    'denial_or_rejection_record',
    'corrected_claim_details'
  ],

  eligibility: [
    'claim_record',
    'eligibility_record',
    'coverage_details'
  ],

  cob: [
    'claim_record',
    'eligibility_record',
    'coordination_of_benefits_details'
  ],

  payer_escalation: [
    'claim_record',
    'payer_correspondence',
    'prior_action_history'
  ],

  aged_ar: [
    'account_record',
    'aging_history',
    'payer_activity_history'
  ],

  recovery_review: [
    'claim_or_account_record'
  ]
};

function requiredEvidenceFor(opportunity) {
  const type = opportunity && opportunity.opportunityType;
  return (EVIDENCE_BY_TYPE[type] || EVIDENCE_BY_TYPE.recovery_review).slice();
}

function buildExecutionPlan(opportunity) {
  return {
    workType: WORK_TYPES[
      opportunity && opportunity.opportunityType
    ] || 'RECOVERY_REVIEW',

    humanApprovalRequired: true,

    evidenceRequired: requiredEvidenceFor(opportunity),

    executionPlan: {
      targetSystem: 'MANUAL_BPO',
      submissionMode: 'HUMAN_REVIEW'
    }
  };
}

function buildRecoveryWorkItem(opportunity) {
  if (!opportunity || typeof opportunity !== 'object') {
    throw new Error('opportunity object required');
  }

  const opportunityId =
    opportunity.opportunityId ||
    (
      opportunity.runtimeSource &&
      (opportunity.claimId || opportunity.accountId)
        ? opportunity.runtimeSource + ':' +
          (opportunity.claimId || opportunity.accountId)
        : null
    );

  if (!opportunityId) {
    throw new Error('opportunityId required');
  }

  const plan = buildExecutionPlan(opportunity);

  return {
    contractVersion: VERSION,

    opportunityId,

    source: opportunity.source || null,
    runtimeSource: opportunity.runtimeSource || null,

    claimId: opportunity.claimId || null,
    accountId: opportunity.accountId || null,

    payer: opportunity.payer || null,
    denialReasonCode: opportunity.denialReasonCode || null,
    denialCategory: opportunity.denialCategory || null,
    rootCause: opportunity.rootCause || null,

    appealable:
      typeof opportunity.appealable === 'boolean'
        ? opportunity.appealable
        : null,

    appealDeadline: opportunity.appealDeadline || null,
    ageDays:
      typeof opportunity.ageDays === 'number'
        ? opportunity.ageDays
        : null,

    exposure:
      typeof opportunity.exposure === 'number'
        ? opportunity.exposure
        : null,

    recovery: {
      workType: plan.workType,
      recommendedAction: opportunity.recommendedAction || null,
      urgency: opportunity.urgency || null,
      status: 'NEW',
      humanApprovalRequired: plan.humanApprovalRequired,
      evidenceRequired: plan.evidenceRequired,

      deadline: opportunity.appealDeadline || null,

      executionPlan: plan.executionPlan
    },

    sourceOpportunity: {
      opportunityType: opportunity.opportunityType || null,

      exposure:
        typeof opportunity.exposure === 'number'
          ? opportunity.exposure
          : null,

      recoveryLikelihood:
        opportunity.recoveryLikelihood || null,

      confidence:
        typeof opportunity.confidence === 'number'
          ? opportunity.confidence
          : null,

      evidenceProvenance:
        opportunity.evidenceProvenance || null
    }
  };
}

module.exports = {
  VERSION,
  buildRecoveryWorkItem,
  buildExecutionPlan,
  requiredEvidenceFor
};
