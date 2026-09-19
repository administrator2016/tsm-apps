'use strict';

/**
 * Phase 11 regression: Recovery Analytics — the aggregation layer that
 * bridges pipeline state (open work items), Phase 7 financial outcomes,
 * and Phase 6 prediction-vs-actual learning records.
 *
 * Same in-memory MongoDB stub pattern as test-bpo-learning-record.js /
 * test-bpo-recovery-outcome.js — no real database/network required.
 */

const Module = require('module');

const collections = new Map();

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function matches(doc, query) {
  return Object.keys(query || {}).every((key) => {
    const want = query[key];
    if (want && typeof want === 'object' && '$in' in want) return want.$in.includes(doc[key]);
    if (want && typeof want === 'object' && '$ne' in want) return doc[key] !== want.$ne;
    return doc[key] === want;
  });
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

async function seedOpenCase(caseId, { vertical, stage, priority, financialExposure, recoveryLikelihood, confidence, createdAtIsoOverride, dueDate }) {
  await ledger.bpoUpsertWorkItem(
    caseId,
    {
      clientId: 'ANALYTICS-TEST-CLIENT',
      vertical, stage, priority, dueDate,
      status: 'open',
      payload: {
        structuredCase: {
          claimId: caseId,
          payer: 'Acme Payer',
          denialReasonCode: 'CO-50',
          denialCategory: 'medical_necessity',
          financialExposure,
          recoveryLikelihood,
          confidence,
          confidenceTier: 'MODERATE',
        },
      },
    },
    'test-suite'
  );
  // Backdate createdAt directly in the fake store to simulate case age,
  // same trick used elsewhere in this test family — bpoUpsertWorkItem
  // itself always stamps "now".
  if (createdAtIsoOverride) {
    const col = getCollection('bpo_work_items');
    const doc = col._docs.find((d) => d.caseId === caseId);
    if (doc) {
      doc.createdAt = createdAtIsoOverride;
      doc.slaAgeHours = Math.round(((Date.now() - new Date(createdAtIsoOverride).getTime()) / 3600000) * 100) / 100;
    }
  }
}

async function seedResolvedCase(caseId, { vertical, payer, denialCategory, financialExposure, recoveryLikelihood, confidence, recoveryStatus, recoveredAmount, actionTaken, buildLearningRecord }) {
  await ledger.bpoUpsertWorkItem(
    caseId,
    {
      clientId: 'ANALYTICS-TEST-CLIENT',
      vertical, stage: 'closed', status: 'open',
      payload: {
        structuredCase: {
          claimId: caseId,
          payer, denialReasonCode: 'CO-50', denialCategory,
          financialExposure, recoveryLikelihood, confidence,
          confidenceTier: 'MODERATE',
        },
      },
    },
    'test-suite'
  );
  await ledger.bpoRecordWorkItemOutcome(
    caseId,
    { recoveryStatus, recoveredAmount, actionTaken, payerOutcome: 'Processed' },
    'test-suite'
  );
  if (buildLearningRecord) {
    await ledger.bpoBuildLearningRecord(caseId, 'test-suite');
  }
}

async function main() {
  // ── Open/pipeline cases — two stages, one overdue, ages vary ──────────
  await seedOpenCase('ANALYTICS-OPEN-1', {
    vertical: 'healthcare', stage: 'ready-for-review', priority: 'high',
    financialExposure: 5000, recoveryLikelihood: 'MODERATE', confidence: 60,
    createdAtIsoOverride: new Date(Date.now() - 10 * 86400000).toISOString(), // 10 days old
    dueDate: new Date(Date.now() - 2 * 86400000).toISOString(), // 2 days overdue
  });
  await seedOpenCase('ANALYTICS-OPEN-2', {
    vertical: 'healthcare', stage: 'ready-for-review', priority: 'medium',
    financialExposure: 3000, recoveryLikelihood: 'LIKELY', confidence: 75,
    createdAtIsoOverride: new Date(Date.now() - 6 * 86400000).toISOString(), // 6 days old
  });
  await seedOpenCase('ANALYTICS-OPEN-3', {
    vertical: 'healthcare', stage: 'appeal-submitted', priority: 'critical',
    financialExposure: 1000, recoveryLikelihood: 'UNLIKELY', confidence: 20,
    createdAtIsoOverride: new Date(Date.now() - 1 * 86400000).toISOString(), // 1 day old
  });

  // ── Resolved cases — mixed outcomes, payers, denial categories ────────
  await seedResolvedCase('ANALYTICS-RESOLVED-1', {
    vertical: 'healthcare', payer: 'Acme Payer', denialCategory: 'medical_necessity',
    financialExposure: 4850, recoveryLikelihood: 'MODERATE', confidence: 65,
    recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: 2000, actionTaken: 'Appeal filed',
    buildLearningRecord: true,
  });
  await seedResolvedCase('ANALYTICS-RESOLVED-2', {
    vertical: 'healthcare', payer: 'Beta Payer', denialCategory: 'timely_filing',
    financialExposure: 2000, recoveryLikelihood: 'LIKELY', confidence: 80,
    recoveryStatus: 'RECOVERED', recoveredAmount: 2000, actionTaken: 'Appeal won',
    buildLearningRecord: true,
  });
  await seedResolvedCase('ANALYTICS-RESOLVED-3', {
    vertical: 'bpo', payer: 'Acme Payer', denialCategory: 'medical_necessity',
    financialExposure: 1500, recoveryLikelihood: 'UNLIKELY', confidence: 15,
    recoveryStatus: 'NO_RECOVERY', recoveredAmount: 0, actionTaken: 'Withdrawn',
    buildLearningRecord: true,
  });
  await seedResolvedCase('ANALYTICS-RESOLVED-4-PENDING', {
    vertical: 'healthcare', payer: 'Acme Payer', denialCategory: 'medical_necessity',
    financialExposure: 900, recoveryLikelihood: 'MODERATE', confidence: 50,
    recoveryStatus: 'PENDING', recoveredAmount: 0, actionTaken: '',
    buildLearningRecord: false, // Phase 6 refuses to build a record while PENDING
  });

  const a = await ledger.bpoBuildRecoveryAnalytics({ vertical: 'healthcare' });

  // ── Performance ────────────────────────────────────────────────────
  // Only healthcare's scored (non-PENDING) resolutions count: RESOLVED-1
  // ($4850/$2000) + RESOLVED-2 ($2000/$2000) = $6850 exposure, $4000 recovered.
  ok(a.performance.totalExposure === 6850, 'performance: totalExposure excludes PENDING and other-vertical cases (got ' + a.performance.totalExposure + ')');
  ok(a.performance.totalRecovered === 4000, 'performance: totalRecovered sums scored resolutions (got ' + a.performance.totalRecovered + ')');
  ok(Math.abs(a.performance.recoveryRate - (4000 / 6850)) < 1e-4, 'performance: recoveryRate = recovered/exposure (rounded to 4dp, got ' + a.performance.recoveryRate + ')');
  ok(a.performance.casesByOutcome.recovered === 1, 'performance: 1 case bucketed as recovered');
  ok(a.performance.casesByOutcome.partial === 1, 'performance: 1 case bucketed as partial');
  ok(a.performance.casesByOutcome.pending === 1, 'performance: PENDING case counted in casesByOutcome but excluded from money math');
  ok(a.performance.casesByOutcome.none === 0, 'performance: NO_RECOVERY case excluded by vertical filter (bpo, not healthcare)');

  const payerAcme = a.performance.byPayer.find((p) => p.key === 'Acme Payer');
  ok(!!payerAcme && payerAcme.count === 1, 'performance.byPayer: Acme Payer group reflects only the in-vertical scored case');

  const actionAppealFiled = a.performance.byAction.find((x) => x.key === 'Appeal filed');
  ok(!!actionAppealFiled, 'performance.byAction: groups by actionTaken');

  // ── Pipeline ───────────────────────────────────────────────────────
  ok(a.pipeline.openCount === 3, 'pipeline: 3 open healthcare cases (got ' + a.pipeline.openCount + ')');
  ok(a.pipeline.openExposure === 9000, 'pipeline: open exposure sums the 3 open cases (5000+3000+1000)');
  ok(a.pipeline.overdue.length === 1 && a.pipeline.overdue[0].caseId === 'ANALYTICS-OPEN-1', 'pipeline: exactly the one case with a past dueDate is flagged overdue');
  ok(a.pipeline.likelyBottleneckStage === 'ready-for-review', 'pipeline: bottleneck stage is ready-for-review (2 aged cases there vs 1 in appeal-submitted, got ' + a.pipeline.likelyBottleneckStage + ')');
  const stageRfr = a.pipeline.byStage.find((s) => s.stage === 'ready-for-review');
  ok(!!stageRfr && stageRfr.count === 2, 'pipeline.byStage: ready-for-review has 2 cases');
  ok(a.pipeline.oldestOpen[0].caseId === 'ANALYTICS-OPEN-1', 'pipeline.oldestOpen: sorted oldest-first, 10-day-old case leads');

  // ── Prediction → Actual ────────────────────────────────────────────
  ok(a.predictionVsActual.summary.scoredRecords >= 2, 'predictionVsActual.summary: at least the 2 healthcare learning records are scored');
  const recentIds = a.predictionVsActual.recent.map((r) => r.caseId);
  ok(recentIds.includes('ANALYTICS-RESOLVED-1') && recentIds.includes('ANALYTICS-RESOLVED-2'), 'predictionVsActual.recent: includes both healthcare learning records');
  ok(!recentIds.includes('ANALYTICS-RESOLVED-3'), 'predictionVsActual.recent: excludes the bpo-vertical learning record when filtered by vertical');
  const recoveredRecent = a.predictionVsActual.recent.find((r) => r.caseId === 'ANALYTICS-RESOLVED-2');
  ok(!!recoveredRecent && recoveredRecent.calibrated === true, 'predictionVsActual.recent: LIKELY prediction + full recovery is calibrated');

  // ── Cross-vertical (no filter) sanity check ───────────────────────
  const all = await ledger.bpoBuildRecoveryAnalytics({});
  ok(all.performance.byVertical.length === 2, 'unfiltered: byVertical has both healthcare and bpo groups');
  ok(all.pipeline.openCount === 3, 'unfiltered: pipeline count unchanged (all open cases are healthcare in this fixture)');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('UNCAUGHT ERROR:', e);
  process.exit(1);
});
