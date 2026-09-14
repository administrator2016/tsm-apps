// Functional harness for server/staffing-engine-service.js (employers,
// job orders, submit -> place pipeline, fee computation).
//
// Same fake-in-memory-Mongo approach as scripts/test-member-summary.js:
// no real MongoDB reachable in this sandbox, so 'mongodb' is faked
// in-process and injected via Module._resolveFilename before requiring
// the real service. Everything downstream of that require is the REAL,
// unmodified staffing-engine code.
//
// Run from repo root: node scripts/test-staffing-engine.js

const Module = require('module');
const path = require('path');

// ---- fake in-memory Mongo ------------------------------------------------
function matches(doc, query) {
  return Object.keys(query || {}).every((k) => doc[k] === query[k]);
}

class FakeCollection {
  constructor() { this.docs = []; }
  async insertOne(doc) { this.docs.push(doc); return { insertedId: doc.id || String(this.docs.length) }; }
  async findOne(query) { return this.docs.find((d) => matches(d, query)) || null; }
  find(query) {
    const results = this.docs.filter((d) => matches(d, query));
    const chain = {
      _results: results,
      sort(spec) {
        const [field, dir] = Object.entries(spec || {})[0] || [null, 1];
        if (field) {
          this._results = this._results.slice().sort((a, b) => {
            if (a[field] < b[field]) return -1 * dir;
            if (a[field] > b[field]) return 1 * dir;
            return 0;
          });
        }
        return this;
      },
      limit(n) { this._results = this._results.slice(0, n); return this; },
      async toArray() { return this._results; },
    };
    return chain;
  }
  async updateOne(query, update, opts) {
    const existing = this.docs.find((d) => matches(d, query));
    const setFields = (update && update.$set) || {};
    if (existing) {
      Object.assign(existing, setFields);
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (opts && opts.upsert) {
      const doc = { ...query, ...setFields };
      this.docs.push(doc);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
  }
  async deleteOne(query) {
    const idx = this.docs.findIndex((d) => matches(d, query));
    if (idx === -1) return { deletedCount: 0 };
    this.docs.splice(idx, 1);
    return { deletedCount: 1 };
  }
  async deleteMany(query) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, query));
    return { deletedCount: before - this.docs.length };
  }
}

class FakeDb {
  constructor() { this.collections = {}; }
  collection(name) {
    if (!this.collections[name]) this.collections[name] = new FakeCollection();
    return this.collections[name];
  }
}

class FakeMongoClient {
  constructor() { this._db = new FakeDb(); }
  async connect() { return this; }
  db() { return this._db; }
}

const fakeMongoModule = { MongoClient: FakeMongoClient };
const FAKE_MONGODB_ID = '__fake_mongodb__';
require.cache[FAKE_MONGODB_ID] = {
  id: FAKE_MONGODB_ID,
  filename: FAKE_MONGODB_ID,
  loaded: true,
  exports: fakeMongoModule,
};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'mongodb') return FAKE_MONGODB_ID;
  return originalResolveFilename.call(this, request, ...rest);
};

process.env.MONGODB_URI = 'mongodb://fake-for-test/tsm-consultz';

const engine = require(path.join(__dirname, '..', 'server', 'staffing-engine-service.js'));

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

async function main() {
  // 1. Employer create
  const employer = await engine.upsertEmployer({
    name: 'Acme Health Systems',
    contactEmail: 'hiring@acmehealth.example',
    sector: 'Healthcare',
    status: 'active',
  });
  check('upsertEmployer assigns employerId', /^emp_/.test(employer.employerId));
  check('upsertEmployer defaults preserved', employer.status === 'active');

  // 2. Job order — contingency model (default), 25%
  const jobOrder = await engine.upsertJobOrder({
    employerId: employer.employerId,
    title: 'Medical Billing Specialist',
    sector: 'Healthcare',
    payRate: 22, // $/hr
    feeType: 'contingency',
    feeValue: 25,
    openings: 1,
  });
  check('upsertJobOrder assigns jobOrderId', /^job_/.test(jobOrder.jobOrderId));
  check('upsertJobOrder rejects unknown employerId', await (async () => {
    try {
      await engine.upsertJobOrder({ employerId: 'emp_doesnotexist', title: 'X' });
      return false;
    } catch (e) {
      return /No employer found/.test(e.message);
    }
  })());

  // 3. Job order — markup model
  const markupOrder = await engine.upsertJobOrder({
    employerId: employer.employerId,
    title: 'IT Support Tech',
    sector: 'IT',
    payRate: 24,
    billRate: 38,
    feeType: 'markup',
    openings: 2,
  });

  // 4. Submit a candidate against the contingency job order
  const placement = await engine.submitCandidate({
    candidateId: 'cand_deadbeef0001',
    jobOrderId: jobOrder.jobOrderId,
  });
  check('submitCandidate starts at status submitted', placement.status === 'submitted');
  check('submitCandidate inherits payRate from job order when not given', placement.payRate === 22);
  check('submitCandidate rejects unknown jobOrderId', await (async () => {
    try {
      await engine.submitCandidate({ candidateId: 'x', jobOrderId: 'job_nope' });
      return false;
    } catch (e) {
      return /No job order found/.test(e.message);
    }
  })());

  // 5. Walk the pipeline: submitted -> interviewing -> offered -> placed
  await engine.updatePlacementStatus(placement.placementId, 'interviewing');
  await engine.updatePlacementStatus(placement.placementId, 'offered');
  const placed = await engine.updatePlacementStatus(placement.placementId, 'placed');
  check('placement reaches placed status', placed.status === 'placed');
  check('statusHistory records all 4 transitions', placed.statusHistory.length === 4);
  check('placed placement has a computedFee', placed.computedFee && placed.computedFee.type === 'contingency');
  check(
    'contingency fee = 25% of (22/hr * 2080hrs) = $11,440',
    placed.computedFee && placed.computedFee.amount === 11440
  );
  check('updatePlacementStatus rejects invalid status', await (async () => {
    try {
      await engine.updatePlacementStatus(placement.placementId, 'not_a_real_status');
      return false;
    } catch (e) {
      return /Invalid status/.test(e.message);
    }
  })());

  // 6. Job order auto-marked filled once openings met
  const filledOrder = await engine.getJobOrder(jobOrder.jobOrderId);
  check('single-opening job order auto-marks filled after one placement', filledOrder.status === 'filled');

  // 7. Markup fee model — no percentage math, just the hourly spread
  const markupPlacement = await engine.submitCandidate({
    candidateId: 'cand_deadbeef0002',
    jobOrderId: markupOrder.jobOrderId,
  });
  const markupPlaced = await engine.updatePlacementStatus(markupPlacement.placementId, 'placed');
  check(
    'markup fee = billRate(38) - payRate(24) = $14/hr spread',
    markupPlaced.computedFee && markupPlaced.computedFee.hourlySpread === 14
  );
  const markupOrderAfterOne = await engine.getJobOrder(markupOrder.jobOrderId);
  check(
    '2-opening job order NOT yet filled after 1 of 2 placements',
    markupOrderAfterOne.status === 'open'
  );

  // 8. Listing / filtering
  const openJobOrders = await engine.listJobOrders({ status: 'open' });
  check('listJobOrders filters by status', openJobOrders.every((j) => j.status === 'open'));
  const employerPlacements = await engine.listPlacements({ employerId: employer.employerId });
  check('listPlacements filters by employerId', employerPlacements.length === 2);

  // 9. Delete paths
  const delOk = await engine.deletePlacement(placement.placementId);
  check('deletePlacement returns true for existing record', delOk === true);
  const delMissing = await engine.deletePlacement('plc_doesnotexist');
  check('deletePlacement returns false for missing record', delMissing === false);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test harness crashed:', err);
  process.exit(1);
});
