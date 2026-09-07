'use strict';

/**
 * TSM Healthcare Revenue Leakage Contract
 * ----------------------------------------
 * Canonical projection layer for revenue-recovery opportunities.
 *
 * IMPORTANT:
 * - This module does NOT create claims.
 * - This module does NOT invent financial exposure.
 * - This module only projects opportunities from explicit runtime
 *   entities already supplied to Healthcare Portfolio Intelligence.
 *
 * Canonical model:
 *
 *   claims / denials / appeals / agedAccounts
 *                  ↓
 *        normalizeEntity(...)
 *                  ↓
 *       leakage opportunity
 *                  ↓
 *        Career / Executive consumers
 */

const CONTRACT_VERSION = '1.0.0';

function first() {
  for (const value of arguments) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function number(...values) {
  const value = first(...values);

  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function ageDays(item) {
  const direct = number(
    item.ageDays,
    item.age_days,
    item.daysAged,
    item.days_aged
  );

  if (direct !== null) return direct;

  const dateValue = first(
    item.serviceDate,
    item.service_date,
    item.claimDate,
    item.claim_date,
    item.dateOfService,
    item.date_of_service
  );

  if (!dateValue) return null;

  const timestamp = Date.parse(dateValue);
  if (!Number.isFinite(timestamp)) return null;

  const days = Math.floor((Date.now() - timestamp) / 86400000);
  return days >= 0 ? days : null;
}

function classifyOpportunity(item) {
  const combined = [
    item.denialReasonCode,
    item.denial_reason_code,
    item.denialReason,
    item.denial_reason,
    item.denialCategory,
    item.denial_category,
    item.rootCause,
    item.root_cause,
    item.rootCauseHypothesis,
    item.root_cause_hypothesis,
    item.opportunityType,
    item.opportunity_type,
    item.status,
    item.reason,
    item.issue,
    item.description,
    item.finding
  ].filter(Boolean).join(' ').toLowerCase().replace(/[_-]+/g, ' ');

  if (/timely filing|late filing|filing deadline|appeal deadline/.test(combined)) {
    return {
      type: 'timely_filing',
      action: 'appeal',
      urgency: 'CRITICAL'
    };
  }

  if (/medical necessity|clinical|medical policy/.test(combined)) {
    return {
      type: 'medical_necessity',
      action: 'appeal',
      urgency: 'HIGH'
    };
  }

  if (/prior auth|prior authorization|authorization/.test(combined)) {
    return {
      type: 'authorization',
      action: 'appeal',
      urgency: 'HIGH'
    };
  }

  if (/underpaid|underpayment|contracted rate|rate variance|contract variance/.test(combined)) {
    return {
      type: 'underpayment',
      action: 'variance',
      urgency: 'HIGH'
    };
  }

  if (/duplicate|corrected claim|rejection/.test(combined)) {
    return {
      type: 'claim_correction',
      action: 'corrected_claim',
      urgency: 'MEDIUM'
    };
  }

  if (/eligibility|coverage/.test(combined)) {
    return {
      type: 'eligibility',
      action: 'eligibility_cob',
      urgency: 'HIGH'
    };
  }

  if (/coordination of benefits|\bcob\b/.test(combined)) {
    return {
      type: 'cob',
      action: 'eligibility_cob',
      urgency: 'HIGH'
    };
  }

  if (/no response|write.?off|unresolved|escalat/.test(combined)) {
    return {
      type: 'payer_escalation',
      action: 'escalate',
      urgency: 'HIGH'
    };
  }

  const age = ageDays(item);

  if (age !== null && age >= 120) {
    return {
      type: 'aged_ar',
      action: 'escalate',
      urgency: 'CRITICAL'
    };
  }

  if (age !== null && age >= 91) {
    return {
      type: 'aged_ar',
      action: 'escalate',
      urgency: 'HIGH'
    };
  }

  return {
    type: 'recovery_review',
    action: 'review',
    urgency: 'MEDIUM'
  };
}

function normalizeOpportunity(item, source, index) {
  if (!item || typeof item !== 'object') return null;

  const claimId = first(
    item.claimId,
    item.claim_id,
    item.claim,
    item.accountId,
    item.account_id,
    item.id
  );

  /*
   * No identifier means we cannot safely create a career-facing
   * recovery opportunity. Do not invent one.
   */
  if (!claimId) return null;

  const exposure = number(
    item.financialExposure,
    item.financial_exposure,
    item.exposure,
    item.amount,
    item.balance
  );

  const classification = classifyOpportunity(item);

  return {
    contractVersion: CONTRACT_VERSION,

    opportunityId: `${source}:${claimId}`,

    source: `healthcare-portfolio:${source}`,

    claimId: text(claimId),

    accountId: first(
      item.accountId,
      item.account_id
    ),

    payer: first(
      item.payer,
      item.payerName,
      item.payer_name
    ),

    exposure,

    ageDays: ageDays(item),

    denialReasonCode: first(
      item.denialReasonCode,
      item.denial_reason_code
    ),

    denialCategory: first(
      item.denialCategory,
      item.denial_category
    ),

    rootCause: first(
      item.rootCause,
      item.root_cause,
      item.rootCauseHypothesis,
      item.root_cause_hypothesis
    ),

    opportunityType: classification.type,

    recommendedAction: classification.action,

    urgency: classification.urgency,

    appealable:
      item.appealable === undefined
        ? null
        : Boolean(item.appealable),

    appealDeadline: first(
      item.appealDeadline,
      item.appeal_deadline
    ),

    recoveryLikelihood: first(
      item.recoveryLikelihood,
      item.recovery_likelihood
    ),

    confidence: number(item.confidence),

    evidenceProvenance: first(
      item.evidenceProvenance,
      item.evidence_provenance
    ) || [],

    runtimeSource: source,

    sourceIndex: index
  };
}

function buildRevenueLeakageOpportunities(input = {}) {
  const sources = [
    ['claims', Array.isArray(input.claims) ? input.claims : []],
    ['denials', Array.isArray(input.denials) ? input.denials : []],
    ['appeals', Array.isArray(input.appeals) ? input.appeals : []],
    ['agedAccounts', Array.isArray(input.agedAccounts) ? input.agedAccounts : []]
  ];

  const opportunities = [];
  const seen = new Set();

  for (const [source, records] of sources) {
    records.forEach((item, index) => {
      const opportunity = normalizeOpportunity(item, source, index);

      if (!opportunity) return;

      /*
       * A claim may appear in multiple portfolio sections.
       * Preserve the first canonical opportunity rather than
       * duplicating financial exposure.
       */
      if (seen.has(opportunity.claimId)) return;

      seen.add(opportunity.claimId);
      opportunities.push(opportunity);
    });
  }

  return opportunities;
}

function buildRevenueLeakageSummary(opportunities = []) {
  const valid = opportunities.filter(Boolean);

  const exposureKnown = valid.filter(
    item => typeof item.exposure === 'number'
  );

  const totalExplicitExposure = exposureKnown.reduce(
    (sum, item) => sum + item.exposure,
    0
  );

  return {
    contractVersion: CONTRACT_VERSION,

    opportunityCount: valid.length,

    exposureKnownCount: exposureKnown.length,

    exposureUnknownCount:
      valid.length - exposureKnown.length,

    totalExplicitExposure,

    criticalCount:
      valid.filter(item => item.urgency === 'CRITICAL').length,

    highCount:
      valid.filter(item => item.urgency === 'HIGH').length,

    byType: valid.reduce((result, item) => {
      result[item.opportunityType] =
        (result[item.opportunityType] || 0) + 1;
      return result;
    }, {})
  };
}

module.exports = {
  CONTRACT_VERSION,
  buildRevenueLeakageOpportunities,
  buildRevenueLeakageSummary
};
