'use strict';

const {
  buildRevenueLeakageOpportunities
} = require('../server/healthcare/revenue-leakage-contract');

const {
  buildRecoveryWorkItem
} = require('../server/healthcare/recovery-orchestrator');

const opportunities = buildRevenueLeakageOpportunities({
  claims: [
    {
      claimId: 'CLM-001',
      payer: 'Example Payer',
      financialExposure: 48000
    }
  ],

  denials: [
    {
      claimId: 'CLM-001',
      payer: 'Example Payer',
      denialReasonCode: 'CO-29',
      denialCategory: 'timely filing',
      rootCauseHypothesis: 'Clearinghouse submission evidence should be reviewed.',
      appealable: true,
      appealDeadline: '48 hours',
      recoveryLikelihood: 'STRONG',
      confidence: 85,
      financialExposure: 48000,
      evidenceProvenance: [
        {
          field: 'claimId',
          source: 'DOCUMENT_EXTRACTED',
          engine: 'Engine 01'
        }
      ]
    }
  ]
});

if (opportunities.length !== 1) {
  throw new Error('Expected one canonical opportunity');
}

const opportunity = opportunities[0];
const workItem = buildRecoveryWorkItem(opportunity);

function assert(condition, message) {
  if (!condition) throw new Error('ASSERTION FAILED: ' + message);
}

assert(
  workItem.opportunityId === opportunity.opportunityId,
  'opportunityId preserved'
);

assert(
  workItem.claimId === 'CLM-001',
  'claimId preserved'
);

assert(
  workItem.recovery.workType === 'APPEAL',
  'timely_filing maps to APPEAL'
);

assert(
  workItem.recovery.recommendedAction === 'appeal',
  'canonical recommendedAction preserved'
);

assert(
  workItem.recovery.urgency === 'CRITICAL',
  'canonical urgency preserved'
);

assert(
  workItem.sourceOpportunity.exposure === 48000,
  'exposure preserved'
);

assert(
  workItem.sourceOpportunity.recoveryLikelihood === 'STRONG',
  'categorical recoveryLikelihood preserved'
);

assert(
  workItem.sourceOpportunity.confidence === 85,
  'confidence preserved'
);

assert(
  workItem.recovery.humanApprovalRequired === true,
  'human approval required'
);

assert(
  workItem.recovery.executionPlan.targetSystem === 'MANUAL_BPO',
  'Phase 1 target is MANUAL_BPO'
);

assert(
  workItem.recovery.executionPlan.submissionMode === 'HUMAN_REVIEW',
  'Phase 1 submission mode is HUMAN_REVIEW'
);

assert(
  JSON.stringify(workItem.recovery.evidenceRequired) ===
    JSON.stringify([
      'claim_record',
      'denial_record',
      'filing_history'
    ]),
  'timely filing evidence checklist'
);

console.log('============================================================');
console.log('HC RECOVERY ORCHESTRATOR REGRESSION');
console.log('============================================================');
console.log('OPPORTUNITY:', opportunity.opportunityId);
console.log('TYPE:', opportunity.opportunityType);
console.log('ACTION:', opportunity.recommendedAction);
console.log('URGENCY:', opportunity.urgency);
console.log('EXPOSURE:', opportunity.exposure);
console.log('RECOVERY LIKELIHOOD:', opportunity.recoveryLikelihood);
console.log('CONFIDENCE:', opportunity.confidence);
console.log('');
console.log('WORK TYPE:', workItem.recovery.workType);
console.log('TARGET:', workItem.recovery.executionPlan.targetSystem);
console.log('SUBMISSION:', workItem.recovery.executionPlan.submissionMode);
console.log('APPROVAL REQUIRED:', workItem.recovery.humanApprovalRequired);
console.log('EVIDENCE:', workItem.recovery.evidenceRequired.join(', '));
console.log('');
console.log('PASS: canonical opportunity translated into governed recovery work item.');
