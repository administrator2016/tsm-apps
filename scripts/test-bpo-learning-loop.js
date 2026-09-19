'use strict';

/**
 * Phase 12 regression: Strategist Learning Loop — calibration report +
 * config. Advisory only: nothing here may change a prediction or rewrite
 * a historical learning record.
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

async function expectThrow(fn, message) {
  try { await fn(); ok(false, message); } catch (e) { ok(true, message); }
}

function seedRecord(i, { tier, exposure, recovered, status, payer, vertical = 'healthcare', daysAgo = 1 }) {
  const caseId = 'LL-' + i;
  getCollection('bpo_work_items')._docs.push({
    caseId, vertical, stage: 'exec-approved', status: 'open', actionTaken: 'Appeal',
    payload: { structuredCase: { payer, denialCategory: 'medical_necessity', financialExposure: exposure } },
  });
  getCollection('bpo_learning_records')._docs.push({
    caseId, vertical, predictedLikelihood: tier,
    originalExposure: exposure, recoveredAmount: recovered, recoveryStatus: status,
    variance: 0, calibrated: false,
    recordedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  });
}

(async () => {
  // ── Config defaults + guards ──
  const cfg = await ledger.bpoGetCalibrationConfig();
  ok(cfg.minSampleSize === 50 && cfg.recalibrationWindowDays === 90, 'config defaults: 50 samples / 90 days');
  ok(cfg.confidenceAdjustmentCeiling === 10, 'config default ceiling is 10');
  ok(cfg.automaticProductionApplication === false && cfg.humanApprovalRequired === true, 'auto-apply off, human approval on by default');

  await expectThrow(() => ledger.bpoUpdateCalibrationConfig({ automaticProductionApplication: true }, 't'), 'enabling automaticProductionApplication is rejected');
  await expectThrow(() => ledger.bpoUpdateCalibrationConfig({ minSampleSize: 0 }, 't'), 'minSampleSize 0 rejected');
  await expectThrow(() => ledger.bpoUpdateCalibrationConfig({ confidenceAdjustmentCeiling: 500 }, 't'), 'ceiling > 100 rejected');

  const updated = await ledger.bpoUpdateCalibrationConfig({ minSampleSize: 5, confidenceAdjustmentCeiling: 10 }, 'test-suite');
  ok(updated.minSampleSize === 5 && updated.automaticProductionApplication === false, 'update persists and keeps auto-apply false');

  // ── Empty report ──
  const empty = await ledger.bpoBuildLearningLoopReport({});
  ok(empty.overall.totalRecords === 0 && empty.calibrationBreakdown.length === 0, 'empty store yields empty report');

  // ── Seed: 6 MODERATE cases at Payer A recovering ~10% (band 30-60% => DOWNWARD) ──
  for (let i = 0; i < 6; i++) seedRecord(i, { tier: 'MODERATE', exposure: 1000, recovered: 100, status: 'NO_RECOVERY', payer: 'Payer A' });
  // 2 MODERATE at Payer B, in band (45%) but below min sample
  for (let i = 6; i < 8; i++) seedRecord(i, { tier: 'MODERATE', exposure: 1000, recovered: 450, status: 'PARTIALLY_RECOVERED', payer: 'Payer B' });
  // 6 UNLIKELY at Payer C recovering 80% (band 0-30% => UPWARD)
  for (let i = 8; i < 14; i++) seedRecord(i, { tier: 'UNLIKELY', exposure: 1000, recovered: 800, status: 'RECOVERED', payer: 'Payer C' });
  // Old record outside the 90-day window
  seedRecord(99, { tier: 'MODERATE', exposure: 1000, recovered: 0, status: 'NO_RECOVERY', payer: 'Payer A', daysAgo: 200 });

  const before = JSON.stringify(getCollection('bpo_learning_records')._docs);
  const report = await ledger.bpoBuildLearningLoopReport({});
  const after = JSON.stringify(getCollection('bpo_learning_records')._docs);
  ok(before === after, 'report never mutates learning records');

  ok(report.overall.totalRecords === 15, 'overall counts all records including out-of-window');
  ok(report.recalibrationWindow.recordsInWindow === 14, 'window excludes the 200-day-old record');
  const mod = report.overall.byPredictedLikelihood.MODERATE;
  ok(mod.cases === 9 && mod.outcomeCounts.partial === 2 && mod.outcomeCounts.none === 7, 'MODERATE outcome mix counted');

  const a = report.calibrationBreakdown.find((r) => r.payer === 'Payer A');
  ok(a && a.sampleSize === 6 && a.signal === 'DOWNWARD', 'Payer A MODERATE flagged DOWNWARD');
  ok(a && a.eligibleForReview === true && a.proposedAdjustment && a.proposedAdjustment.suggestedConfidencePointsDelta === -10 && a.proposedAdjustment.cappedAtCeiling === true, 'Payer A adjustment capped at -10');
  ok(a && a.proposedAdjustment.status === 'PROPOSED_PENDING_HUMAN_REVIEW', 'proposal is pending human review');

  const b = report.calibrationBreakdown.find((r) => r.payer === 'Payer B');
  ok(b && b.signal === 'STABLE' && b.eligibleForReview === false && b.proposedAdjustment === null, 'Payer B in-band => STABLE, no proposal');

  const c = report.calibrationBreakdown.find((r) => r.payer === 'Payer C');
  ok(c && c.signal === 'UPWARD' && c.proposedAdjustment.suggestedConfidencePointsDelta === 10, 'Payer C UNLIKELY flagged UPWARD, +10');

  // ── Dimension rollups ──
  const dim = report.calibrationByDimension;
  ok(dim && dim.payer.length === 3 && dim.vertical.length === 2 && dim.action.length === 2 && dim.denialCategory.length === 2, 'per-dimension rollups present');
  const pa = dim.payer.find((r) => r.value === 'Payer A');
  ok(pa && pa.sampleSize === 6, 'payer rollup sample size');

  // ── Sample-size safeguard ──
  await ledger.bpoUpdateCalibrationConfig({ minSampleSize: 50 }, 'test-suite');
  const strict = await ledger.bpoBuildLearningLoopReport({});
  ok(strict.calibrationBreakdown.every((r) => r.eligibleForReview === false && r.proposedAdjustment === null), 'nothing eligible when below min sample size');
  ok(strict.calibrationBreakdown.some((r) => r.ineligibleReasons.length > 0), 'ineligible reasons explained');

  // ── Recalibration toggle ──
  await ledger.bpoUpdateCalibrationConfig({ minSampleSize: 5, likelihoodRecalibrationEnabled: false }, 'test-suite');
  const off = await ledger.bpoBuildLearningLoopReport({});
  ok(off.calibrationBreakdown.every((r) => r.eligibleForReview === false), 'disabled recalibration blocks all proposals');

  // ── Vertical filter ──
  const other = await ledger.bpoBuildLearningLoopReport({ vertical: 'insurance' });
  ok(other.overall.totalRecords === 0, 'vertical filter scopes records');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
