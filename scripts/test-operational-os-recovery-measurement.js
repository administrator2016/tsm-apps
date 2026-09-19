'use strict';

// Phase 5 regression:
// Proves that a governed BPO recovery outcome written onto the SAME
// work-item shape is measured by Operational OS as actual recovery.
//
// Prediction is preserved separately from actual outcome.
// AI prediction does NOT establish recovered revenue.

const { buildRecoveryPackage } = require('../server/tsm-operational-os');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK:', msg);
  }
}

const caseId = 'AZ-BCBS-2026-88214';

// Canonical HC structured case + Phase 5 reconciliation fields.
// quarterlyExposure intentionally remains separate and must never become
// the claim-level recovery exposure.
const reconciledWorkItem = {
  caseId,
  vertical: 'healthcare',
  stage: 'ready-for-review',
  status: 'open',
  priority: 'high',

  quarterlyExposure: 187000,

  // Canonical structured case preserved by the HC -> BPO relay.
  payload: {
    structuredCase: {
      claimId: caseId,
      payer: 'Blue Cross Blue Shield of Arizona',
      denialReasonCode: 'CO-50 / CO-4',
      denialCategory: 'medical_necessity',
      financialExposure: 4850,
      recoveryLikelihood: 'MODERATE',
      confidence: 65,
      confidenceTier: 'LOW',
      humanReviewRequired: true,
      appealable: true,
      appealDeadline: '2026-11-07',
      evidenceProvenance: [
        'claim_record',
        'denial_record',
        'medical_record'
      ]
    }
  },

  // Phase 5: actual governed BPO/payer outcome.
  originalExposure: 4850,
  actionTaken:
    'Appeal submitted with supplemental E&M documentation and physician attestation',
  payerOutcome: 'Payer allowed partial recovery',
  recoveredAmount: 2000,
  remainingBalance: 2850,
  recoveryStatus: 'PARTIALLY_RECOVERED',
  recoveryRate: 2000 / 4850,
  outcomeRecordedAt: '2026-09-18T20:00:00.000Z',
  outcomeRecordedBy: 'test-actor'
};

const pkg = buildRecoveryPackage({
  member: {
    id: 'test-healthcare-provider',
    name: 'Desert Ridge Medical Group'
  },
  cases: [reconciledWorkItem],
  bncaReports: [],
  slaEvents: [],
  notes: [],
  documents: []
});

const financials = pkg.financials || {};
const vertical = pkg.verticals.find(v => v.vertical === 'healthcare');

console.log('\nPHASE 5 OPERATIONAL OS MEASUREMENT REGRESSION');
console.log('CASE:', caseId);

console.log('\nPrediction:');
console.log('  recoveryLikelihood = MODERATE');
console.log('  confidence = 65');

console.log('\nActual:');
console.log('  originalExposure = $4,850');
console.log('  recoveredAmount = $2,000');
console.log('  remainingBalance = $2,850');
console.log('  recoveryStatus = PARTIALLY_RECOVERED');
console.log('  recoveryRate = 41.24%');

console.log('\nOperational OS:');
console.log('  exposure =', financials.exposure);
console.log('  recovered =', financials.recovered);
console.log('  recoveryRate =', financials.recoveryRate);

assert(
  financials.exposure === 4850,
  `Operational OS exposure uses claim-level $4,850 - got ${financials.exposure}`
);

assert(
  financials.recovered === 2000,
  `Operational OS recovered value is $2,000 - got ${financials.recovered}`
);

assert(
  Math.abs(financials.recoveryRate - (2000 / 4850)) < 1e-12,
  `Operational OS recoveryRate equals recovered/exposure - got ${financials.recoveryRate}`
);

assert(
  vertical && vertical.exposure === 4850,
  `healthcare vertical exposure remains $4,850 - got ${vertical && vertical.exposure}`
);

assert(
  vertical && vertical.recovered === 2000,
  `healthcare vertical recovered value is $2,000 - got ${vertical && vertical.recovered}`
);

assert(
  vertical && Math.abs(vertical.recovered / vertical.exposure - (2000 / 4850)) < 1e-12,
  'healthcare vertical recovery ratio is mathematically correct'
);

assert(
  reconciledWorkItem.quarterlyExposure === 187000,
  'quarterly exposure remains stored separately at $187,000'
);

assert(
  financials.exposure !== reconciledWorkItem.quarterlyExposure,
  'quarterly exposure is NOT used as claim recovery exposure'
);

assert(
  financials.recovered <= financials.exposure,
  'measured recovered value cannot exceed measured exposure'
);

console.log('\nEXPECTED MEASUREMENT:');
console.log('  Prediction: MODERATE / 65 confidence');
console.log('  Actual:     $2,000 recovered of $4,850');
console.log('  OS Rate:    41.24%');

console.log(
  process.exitCode
    ? '\nPHASE 5 OPERATIONAL OS MEASUREMENT: FAIL'
    : '\nPHASE 5 OPERATIONAL OS MEASUREMENT: PASS'
);
