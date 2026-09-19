'use strict';

/**
 * Phase 7 regression: recovery outcome consistency controls.
 *
 * Proves impossible or contradictory recovery records cannot be written:
 *   - status <-> recoveredAmount agreement for every controlled status
 *   - recoveredAmount <= originalExposure, remainingBalance >= 0
 *   - recoveryRate = recovered / originalExposure (claim-level, never the
 *     $187,000 quarterly figure)
 *   - missing/blank/boolean/garbage amounts are rejected, never coerced to $0
 *   - the original prediction (structuredCase) is untouched by an outcome
 *   - a rejected outcome writes nothing (no partial state, no audit entry)
 *
 * Real server/tsm-ledger-service.js logic + in-memory Mongo stub.
 * Run: node scripts/test-bpo-recovery-outcome-consistency.js
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


function throwsWith(fn, text) {
  try { fn(); } catch (e) { return String(e.message).includes(text); }
  return false;
}

async function main() {
  const V = ledger.bpoValidateRecoveryOutcome;
  const v = (status, originalExposure, recoveredAmount) => V({ status, originalExposure, recoveredAmount });

  console.log('\n== A. Pure rules: status <-> amount agreement (exposure $4,850)');
  // valid
  ok(v('PENDING', 4850, 0).remainingBalance === 4850, 'PENDING with $0 is valid');
  ok(v('RECOVERED', 4850, 4850).remainingBalance === 0 && v('RECOVERED', 4850, 4850).recoveryRate === 1, 'RECOVERED at exactly the exposure is valid (rate 1, balance 0)');
  ok(v('PARTIALLY_RECOVERED', 4850, 2000).remainingBalance === 2850, 'PARTIALLY_RECOVERED $2,000 leaves $2,850');
  ok(v('PARTIALLY_RECOVERED', 4850, 0.01).recoveredAmount === 0.01, 'PARTIALLY_RECOVERED at one cent is valid (lower boundary)');
  ok(v('PARTIALLY_RECOVERED', 4850, 4849.99).remainingBalance === 0.01, 'PARTIALLY_RECOVERED at exposure minus a cent is valid (upper boundary)');
  for (const st of ['NO_RECOVERY', 'DENIED_AFTER_APPEAL', 'WITHDRAWN']) {
    ok(v(st, 4850, 0).recoveryRate === 0, st + ' with $0 is valid');
  }

  console.log('\n== B. Pure rules: contradictions are rejected');
  ok(throwsWith(() => v('RECOVERED', 4850, 4849.99), 'RECOVERED outcome must have recoveredAmount equal to originalExposure'), 'RECOVERED one cent short is rejected');
  ok(throwsWith(() => v('RECOVERED', 4850, 0), 'RECOVERED outcome must have recoveredAmount equal to originalExposure'), 'RECOVERED with $0 is rejected');
  ok(throwsWith(() => v('RECOVERED', 4850, 4850.01), 'cannot exceed originalExposure'), 'RECOVERED above exposure is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, 0), 'PARTIALLY_RECOVERED outcome must have recoveredAmount greater than 0'), 'PARTIALLY_RECOVERED with $0 is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, 4850), 'PARTIALLY_RECOVERED outcome must have recoveredAmount greater than 0 and less than'), 'PARTIALLY_RECOVERED at full exposure is rejected (that is RECOVERED)');
  for (const st of ['PENDING', 'NO_RECOVERY', 'DENIED_AFTER_APPEAL', 'WITHDRAWN']) {
    ok(throwsWith(() => v(st, 4850, 0.01), st + ' outcome must have recoveredAmount = 0'), st + ' claiming $0.01 recovered is rejected');
  }
  ok(throwsWith(() => v('NOT_A_STATUS', 4850, 0), 'recoveryStatus must be one of'), 'unknown status is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 0, 0), 'originalExposure must be greater than 0'), 'a $0 exposure cannot carry an outcome (no divide-by-zero rate)');

  console.log('\n== C. Pure rules: amounts are never coerced');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, -1), 'recoveredAmount must be a finite number >= 0'), 'negative recovered amount is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, NaN), 'recoveredAmount must be a finite number >= 0'), 'NaN is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, Infinity), 'recoveredAmount must be a finite number >= 0'), 'Infinity is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, true), 'recoveredAmount must be a finite number >= 0'), 'boolean true is not $1');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, null), 'recoveredAmount must be a finite number >= 0'), 'null is not $0');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, ''), 'recoveredAmount must be a finite number >= 0'), 'empty string is not $0');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, []), 'recoveredAmount must be a finite number >= 0'), 'empty array is not $0');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, '0x10'), 'recoveredAmount must be a finite number >= 0'), 'hex string is not $16');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, 'lots'), 'recoveredAmount must be a finite number >= 0'), 'non-numeric text is rejected');
  ok(throwsWith(() => v('PARTIALLY_RECOVERED', 4850, 1.005), 'at most 2 decimal places'), 'sub-cent precision is rejected');
  ok(v('PARTIALLY_RECOVERED', 4850, '$2,000.50').recoveredAmount === 2000.5, 'a plain currency string ($2,000.50) is accepted and normalized');
  ok(v('RECOVERED', 0.3, 0.1 + 0.2).remainingBalance === 0, 'float noise (0.1 + 0.2 vs 0.3) does not break the exact RECOVERED rule');
  ok(throwsWith(() => v('RECOVERED', null, 0), 'originalExposure must be a finite number >= 0'), 'a null exposure is never treated as $0');

  console.log('\n== D. Ledger: full path with the canonical AZ-BCBS-2026-88214 work item');
  const caseId = 'AZ-BCBS-2026-88214';
  const structuredCase = {
    claimId: caseId, payer: 'Blue Cross Blue Shield of Arizona', denialReasonCode: 'CO-50 / CO-4',
    denialCategory: 'medical_necessity', financialExposure: 4850, recoveryLikelihood: 'MODERATE', confidence: 65,
    confidenceTier: 'LOW', humanReviewRequired: true, appealable: true, appealDeadline: '2026-11-07',
    evidenceProvenance: ['claim_record', 'denial_record', 'medical_record'],
  };
  await ledger.bpoUpsertWorkItem(caseId, {
    clientId: 'HC-TEST-CLIENT', vertical: 'healthcare', stage: 'ready-for-review', status: 'open',
    payload: { quarterlyExposure: 187000, structuredCase },
  }, 'test-suite');
  const predictionBefore = JSON.stringify((await ledger.bpoGetWorkItem(caseId)).payload);
  const auditCount = () => {
    let n = 0;
    for (const col of collections.values()) n += col._docs.filter((d) => d && d.action === 'work_item.recovery_outcome').length;
    return n;
  };

  const rejectCases = [
    ['RECOVERED', { recoveryStatus: 'RECOVERED', recoveredAmount: 2000 }, 'must have recoveredAmount equal to originalExposure', 'RECOVERED with a partial amount is rejected end to end'],
    ['RECOVERED omitted', { recoveryStatus: 'RECOVERED' }, 'recoveredAmount is required for RECOVERED', 'RECOVERED with no amount is rejected, not recorded as $0'],
    ['PARTIAL omitted', { recoveryStatus: 'PARTIALLY_RECOVERED' }, 'recoveredAmount is required for PARTIALLY_RECOVERED', 'PARTIALLY_RECOVERED with no amount is rejected, not recorded as $0'],
    ['PARTIAL zero', { recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: 0 }, 'greater than 0', 'PARTIALLY_RECOVERED with $0 is rejected end to end'],
    ['DENIED money', { recoveryStatus: 'DENIED_AFTER_APPEAL', recoveredAmount: 100 }, 'DENIED_AFTER_APPEAL outcome must have recoveredAmount = 0', 'DENIED_AFTER_APPEAL cannot carry recovered revenue'],
    ['WITHDRAWN money', { recoveryStatus: 'WITHDRAWN', recoveredAmount: 100 }, 'WITHDRAWN outcome must have recoveredAmount = 0', 'WITHDRAWN cannot carry recovered revenue'],
    ['NO_RECOVERY money', { recoveryStatus: 'NO_RECOVERY', recoveredAmount: 100 }, 'NO_RECOVERY outcome must have recoveredAmount = 0', 'NO_RECOVERY cannot carry recovered revenue'],
    ['boolean amount', { recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: true }, 'recoveredAmount must be a finite number >= 0', 'a boolean amount is rejected end to end'],
    ['quarterly as amount', { recoveryStatus: 'RECOVERED', recoveredAmount: 187000 }, 'cannot exceed originalExposure (4850)', 'the $187,000 quarterly figure can never be recorded against a $4,850 claim'],
  ];
  for (const [, fields, text, msg] of rejectCases) {
    await expectReject(() => ledger.bpoRecordWorkItemOutcome(caseId, fields, 'test-suite'), text, msg);
  }
  const untouched = await ledger.bpoGetWorkItem(caseId);
  ok(untouched.recoveryStatus === undefined && untouched.recoveredAmount === undefined, 'every rejected outcome left the work item with no outcome fields at all');
  ok(auditCount() === 0, 'rejected outcomes write no audit entries');

  const noRec = await ledger.bpoRecordWorkItemOutcome(caseId, { recoveryStatus: 'NO_RECOVERY', payerOutcome: 'Upheld' }, 'test-suite');
  ok(noRec.reconciliation.recoveredAmount === 0 && noRec.reconciliation.recoveryRate === 0 && noRec.reconciliation.remainingBalance === 4850, 'NO_RECOVERY with no amount records $0 / rate 0 / $4,850 remaining');

  const full = await ledger.bpoRecordWorkItemOutcome(caseId, { recoveryStatus: 'RECOVERED', recoveredAmount: '$4,850.00', actionTaken: 'Appeal' }, 'test-suite');
  ok(full.reconciliation.recoveredAmount === 4850 && full.reconciliation.remainingBalance === 0 && full.reconciliation.recoveryRate === 1, 'RECOVERED at the full claim amount records rate 1 and $0 remaining');
  ok(auditCount() === 2, 'each accepted outcome writes exactly one audit entry');

  const partial = await ledger.bpoRecordWorkItemOutcome(caseId, { recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: 2000 }, 'test-suite');
  ok(Math.abs(partial.reconciliation.recoveryRate - 2000 / 4850) < 1e-12 && partial.reconciliation.remainingBalance === 2850, 'the canonical $2,000 of $4,850 outcome still measures 41.24%');

  const after = await ledger.bpoGetWorkItem(caseId);
  ok(JSON.stringify(after.payload) === predictionBefore, 'the original prediction payload (likelihood, confidence, exposure, quarterly figure) is byte-identical after outcomes');
  ok(after.payload.structuredCase.recoveryLikelihood === 'MODERATE' && after.payload.structuredCase.confidence === 65, 'MODERATE / 65 is preserved as the prediction');

  console.log('\n== E. Ledger: missing exposure is never manufactured');
  const noExpId = 'NO-EXPOSURE-1';
  await ledger.bpoUpsertWorkItem(noExpId, {
    clientId: 'HC-TEST-CLIENT', vertical: 'healthcare', stage: 'ready-for-review', status: 'open',
    payload: { quarterlyExposure: 187000, structuredCase: { claimId: noExpId, financialExposure: null } },
  }, 'test-suite');
  await expectReject(() => ledger.bpoRecordWorkItemOutcome(noExpId, { recoveryStatus: 'PENDING' }, 'test-suite'), 'financialExposure missing', 'a null claim exposure is rejected (not treated as $0, not swapped for $187,000)');
  const noFieldId = 'NO-EXPOSURE-2';
  await ledger.bpoUpsertWorkItem(noFieldId, {
    clientId: 'HC-TEST-CLIENT', vertical: 'healthcare', stage: 'ready-for-review', status: 'open',
    payload: { quarterlyExposure: 187000, structuredCase: { claimId: noFieldId } },
  }, 'test-suite');
  await expectReject(() => ledger.bpoRecordWorkItemOutcome(noFieldId, { recoveryStatus: 'PENDING' }, 'test-suite'), 'financialExposure missing', 'an absent claim exposure is rejected even though a $187,000 quarterly figure sits beside it');
  const zeroId = 'ZERO-EXPOSURE-1';
  await ledger.bpoUpsertWorkItem(zeroId, {
    clientId: 'HC-TEST-CLIENT', vertical: 'healthcare', stage: 'ready-for-review', status: 'open',
    payload: { structuredCase: { claimId: zeroId, financialExposure: 0 } },
  }, 'test-suite');
  await expectReject(() => ledger.bpoRecordWorkItemOutcome(zeroId, { recoveryStatus: 'NO_RECOVERY' }, 'test-suite'), 'originalExposure must be greater than 0', 'a $0 claim exposure cannot carry an outcome');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  console.log(failed ? 'PHASE 7 RECOVERY CONSISTENCY: FAIL' : 'PHASE 7 RECOVERY CONSISTENCY: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FAIL (exception):', e); process.exit(1); });
