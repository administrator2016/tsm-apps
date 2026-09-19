'use strict';

/**
 * Phase 6 regression: learning records pairing the AI's original
 * prediction (structuredCase.recoveryLikelihood) against the realized
 * outcome recorded via Phase 7's bpoRecordWorkItemOutcome.
 *
 * Same in-memory MongoDB stub pattern as test-bpo-recovery-outcome.js —
 * no real database/network required.
 */

const Module = require('module');

const collections = new Map();

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function matches(doc, query) {
  return Object.keys(query || {}).every((key) => doc[key] === query[key]);
}

function getCollection(name) {
  if (!collections.has(name)) {
    const docs = [];

    collections.set(name, {
      async findOne(query) {
        const found = docs.find((doc) => matches(doc, query));
        return clone(found) || null;
      },

      async updateOne(query, update, options = {}) {
        let index = docs.findIndex((doc) => matches(doc, query));

        if (index === -1) {
          if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 };
          const created = clone(
            Object.assign({}, update.$setOnInsert || {}, update.$set || {})
          );
          docs.push(created);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }

        docs[index] = Object.assign({}, docs[index], clone(update.$set || {}));
        return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
      },

      async insertOne(doc) {
        docs.push(clone(doc));
        return { acknowledged: true };
      },

      find(query) {
        const filtered = () => docs.filter((doc) => matches(doc, query));
        const chain = {
          sort() { return chain; },
          limit() { return chain; },
          async toArray() { return clone(filtered()); },
        };
        return chain;
      },

      _docs: docs,
    });
  }

  return collections.get(name);
}

class FakeMongoClient {
  constructor() {}
  async connect() { return this; }
  db() { return { collection(name) { return getCollection(name); } }; }
  async close() {}
}

const mongodbPath = require.resolve('mongodb');
const fakeMongoModule = new Module(mongodbPath, null);
fakeMongoModule.exports = { MongoClient: FakeMongoClient };
fakeMongoModule.loaded = true;
require.cache[mongodbPath] = fakeMongoModule;

process.env.MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://fake-host/tsm-consultz-test';

const ledger = require('../server/tsm-ledger-service');

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed += 1;
    console.log('OK: ' + message);
  } else {
    failed += 1;
    console.error('FAIL: ' + message);
  }
}

async function expectReject(fn, expectedText, message) {
  try {
    await fn();
    failed += 1;
    console.error('FAIL: ' + message + ' — expected rejection');
  } catch (e) {
    const matched = !expectedText || String(e.message).includes(expectedText);
    ok(matched, message);
    if (!matched) console.error('  actual error: ' + e.message);
  }
}

async function seedCase(caseId, { financialExposure, recoveryLikelihood, confidence }) {
  await ledger.bpoUpsertWorkItem(
    caseId,
    {
      clientId: 'LEARNING-TEST-CLIENT',
      vertical: 'healthcare',
      stage: 'ready-for-review',
      status: 'open',
      payload: {
        quarterlyExposure: 999999,
        structuredCase: {
          claimId: caseId,
          payer: 'Test Payer',
          denialReasonCode: 'CO-50',
          denialCategory: 'medical_necessity',
          financialExposure,
          recoveryLikelihood,
          confidence,
          confidenceTier: 'MODERATE',
          humanReviewRequired: true,
          appealable: true,
        },
      },
    },
    'test-suite'
  );
}

async function main() {
  // ── Case 1: predicted LIKELY, actual recovery lands inside the band ────
  const caseA = 'LEARN-CASE-LIKELY-CALIBRATED';
  await seedCase(caseA, { financialExposure: 10000, recoveryLikelihood: 'LIKELY', confidence: 82 });

  await expectReject(
    () => ledger.bpoBuildLearningRecord(caseA, 'test-suite'),
    'No recovery outcome recorded yet',
    'learning record cannot be built before any outcome is recorded'
  );

  await ledger.bpoRecordWorkItemOutcome(
    caseA,
    { recoveryStatus: 'PENDING', recoveredAmount: 0 },
    'test-suite'
  );

  await expectReject(
    () => ledger.bpoBuildLearningRecord(caseA, 'test-suite'),
    'PENDING',
    'learning record cannot be built while outcome is still PENDING'
  );

  // RECOVERED requires recoveredAmount to equal originalExposure exactly
  // (bpoValidateRecoveryOutcome) — full recovery, rate 1.0.
  await ledger.bpoRecordWorkItemOutcome(
    caseA,
    { recoveryStatus: 'RECOVERED', recoveredAmount: 10000, actionTaken: 'Appeal won', payerOutcome: 'Paid' },
    'test-suite'
  );

  const recordA = await ledger.bpoBuildLearningRecord(caseA, 'test-suite');

  ok(recordA.predictedLikelihood === 'LIKELY', 'case A: predictedLikelihood captured as LIKELY');
  ok(recordA.predictedConfidence === 82, 'case A: predictedConfidence captured');
  ok(recordA.originalExposure === 10000, 'case A: originalExposure is the fixed claim-level baseline ($10,000), not $999,999');
  ok(recordA.actualRecoveryRate === 1, 'case A: actualRecoveryRate is 1.0 (fully recovered)');
  ok(recordA.variance === 0, 'case A: 1.0 falls inside the LIKELY band [0.6, 1.0] — variance 0');
  ok(recordA.calibrated === true, 'case A: prediction is calibrated');

  await expectReject(
    () => ledger.bpoBuildLearningRecord(caseA, 'test-suite'),
    'already exists',
    'a second learning record for the same case is rejected (insert-only, not upsert)'
  );

  // ── Case 2: predicted UNLIKELY, actual recovery fully outside the band ─
  const caseB = 'LEARN-CASE-UNLIKELY-MISCALIBRATED';
  await seedCase(caseB, { financialExposure: 4000, recoveryLikelihood: 'UNLIKELY', confidence: 40 });
  await ledger.bpoRecordWorkItemOutcome(
    caseB,
    { recoveryStatus: 'RECOVERED', recoveredAmount: 4000 },
    'test-suite'
  );
  const recordB = await ledger.bpoBuildLearningRecord(caseB, 'test-suite');

  ok(recordB.actualRecoveryRate === 1, 'case B: actualRecoveryRate is 1.0 (fully recovered)');
  ok(Math.abs(recordB.variance - 0.7) < 1e-12, 'case B: UNLIKELY band tops out at 0.3, so variance is 0.7');
  ok(recordB.calibrated === false, 'case B: prediction is NOT calibrated — recovered despite being called unlikely');

  // ── Case 3: predicted MODERATE, actual recovery inside the band ────────
  const caseC = 'LEARN-CASE-MODERATE-CALIBRATED';
  await seedCase(caseC, { financialExposure: 8000, recoveryLikelihood: 'MODERATE', confidence: 55 });
  await ledger.bpoRecordWorkItemOutcome(
    caseC,
    { recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: 3600 },
    'test-suite'
  );
  const recordC = await ledger.bpoBuildLearningRecord(caseC, 'test-suite');
  ok(recordC.variance === 0, 'case C: 0.45 falls inside the MODERATE band [0.3, 0.6] — variance 0');
  ok(recordC.calibrated === true, 'case C: prediction is calibrated');

  // ── Case 4: no usable prediction on the case at all ─────────────────────
  const caseD = 'LEARN-CASE-NO-PREDICTION';
  await seedCase(caseD, { financialExposure: 1000, recoveryLikelihood: undefined, confidence: undefined });
  await ledger.bpoRecordWorkItemOutcome(
    caseD,
    { recoveryStatus: 'NO_RECOVERY', recoveredAmount: 0 },
    'test-suite'
  );
  const recordD = await ledger.bpoBuildLearningRecord(caseD, 'test-suite');
  ok(recordD.predictedLikelihood === null, 'case D: no predictedLikelihood on the original case');
  ok(recordD.variance === null, 'case D: variance is null when there is no prediction to score against');
  ok(recordD.calibrated === null, 'case D: calibrated is null (not false) when unscoreable');

  // ── Aggregate calibration report ────────────────────────────────────────
  const summary = await ledger.bpoLearningVarianceSummary();
  ok(summary.totalRecords === 4, 'summary: totalRecords counts all four learning records');
  ok(summary.scoredRecords === 3, 'summary: scoredRecords excludes the unscoreable case D');
  ok(summary.byPredictedLikelihood.LIKELY.predicted === 1, 'summary: 1 LIKELY prediction counted');
  ok(summary.byPredictedLikelihood.LIKELY.calibrationRate === 1, 'summary: LIKELY calibration rate is 100%');
  ok(summary.byPredictedLikelihood.UNLIKELY.predicted === 1, 'summary: 1 UNLIKELY prediction counted');
  ok(summary.byPredictedLikelihood.UNLIKELY.calibrationRate === 0, 'summary: UNLIKELY calibration rate is 0%');
  ok(Math.abs(summary.byPredictedLikelihood.UNLIKELY.avgVariance - 0.7) < 1e-12, 'summary: UNLIKELY avgVariance is 0.7');
  ok(summary.byPredictedLikelihood.MODERATE.calibrationRate === 1, 'summary: MODERATE calibration rate is 100%');

  const fetched = await ledger.bpoGetLearningRecord(caseA);
  ok(fetched && fetched.caseId === caseA, 'bpoGetLearningRecord retrieves a stored record by caseId');

  const listed = await ledger.bpoListLearningRecords({ vertical: 'healthcare' });
  ok(listed.length === 4, 'bpoListLearningRecords returns all 4 healthcare-vertical records');

  console.log('');
  console.log('PHASE 6 LEARNING RECORD REGRESSION');
  console.log(passed + ' passed, ' + failed + ' failed');
  console.log(failed === 0 ? 'PHASE 6 REGRESSION: PASS' : 'PHASE 6 REGRESSION: FAIL');

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
