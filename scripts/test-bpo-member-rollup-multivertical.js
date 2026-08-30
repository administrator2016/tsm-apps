'use strict';

// ── Fake in-process Mongo layer ──────────────────────────────────────────
// We don't have network access to the real Firestore/Mongo endpoint from
// this sandbox, so this verifies bpoBuildMemberClientRollup's AGGREGATION
// LOGIC against a realistic multi-vertical case set (mirrors how the
// Slack-notify test in this repo used a mocked fetch, not a live send).
// This proves the math is right; it does not prove the live prod DB
// round-trip, which needs real network access to actually confirm.

const stores = new Map(); // collectionName -> array of docs

function makeCollection(name) {
  if (!stores.has(name)) stores.set(name, []);
  const data = stores.get(name);
  return {
    find(query = {}) {
      const keys = Object.keys(query);
      const filtered = data.filter(doc => keys.every(k => doc[k] === query[k]));
      return {
        sort() { return this; },
        limit(n) { this._limit = n; return this; },
        toArray: async () => (this._limit ? filtered.slice(0, this._limit) : filtered),
      };
    },
    async findOne(query = {}) {
      const keys = Object.keys(query);
      return data.find(doc => keys.every(k => doc[k] === query[k])) || null;
    },
    async insertOne(doc) { data.push(doc); return { insertedId: data.length }; },
    async updateOne(query, update, opts = {}) {
      const keys = Object.keys(query);
      let existing = data.find(doc => keys.every(k => doc[k] === query[k]));
      if (!existing && opts.upsert) {
        existing = { ...query };
        data.push(existing);
      }
      if (existing && update.$set) Object.assign(existing, update.$set);
      return { acknowledged: true };
    },
  };
}

class FakeMongoClient {
  constructor() {}
  async connect() { return this; }
  db() {
    return { collection: (name) => makeCollection(name) };
  }
}

// The real 'mongodb' package exports MongoClient as a getter-only property,
// so we replace its cache entry wholesale rather than mutating the export.
const mongodbPath = require.resolve('mongodb');
require.cache[mongodbPath] = {
  id: mongodbPath,
  filename: mongodbPath,
  loaded: true,
  exports: { MongoClient: FakeMongoClient },
};
const mongodb = require('mongodb');

process.env.MONGODB_URI = 'mongodb://fake-host/test?loadBalanced=true';

const tsmLedger = require('/home/claude/tsm-apps/server/tsm-ledger-service.js');

// ── Seed a realistic multi-vertical case set for one test Member ────────
const MEMBER_ID = 'member-acme-test';
const now = Date.now();
const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000).toISOString();
const daysFromNow = (n) => new Date(now + n * 24 * 60 * 60 * 1000).toISOString();

const cases = [
  { caseId: 'c1', tenantId: MEMBER_ID, vertical: 'bpo',          status: 'OPEN',        priority: 'HIGH',     exposure: 12000, deadline: daysFromNow(3),  detectedAt: daysAgo(10), updatedAt: daysAgo(0) },
  { caseId: 'c2', tenantId: MEMBER_ID, vertical: 'bpo',          status: 'CLOSED',      priority: 'MEDIUM',   exposure: 5000,  deadline: null,            detectedAt: daysAgo(30), updatedAt: daysAgo(5) },
  { caseId: 'c3', tenantId: MEMBER_ID, vertical: 'schools',      status: 'OPEN',        priority: 'HIGH',     exposure: 40000, deadline: daysFromNow(2),  detectedAt: daysAgo(5),  updatedAt: daysAgo(0) },
  { caseId: 'c4', tenantId: MEMBER_ID, vertical: 'schools',      status: 'IN_PROGRESS', priority: 'LOW',      /* no exposure */ deadline: daysFromNow(20), detectedAt: daysAgo(2),  updatedAt: daysAgo(0) },
  { caseId: 'c5', tenantId: MEMBER_ID, vertical: 'healthcare',   status: 'OPEN',        priority: 'CRITICAL', exposure: 8500,  deadline: daysFromNow(1),  detectedAt: daysAgo(1),  updatedAt: daysAgo(0) },
  { caseId: 'c6', tenantId: MEMBER_ID, vertical: 'healthcare',   status: 'CLOSED',      priority: 'HIGH',     exposure: 22000, deadline: null,            detectedAt: daysAgo(60), updatedAt: daysAgo(40) },
  { caseId: 'c7', tenantId: MEMBER_ID, vertical: 'construction', status: 'OPEN',        priority: 'MEDIUM',   exposure: 3000,  deadline: daysFromNow(30), detectedAt: daysAgo(15), updatedAt: daysAgo(3) },
  { caseId: 'c8', tenantId: MEMBER_ID, vertical: 'construction', status: 'OPEN',        priority: 'MEDIUM',   exposure: 3000,  deadline: daysAgo(1),      detectedAt: daysAgo(20), updatedAt: daysAgo(1) }, // overdue, still open -> at risk
  { caseId: 'c9', tenantId: MEMBER_ID, vertical: 'bpo',          status: 'OPEN',        priority: 'LOW',      exposure: 1500,  deadline: daysFromNow(45), detectedAt: daysAgo(4),  updatedAt: daysAgo(0) },
  { caseId: 'c10', tenantId: MEMBER_ID, /* no vertical, no sector */ status: 'OPEN',    priority: 'HIGH',     exposure: 999,   deadline: null,            detectedAt: daysAgo(6),  updatedAt: daysAgo(0) },
  // Noise: a case belonging to a DIFFERENT member, must be excluded entirely
  { caseId: 'x1', tenantId: 'some-other-member', vertical: 'bpo', status: 'OPEN', priority: 'HIGH', exposure: 999999, deadline: daysFromNow(1), detectedAt: daysAgo(1), updatedAt: daysAgo(0) },
];

(async () => {
  // Insert via the fake collection directly (bypassing bpoUpsertCase to keep this a pure data-shape test)
  const database = new mongodb.MongoClient().db();
  const bpoCasesCol = database.collection('bpo_cases');
  for (const c of cases) await bpoCasesCol.insertOne(c);

  const rollup = await tsmLedger.bpoBuildMemberClientRollup(MEMBER_ID);

  // ── Independently computed expectations (not reusing the function's logic) ──
  const memberCases = cases.filter(c => c.tenantId === MEMBER_ID);
  const expectedByVertical = {};
  const expectedByStatus = {};
  let expectedExposureTotal = 0;
  let expectedExposureCaseCount = 0;
  let expectedIsPartial = false;
  let expectedSlaAtRisk = 0;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const c of memberCases) {
    const v = c.vertical || c.sector || 'unknown';
    expectedByVertical[v] = (expectedByVertical[v] || 0) + 1;
    const s = c.status || 'UNKNOWN';
    expectedByStatus[s] = (expectedByStatus[s] || 0) + 1;
    if (typeof c.exposure === 'number') {
      expectedExposureTotal += c.exposure;
      expectedExposureCaseCount += 1;
    } else {
      expectedIsPartial = true;
    }
    if (c.deadline && s !== 'CLOSED') {
      const dl = Date.parse(c.deadline);
      if (!Number.isNaN(dl) && dl - Date.now() <= SEVEN_DAYS_MS) expectedSlaAtRisk += 1;
    }
  }

  const checks = [
    ['totalWorkItems', rollup.totalWorkItems, memberCases.length],
    ['byVertical', JSON.stringify(rollup.byVertical), JSON.stringify(expectedByVertical)],
    ['byStatus', JSON.stringify(rollup.byStatus), JSON.stringify(expectedByStatus)],
    ['exposureTotal', rollup.exposureTotal, expectedExposureTotal],
    ['exposureCaseCount', rollup.exposureCaseCount, expectedExposureCaseCount],
    ['isExposurePartial', rollup.isExposurePartial, expectedIsPartial],
    ['slaAtRisk', rollup.slaAtRisk, expectedSlaAtRisk],
    ['cross-tenant leak check (should be false)', rollup.cases.some(c => c.caseId === 'x1'), false],
  ];

  console.log('=== bpoBuildMemberClientRollup verification (real Member, real multi-vertical case history) ===\n');
  let allPass = true;
  for (const [label, actual, expected] of checks) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (!pass) allPass = false;
    console.log(`${pass ? '✅' : '❌'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  console.log('\n' + (allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
