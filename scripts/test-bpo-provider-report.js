'use strict';

/**
 * Phase 13 regression: Provider Reporting — one data contract, two
 * role-scoped projections (client-safe vs internal), period + section
 * selection, and monthly snapshots built from the same function.
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
  if (condition) { passed += 1; console.log('OK: ' + message); }
  else { failed += 1; console.error('FAIL: ' + message); }
}
async function rejects(fn, re, message) {
  try { await fn(); ok(false, message); } catch (e) { ok(re.test(e.message) && e.isValidation === true, message); }
}

function seed(caseId, f) {
  getCollection('bpo_work_items')._docs.push(Object.assign({
    caseId, clientId: 'prov-a', vertical: 'healthcare', stage: 'exec-approved', status: 'open',
    owner: 'ann', priority: 'medium',
    payload: { structuredCase: { payer: f.payer, denialCategory: f.category, denialReasonCode: f.code || 'CO-50', financialExposure: f.exposure } },
  }, f.item));
}

(async () => {
  seed('A1', { payer: 'P1', category: 'medical_necessity', exposure: 1000, item: { createdAt: '2026-09-05T00:00:00.000Z', outcomeRecordedAt: '2026-09-08T00:00:00.000Z', recoveryStatus: 'RECOVERED', originalExposure: 1000, recoveredAmount: 1000, actionTaken: 'Appeal', dueDate: '2026-09-07T00:00:00.000Z' } });
  seed('A2', { payer: 'P1', category: 'coding', exposure: 2000, item: { createdAt: '2026-09-10T00:00:00.000Z', outcomeRecordedAt: '2026-09-15T00:00:00.000Z', recoveryStatus: 'PARTIALLY_RECOVERED', originalExposure: 2000, recoveredAmount: 500, actionTaken: 'Appeal', owner: 'bob' } });
  seed('A3', { payer: 'P2', category: 'coding', exposure: 500, item: { createdAt: '2026-08-20T00:00:00.000Z', outcomeRecordedAt: '2026-08-25T00:00:00.000Z', recoveryStatus: 'NO_RECOVERY', originalExposure: 500, recoveredAmount: 0, actionTaken: 'Peer-to-peer' } });
  seed('A4', { payer: 'P1', category: 'coding', exposure: 3000, item: { createdAt: '2026-09-12T00:00:00.000Z', stage: 'war-room', priority: 'high', dueDate: '2000-01-01T00:00:00.000Z', slaAgeHours: 200 } });
  seed('A5', { payer: 'P2', category: 'coding', exposure: 800, item: { createdAt: '2026-09-13T00:00:00.000Z', stage: 'war-room', dueDate: '2999-01-01T00:00:00.000Z', slaAgeHours: 10 } });
  seed('B1', { payer: 'P9', category: 'coding', exposure: 9999, item: { clientId: 'prov-b', createdAt: '2026-09-02T00:00:00.000Z', outcomeRecordedAt: '2026-09-03T00:00:00.000Z', recoveryStatus: 'RECOVERED', originalExposure: 9999, recoveredAmount: 9999, actionTaken: 'Appeal' } });
  getCollection('bpo_learning_records')._docs.push({ caseId: 'A1', clientId: 'prov-a', vertical: 'healthcare', predictedLikelihood: 'MODERATE', originalExposure: 1000, recoveredAmount: 1000, recoveryStatus: 'RECOVERED', variance: 0.4, calibrated: false, recordedAt: '2026-09-08T00:00:00.000Z' });

  // ── Validation ──
  await rejects(() => ledger.bpoBuildProviderReport({ view: 'client', period: '2026-09' }), /clientId is required/, 'client view requires clientId');
  await rejects(() => ledger.bpoBuildProviderReport({ clientId: 'prov-a', period: '2026-13' }), /period must be/, 'bad period rejected');
  await rejects(() => ledger.bpoBuildProviderReport({ clientId: 'prov-a', sections: 'nope' }), /unknown section/, 'unknown section rejected');
  await rejects(() => ledger.bpoBuildProviderReport({ clientId: 'prov-a', view: 'payer' }), /view must be/, 'unknown view rejected');

  // ── Client view, September ──
  const c = await ledger.bpoBuildProviderReport({ clientId: 'prov-a', period: '2026-09', view: 'client' });
  const dr = c.denialRecovery;
  ok(dr.resolved === 2 && dr.totalExposure === 3000 && dr.totalRecovered === 1500 && dr.remainingBalance === 1500 && dr.recoveryRate === 0.5, 'September recovery math (3000 exposure / 1500 recovered / 50%)');
  ok(dr.avgResolutionHours === 96, 'average time to resolution 96h');
  ok(dr.claimsWorked === 4 && dr.denialVolume === 4, 'claims worked (created or resolved in period) and denial volume');
  ok(dr.openRecovery.openCount === 2 && dr.openRecovery.openExposure === 3800, 'open recovery opportunities and exposure');
  ok(dr.slaRisk.overdueOpen === 1 && dr.slaRisk.overdueByPriority.high === 1, 'overdue deadline risk counted');
  ok(dr.openRecovery.aging.over7d === 1 && dr.openRecovery.aging.under1d === 1, 'open aging buckets');
  ok(dr.byDenialCategory.length === 2 && c.payerPerformance.byPayer.length === 1 && c.payerPerformance.byPayer[0].key === 'P1', 'category and payer groupings (only resolved-in-period, only this client)');
  ok(c.payerPerformance.byPayer[0].recurringDenialReasons[0].reason === 'CO-50', 'recurring denial reasons');
  ok(c.appealEffectiveness.byAction.length === 1 && c.appealEffectiveness.byAction[0].key === 'Appeal' && c.appealEffectiveness.evidencePackageTypeRecorded === false, 'appeal effectiveness by action, evidence type honestly flagged as not recorded');
  ok(c.executiveSummary.recovery.recoveryRate === 0.5 && c.executiveSummary.remainingRisk.overdueOpen === 1 && /2 claim\(s\) resolved/.test(c.executiveSummary.headline), 'executive summary aggregates the story');

  // ── Period over period ──
  const pop = c.periodOverPeriod;
  ok(pop.previousPeriod === '2026-08' && pop.previous.resolved === 1 && pop.previous.recoveryRate === 0, 'previous period resolved from same contract');
  ok(pop.delta.recovered === 1500 && pop.delta.recoveryRate === 0.5, 'period-over-period deltas');
  const allTime = await ledger.bpoBuildProviderReport({ clientId: 'prov-a', view: 'client' });
  ok(allTime.period === 'all' && allTime.periodOverPeriod === null && allTime.denialRecovery.resolved === 3, 'all-time scope has no PoP');

  // ── Client projection safety ──
  const clientJson = JSON.stringify(c);
  ok(!('internal' in c), 'client view has no internal block');
  ok(!/"caseId"|A1|A4|"owner"|ann|bob|calibrat|learning|payload/i.test(clientJson), 'client view leaks no case IDs, owners, calibration or learning data');
  ok(!/P9|9999/.test(clientJson), 'other client data never appears');

  // ── Section selection ──
  const sel = await ledger.bpoBuildProviderReport({ clientId: 'prov-a', period: '2026-09', sections: 'payer-performance', view: 'client' });
  ok(sel.payerPerformance && !sel.denialRecovery && !sel.executiveSummary && sel.sections.length === 1, 'section selection limits output');

  // ── Internal view ──
  const i = await ledger.bpoBuildProviderReport({ clientId: 'prov-a', period: '2026-09', view: 'internal' });
  ok(i.internal && i.denialRecovery.totalRecovered === 1500, 'internal view = client data + internal block');
  ok(i.internal.pipeline.likelyBottleneckStage === 'war-room' && i.internal.pipeline.oldestOpen[0].caseId === 'A4', 'bottleneck + oldest open (case-level, internal only)');
  ok(i.internal.queuePerformance.some(q => q.owner === 'ann' && q.count === 1) && i.internal.queuePerformance.some(q => q.owner === 'bob'), 'analyst/queue performance');
  ok(i.internal.slaFailures.overdueOpen === 1 && i.internal.slaFailures.resolvedLate === 1, 'SLA failures: overdue open + resolved late');
  ok(i.internal.predictionVsActual.records === 1 && i.internal.predictionVsActual.byPredictedLikelihood.MODERATE.predicted === 1, 'prediction vs actual scoped to client');
  ok(i.internal.governance.calibrationConfig.automaticProductionApplication === false, 'governance shows auto-apply off');

  // ── Snapshots: same data contract ──
  const snap = await ledger.bpoSaveProviderSnapshot('prov-a', '2026-09', 'test-suite');
  ok(snap.views.client.view === 'client' && snap.views.internal.view === 'internal', 'snapshot stores both projections');
  ok(snap.views.client.executiveSummary.headline === c.executiveSummary.headline && snap.views.client.denialRecovery.totalRecovered === c.denialRecovery.totalRecovered, 'snapshot matches live report (no second engine)');
  await ledger.bpoSaveProviderSnapshot('prov-a', '2026-09', 'test-suite');
  ok(getCollection('bpo_provider_report_snapshots')._docs.length === 1, 're-running a period replaces its snapshot');
  const got = await ledger.bpoGetProviderSnapshot('prov-a', '2026-09');
  ok(got && got.periodLabel === '2026-09', 'snapshot retrievable by period');
  const list = await ledger.bpoListProviderSnapshots({ clientId: 'prov-a' });
  ok(list.length === 1, 'snapshot history lists periods');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
