'use strict';

/**
 * Phase 5 regression:
 * HC denial recovery outcome -> BPO work item -> reconciliation.
 *
 * Uses the real server/tsm-ledger-service.js business logic with a tiny
 * in-memory MongoDB stub. No real database/network is required.
 *
 * Critical contract:
 *   AZ-BCBS-2026-88214
 *   claim-level exposure = $4,850
 *   quarterly/program exposure = $187,000 (must NOT be used)
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
            Object.assign(
              {},
              update.$setOnInsert || {},
              update.$set || {}
            )
          );
          docs.push(created);

          return {
            matchedCount: 0,
            modifiedCount: 0,
            upsertedCount: 1,
          };
        }

        docs[index] = Object.assign({}, docs[index], clone(update.$set || {}));

        return {
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
        };
      },

      async insertOne(doc) {
        docs.push(clone(doc));
        return { acknowledged: true };
      },

      find() {
        const chain = {
          sort() { return chain; },
          limit() { return chain; },
          async toArray() {
            return clone(docs);
          },
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

  async connect() {
    return this;
  }

  db() {
    return {
      collection(name) {
        return getCollection(name);
      },
    };
  }

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
    if (!matched) {
      console.error('  actual error: ' + e.message);
    }
  }
}

async function main() {
  const caseId = 'AZ-BCBS-2026-88214';

  await ledger.bpoUpsertWorkItem(
    caseId,
    {
      clientId: 'HC-TEST-CLIENT',
      vertical: 'healthcare',
      stage: 'ready-for-review',
      status: 'open',

      payload: {
        quarterlyExposure: 187000,

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
            'medical_record',
          ],
        },
      },
    },
    'test-suite'
  );

  const before = await ledger.bpoGetWorkItem(caseId);

  ok(
    before && before.payload && before.payload.structuredCase,
    'canonical structuredCase is preserved on the BPO work item'
  );

  ok(
    before.payload.structuredCase.financialExposure === 4850,
    'canonical claim exposure is $4,850'
  );

  ok(
    before.payload.quarterlyExposure === 187000,
    'quarterly exposure of $187,000 remains separate from claim exposure'
  );

  const result = await ledger.bpoRecordWorkItemOutcome(
    caseId,
    {
      recoveryStatus: 'PARTIALLY_RECOVERED',
      actionTaken: 'Appeal submitted with supplemental E&M documentation and physician attestation',
      payerOutcome: 'Payer allowed partial recovery',
      recoveredAmount: 2000,
    },
    'test-suite'
  );

  const reconciliation = result.reconciliation;
  const updated = await ledger.bpoGetWorkItem(caseId);

  ok(
    reconciliation.originalExposure === 4850,
    'originalExposure uses claim-level $4,850, not $187,000'
  );

  ok(
    reconciliation.recoveredAmount === 2000,
    'recoveredAmount is recorded as $2,000'
  );

  ok(
    reconciliation.remainingBalance === 2850,
    'remainingBalance is $2,850'
  );

  ok(
    Math.abs(reconciliation.recoveryRate - (2000 / 4850)) < 1e-12,
    'recoveryRate equals recoveredAmount / originalExposure'
  );

  ok(
    reconciliation.recoveryStatus === 'PARTIALLY_RECOVERED',
    'controlled recovery status is preserved'
  );

  ok(
    reconciliation.actionTaken.includes('Appeal submitted'),
    'actionTaken is recorded'
  );

  ok(
    reconciliation.payerOutcome === 'Payer allowed partial recovery',
    'payerOutcome is recorded'
  );

  ok(
    typeof reconciliation.outcomeRecordedAt === 'string' &&
      reconciliation.outcomeRecordedAt.length > 0,
    'outcomeRecordedAt is stamped'
  );

  ok(
    reconciliation.outcomeRecordedBy === 'test-suite',
    'outcomeRecordedBy is stamped'
  );

  ok(
    updated.originalExposure === 4850 &&
      updated.recoveredAmount === 2000 &&
      updated.remainingBalance === 2850 &&
      updated.recoveryStatus === 'PARTIALLY_RECOVERED',
    'reconciliation persists on the same bpo_work_items document'
  );

  ok(
    updated.recoveryRate === 2000 / 4850,
    'persisted recoveryRate remains mathematically correct'
  );

  await expectReject(
    () =>
      ledger.bpoRecordWorkItemOutcome(
        caseId,
        {
          recoveryStatus: 'NOT_A_REAL_STATUS',
          recoveredAmount: 0,
        },
        'test-suite'
      ),
    'recoveryStatus must be one of',
    'invalid recovery status is rejected'
  );

  await expectReject(
    () =>
      ledger.bpoRecordWorkItemOutcome(
        caseId,
        {
          recoveryStatus: 'RECOVERED',
          recoveredAmount: 4850.01,
        },
        'test-suite'
      ),
    'cannot exceed originalExposure',
    'recoveredAmount above $4,850 is rejected'
  );

  await expectReject(
    () =>
      ledger.bpoRecordWorkItemOutcome(
        caseId,
        {
          recoveryStatus: 'PENDING',
          recoveredAmount: 1,
        },
        'test-suite'
      ),
    'PENDING outcome must have recoveredAmount = 0',
    'PENDING cannot claim recovered revenue'
  );

  console.log('');
  console.log('PHASE 5 BPO RECOVERY OUTCOME REGRESSION');
  console.log('CASE: ' + caseId);
  console.log('ORIGINAL EXPOSURE: $' + reconciliation.originalExposure);
  console.log('RECOVERED: $' + reconciliation.recoveredAmount);
  console.log('REMAINING: $' + reconciliation.remainingBalance);
  console.log(
    'RECOVERY RATE: ' +
      (reconciliation.recoveryRate * 100).toFixed(2) +
      '%'
  );
  console.log('STATUS: ' + reconciliation.recoveryStatus);
  console.log(
    failed === 0
      ? 'PHASE 5 REGRESSION: PASS'
      : 'PHASE 5 REGRESSION: FAIL'
  );

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
