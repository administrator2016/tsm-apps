'use strict';

// Closes the gap flagged in BPO_CLIENT_WALKTHROUGH.md §6: the admin-UI
// Member-linking panel (bpo-clients-admin.html) calls
// PATCH /api/bpo/clients/:id -> tsmLedger.bpoUpdateClient() (ledger-backed),
// which is a DIFFERENT code path from POST /api/admin/clients/:id/link-member
// -> clientRegistry.setTenantId() (login-registry-only, used by the retrofit
// script). Both were verified separately but never as one combined flow
// through the actual UI panel's own call. This test drives the real
// bpoUpdateClient() function (the same one the PATCH route calls) and
// traces the result all the way through to the login registry file and
// the session-shape the client-rollup route branches on -- proving they
// really do converge on the same place, not just asserting it.
//
// middleware/client-registry.js does real synchronous fs I/O against
// data/clients.json. Rather than mock it, this test backs up that file,
// runs against it for real, then restores it -- so the login-registry
// half of this test is genuine, unmocked file I/O, not a simulation.
// Only the Mongo/ledger side (bpo_clients collection) is faked, for the
// same reason as the other tests in this repo's scripts/ folder: no
// network path to the real Firestore endpoint from this environment.

const fs = require('fs');
const path = require('path');

const CLIENTS_JSON = path.join(__dirname, '..', 'data', 'clients.json');
const backup = fs.existsSync(CLIENTS_JSON) ? fs.readFileSync(CLIENTS_JSON, 'utf8') : null;

function restore() {
  if (backup !== null) fs.writeFileSync(CLIENTS_JSON, backup);
  else if (fs.existsSync(CLIENTS_JSON)) fs.unlinkSync(CLIENTS_JSON);
}

process.on('exit', restore); // safety net even if an assertion throws

// ── Fake Mongo layer (bpo_clients collection only) ───────────────────────
const stores = new Map();
function makeCollection(name) {
  if (!stores.has(name)) stores.set(name, []);
  const data = stores.get(name);
  return {
    async insertOne(doc) { data.push(doc); return { insertedId: data.length }; },
    async findOneAndUpdate(query, update, opts = {}) {
      const keys = Object.keys(query);
      const doc = data.find(d => keys.every(k => d[k] === query[k]));
      if (!doc) return null;
      if (update.$set) Object.assign(doc, update.$set);
      return doc; // matches mongodb driver v6's unwrapped return shape
    },
    async findOne(query = {}) {
      const keys = Object.keys(query);
      return data.find(d => keys.every(k => d[k] === query[k])) || null;
    },
  };
}

class FakeMongoClient {
  constructor() {}
  async connect() { return this; }
  db() { return { collection: (name) => makeCollection(name) }; }
}

const mongodbPath = require.resolve('mongodb');
require.cache[mongodbPath] = {
  id: mongodbPath, filename: mongodbPath, loaded: true,
  exports: { MongoClient: FakeMongoClient },
};

process.env.MONGODB_URI = 'mongodb://fake-host/test?loadBalanced=true';
process.env.TSM_SESSION_SECRET = process.env.TSM_SESSION_SECRET || 'test-secret-for-hmac';

const tsmLedger = require('../server/tsm-ledger-service.js');
const clientRegistry = require('../middleware/client-registry.js');

(async () => {
  const MEMBER_ID = 'member-combined-flow-test';

  // Step 1: create a real client login the way bpoCreateClient's retrofit
  // scenario assumes -- a login record that predates any Member link.
  const { client, accessCode } = clientRegistry.createClient('Combined Flow Test Client');

  // Step 2: seed the fake bpo_clients (ledger) doc with the SAME id, so
  // bpoUpdateClient's findOneAndUpdate has something to match against --
  // mirrors a real bpo_clients document that already exists for this client.
  const database = new FakeMongoClient().db();
  await database.collection('bpo_clients').insertOne({ id: client.id, name: client.label, tenantId: null });

  // Step 3: call the REAL function the PATCH /api/bpo/clients/:id route
  // calls -- this is the actual admin-UI panel's code path, not a
  // reimplementation of it.
  const updated = await tsmLedger.bpoUpdateClient(client.id, { tenantId: MEMBER_ID }, 'test-admin');

  // Step 4: confirm the ledger side updated...
  const ledgerSideOk = updated && updated.tenantId === MEMBER_ID;

  // ...AND confirm the login registry file was ACTUALLY updated on disk --
  // read it back through the same function server.js's /api/auth/login
  // route uses to build a session payload.
  const loginRecord = clientRegistry.findClientByCode(accessCode);
  const loginRegistrySynced = loginRecord && loginRecord.tenantId === MEMBER_ID;

  // Step 5: reconstruct the session payload exactly as server.js's login
  // route does (server.js ~line 320), to prove tenantId actually reaches
  // the session shape the rollup route branches on.
  const sessionPayload = {
    role: 'client',
    clientId: loginRecord.id,
    label: loginRecord.label,
    tenantId: loginRecord.tenantId || null,
  };

  // Step 6: apply the exact branch condition from
  // GET /api/bpo/reports/client-rollup (server.js ~line 1545).
  const wouldUseMemberRollup = sessionPayload.role === 'client' && !!sessionPayload.tenantId;

  const checks = [
    ['ledger-side (bpo_clients) tenantId updated', ledgerSideOk, true],
    ['login registry (data/clients.json) tenantId synced', loginRegistrySynced, true],
    ['next-login session payload carries tenantId', sessionPayload.tenantId, MEMBER_ID],
    ['client-rollup route would select Member (cross-vertical) branch', wouldUseMemberRollup, true],
  ];

  console.log('=== Combined Member-linking flow: PATCH route -> ledger -> login registry -> session -> rollup branch ===\n');
  let allPass = true;
  for (const [label, actual, expected] of checks) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (!pass) allPass = false;
    console.log(`${pass ? '✅' : '❌'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  console.log('\n' + (allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));

  restore();
  process.exit(allPass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); restore(); process.exit(1); });
