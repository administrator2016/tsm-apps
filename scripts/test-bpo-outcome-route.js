'use strict';

/**
 * Live route test: POST /api/bpo/work-items/:caseId/outcome
 *
 * Boots the real server.js in-process against the in-memory Mongo stub, logs in
 * through the real /api/auth/login, and drives the real route:
 *   - unauthenticated callers are refused
 *   - a contradictory outcome is a 400 that writes nothing
 *   - an unknown work item is a 404
 *   - the caller cannot supply/override originalExposure (claim-level $4,850
 *     comes from the stored structuredCase, never a client value or $187,000)
 *   - the canonical $2,000 of $4,850 outcome measures 41.24%
 *
 * Run: node scripts/test-bpo-outcome-route.js
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


// Isolation: this test must only ever talk to the server it boots itself.
// Never inherit a developer's real credentials or PORT -- with an inherited
// PORT already in use (e.g. a running dev server) the requests below would
// land on THAT server and seed a test work item into whatever it points at.
process.env.TSM_SESSION_SECRET = 'test-session-secret-for-route-test';
process.env.TSM_ADMIN_PASSWORD = 'route-test-admin-pw';

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed += 1; console.log('OK: ' + msg); }
  else { failed += 1; console.error('FAIL: ' + msg); }
}

let BASE = '';

// Ask the OS for a free port so nothing already listening can be mistaken for
// the server under test.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = require('net').createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer() {
  let last;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(BASE + '/api/auth/status');
      if (r.ok) return;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start: ' + (last && last.message));
}

async function main() {
  const port = await freePort();
  process.env.PORT = String(port);
  BASE = 'http://127.0.0.1:' + port;
  require('../server.js');
  await waitForServer();

  const caseId = 'denials:AZ-BCBS-2026-88214';
  const url = BASE + '/api/bpo/work-items/' + encodeURIComponent(caseId);

  console.log('\n== auth');
  let r = await fetch(url + '/outcome', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryStatus: 'PENDING' }) });
  ok(r.status === 401, 'unauthenticated outcome POST is refused (401) - got ' + r.status);

  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.TSM_ADMIN_PASSWORD }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  ok(login.status === 200 && cookie.startsWith('tsm_session='), 'admin login succeeds and returns a session cookie');
  const H = { 'Content-Type': 'application/json', Cookie: cookie };
  const post = (u, b) => fetch(u, { method: 'POST', headers: H, body: JSON.stringify(b) });

  console.log('\n== seed the canonical work item through the real upsert route');
  r = await post(url, {
    clientId: 'HC-TEST-CLIENT', vertical: 'healthcare', stage: 'ready-for-review', status: 'open',
    payload: { quarterlyExposure: 187000, structuredCase: { claimId: 'AZ-BCBS-2026-88214', financialExposure: 4850, recoveryLikelihood: 'MODERATE', confidence: 65, appealDeadline: '2026-11-07' } },
  });
  ok(r.status === 200, 'work item upsert route accepts the canonical case - got ' + r.status);

  console.log('\n== outcome route');
  r = await post(url + '/outcome', { recoveryStatus: 'RECOVERED', recoveredAmount: 2000 });
  let j = await r.json();
  ok(r.status === 400 && j.ok === false && /equal to originalExposure/.test(j.error), 'RECOVERED with $2,000 is a 400 with the reason - got ' + r.status + ' ' + j.error);
  let wi = await (await fetch(url, { headers: H })).json();
  ok(wi.workItem && wi.workItem.recoveryStatus === undefined, 'the rejected outcome wrote nothing to the work item');

  r = await post(BASE + '/api/bpo/work-items/' + encodeURIComponent('denials:DOES-NOT-EXIST') + '/outcome', { recoveryStatus: 'PENDING' });
  j = await r.json();
  ok(r.status === 404 && /not found/.test(j.error), 'an unknown work item is a 404 - got ' + r.status);

  r = await post(url + '/outcome', { recoveryStatus: 'PARTIALLY_RECOVERED', recoveredAmount: 2000, originalExposure: 187000, actionTaken: 'Appeal submitted', payerOutcome: 'Payer allowed partial recovery' });
  j = await r.json();
  ok(r.status === 200 && j.ok === true, 'the canonical partial outcome is accepted - got ' + r.status);
  ok(j.reconciliation && j.reconciliation.originalExposure === 4850, 'a client-supplied originalExposure of $187,000 is ignored; claim-level $4,850 is used');
  ok(j.reconciliation && j.reconciliation.remainingBalance === 2850 && Math.abs(j.reconciliation.recoveryRate - 2000 / 4850) < 1e-12, '$2,000 of $4,850 -> $2,850 remaining, 41.24%');
  ok(j.workItem && j.workItem.payload && j.workItem.payload.structuredCase.recoveryLikelihood === 'MODERATE' && j.workItem.payload.structuredCase.confidence === 65, 'the MODERATE / 65 prediction is untouched by the outcome');

  wi = await (await fetch(url, { headers: H })).json();
  ok(wi.workItem.recoveryStatus === 'PARTIALLY_RECOVERED' && wi.workItem.recoveredAmount === 2000, 'the outcome persists on the same work item and reads back through the existing GET route');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  console.log(failed ? 'OUTCOME ROUTE: FAIL' : 'OUTCOME ROUTE: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('FAIL (exception):', e); process.exit(1); });
