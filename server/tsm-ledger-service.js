// =====================================================
// TSM LEDGER SERVICE
// MongoDB-driver client for Firestore's MongoDB-compatibility
// endpoint (tsm-rcm-prod / database "tsm-consultz").
//
// Connection string comes from MONGODB_URI in .env, e.g.:
//   mongodb://<userCredsId>:<password>@<host>:443/tsm-consultz
//     ?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false
//
// NOTE: retryWrites=false is required — Firestore's Mongo-compatibility
// layer does not support retryable writes.
// =====================================================

const { MongoClient } = require('mongodb');
const clientRegistry = require('../middleware/client-registry');
const slackNotifier = require('./integrations/slack-notifier');

const DEFAULT_DB_NAME = 'tsm-consultz';
const LEDGER_COLLECTION = 'ledger_entries';
const PA_GL_COLLECTION = 'pa_gl_entries';
const PA_AP_COLLECTION = 'pa_ap_invoices';
const PA_MISSION_COLLECTION = 'pa_missions';

let client = null;
let db = null;
let connecting = null;

/**
 * Lazily connects and caches a single MongoClient for the process.
 * Safe to call from multiple places concurrently — concurrent callers
 * during the first connect share the same in-flight promise.
 */
async function connect() {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env (see server/tsm-ledger-service.js header for format).'
    );
  }

  connecting = (async () => {
    try {
      client = new MongoClient(uri, {
        // Firestore's Mongo-compat layer wants these explicit; harmless
        // no-ops against real MongoDB if this code ever points elsewhere.
        serverSelectionTimeoutMS: 10000,
        // Bounds the initial TCP/TLS handshake — without this, a stalled
        // network path to the endpoint hangs client.connect() indefinitely
        // (serverSelectionTimeoutMS only bounds topology *selection*, not
        // the handshake itself), and every concurrent caller sharing this
        // same in-flight `connecting` promise hangs with it.
        connectTimeoutMS: 10000,
        // Bounds any individual socket read/write after connection — the
        // driver default is 0 (no timeout), so a connection that goes
        // stale mid-operation (half-open TCP, LB drop) would otherwise
        // hang that operation forever instead of surfacing an error.
        socketTimeoutMS: 15000,
      });
      await client.connect();
      db = client.db(DEFAULT_DB_NAME);
      connecting = null;
      return db;
    } catch (err) {
      // Without this reset, a single failed/timed-out connection attempt
      // would permanently wedge every ledger-touching route for the rest
      // of the process's life — every future call would keep re-awaiting
      // this same rejected promise instead of retrying. Clearing both lets
      // the next request attempt a fresh connect() if the network recovers.
      client = null;
      connecting = null;
      throw err;
    }
  })();

  return connecting;
}

async function getDb() {
  return db || connect();
}

async function getLedgerCollection() {
  const database = await getDb();
  return database.collection(LEDGER_COLLECTION);
}

/**
 * Writes a single ledger entry. Adds a server-side timestamp if the
 * caller didn't supply one.
 */
async function writeEntry(entry) {
  const col = await getLedgerCollection();
  const doc = { ts: new Date().toISOString(), ...entry };
  const result = await col.insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

/**
 * Reads the most recent N ledger entries, newest first.
 */
async function readRecentEntries(limit = 20) {
  const col = await getLedgerCollection();
  return col.find({}).sort({ ts: -1 }).limit(limit).toArray();
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

// =====================================================
// PROPERTY ACCOUNTING & REVENUE CYCLE
// Collections keyed by missionId (e.g. "PA-MEC-001" — one document
// per property/close-period). Mirrors the in-page state shape that
// html/construction-suite/property-accounting-revenue-cycle.html
// used to keep purely client-side.
// =====================================================

async function paGlCollection() {
  const database = await getDb();
  return database.collection(PA_GL_COLLECTION);
}

async function paApCollection() {
  const database = await getDb();
  return database.collection(PA_AP_COLLECTION);
}

async function paMissionCollection() {
  const database = await getDb();
  return database.collection(PA_MISSION_COLLECTION);
}

/**
 * Ensures a mission/budget doc exists for this missionId, seeding it
 * with `seed` (budget, actual, property, period, etc.) only if absent.
 * Never overwrites an existing doc — seeding is first-write-wins.
 */
async function paEnsureMission(missionId, seed) {
  const col = await paMissionCollection();
  await col.updateOne(
    { missionId },
    { $setOnInsert: { missionId, ...seed, createdAt: new Date().toISOString() } },
    { upsert: true }
  );
  return col.findOne({ missionId });
}

async function paGetMission(missionId) {
  const col = await paMissionCollection();
  return col.findOne({ missionId });
}

async function paUpdateBudget(missionId, budget) {
  const col = await paMissionCollection();
  await col.updateOne(
    { missionId },
    { $set: { budget, updatedAt: new Date().toISOString() } }
  );
  return col.findOne({ missionId });
}

async function paAdjustActual(missionId, delta) {
  const col = await paMissionCollection();
  await col.updateOne(
    { missionId },
    { $inc: { actual: delta }, $set: { updatedAt: new Date().toISOString() } }
  );
  return col.findOne({ missionId });
}

async function paListGlEntries(missionId) {
  const col = await paGlCollection();
  return col.find({ missionId }).sort({ ts: 1 }).toArray();
}

async function paPostGlEntry(missionId, entry) {
  const col = await paGlCollection();
  const doc = {
    missionId,
    date: entry.date,
    account: entry.account,
    type: entry.type,
    amount: entry.amount,
    description: entry.description,
    ts: new Date().toISOString(),
  };
  const result = await col.insertOne(doc);
  return { _id: result.insertedId, ...doc };
}

async function paListApInvoices(missionId) {
  const col = await paApCollection();
  return col.find({ missionId }).sort({ id: 1 }).toArray();
}

/**
 * Seeds AP invoices for a mission only if none exist yet for it
 * (first-write-wins, same pattern as paEnsureMission).
 */
async function paEnsureApInvoices(missionId, invoices) {
  const col = await paApCollection();
  const existing = await col.countDocuments({ missionId });
  if (existing > 0) return;
  const docs = invoices.map((inv) => ({ missionId, ...inv }));
  if (docs.length) await col.insertMany(docs);
}

async function paSetApInvoiceStatus(missionId, invoiceId, status) {
  const col = await paApCollection();
  const result = await col.findOneAndUpdate(
    { missionId, id: invoiceId, status: 'pending' },
    { $set: { status, decidedAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  return result && result.value ? result.value : result;
}

/**
 * Test/demo-support only: wipes all GL entries and AP invoices for a
 * missionId and resets its mission doc back to `seed`, so a repeatable
 * e2e run (or a demo reset) starts from a pristine state instead of
 * accumulating real persisted entries run over run. paEnsureMission is
 * first-write-wins by design (never overwrites once seeded), so this is
 * the only way to actually re-seed an existing missionId.
 */
async function paResetMission(missionId, seed) {
  const [glCol, apCol, missionCol] = await Promise.all([
    paGlCollection(),
    paApCollection(),
    paMissionCollection(),
  ]);
  await Promise.all([
    glCol.deleteMany({ missionId }),
    apCol.deleteMany({ missionId }),
    missionCol.deleteOne({ missionId }),
  ]);
  await missionCol.updateOne(
    { missionId },
    { $setOnInsert: { missionId, ...seed, createdAt: new Date().toISOString() } },
    { upsert: true }
  );
  return missionCol.findOne({ missionId });
}

// =====================================================
// HITL APPROVAL GATE PERSISTENCE
// Durable backing store for html/shared/tsm-hitl-gate.js, whose
// decisionLog was previously an in-memory array only -- every
// approve/reject decision (Governance, Integration Hub, the 8 exec-portal
// Decision Centers, Approval Chain) was lost on every server restart.
// One shared collection for all gates, distinguished by gatePrefix (the
// same 'GOV' / 'IHUB' / 'HC' / 'APR' / etc. idPrefix each gate was
// already created with) so this doesn't need one collection per vertical.
// =====================================================

const HITL_COLLECTION = 'hitl_decisions';

async function hitlCollection() {
  const database = await getDb();
  return database.collection(HITL_COLLECTION);
}

/**
 * Upserts a single HITL decision by its own id (already unique -- see
 * decisionId() in tsm-hitl-gate.js). Upsert instead of plain insert so a
 * retry or a hydrate/write race never produces a duplicate row.
 */
async function hitlWriteDecision(gatePrefix, entry) {
  const col = await hitlCollection();
  const doc = Object.assign({ gatePrefix }, entry);
  await col.updateOne({ id: entry.id }, { $set: doc }, { upsert: true });
  return doc;
}

/**
 * Reads all persisted decisions for one gate, oldest first -- matching
 * decisionLog's own push-append (oldest-first) ordering, so hydrate() in
 * tsm-hitl-gate.js can splice these straight in without re-sorting logic
 * living in two places.
 */
async function hitlReadDecisions(gatePrefix) {
  const col = await hitlCollection();
  return col.find({ gatePrefix }).sort({ ts: 1 }).toArray();
}

/**
 * Builds the { write, readAll } adapter shape html/shared/tsm-hitl-gate.js's
 * createGate(idPrefix, persistence) expects, bound to one gatePrefix. Every
 * server.js / routes/*.js call site that creates a HITL gate can do
 * `createGate('GOV', ledger.hitlAdapter('GOV'))` instead of hand-rolling the
 * same two-function object, so there's exactly one place that shape lives.
 */
function hitlAdapter(gatePrefix) {
  return {
    write: (entry) => hitlWriteDecision(gatePrefix, entry),
    readAll: () => hitlReadDecisions(gatePrefix),
  };
}

// =====================================================
// BPO OPERATIONAL PERSISTENCE
// Three collections backing the BPO war room / strategist / executive
// portal (html/war-rooms/bpo-war/*.html), replacing what was previously
// only ever kept in the browser's localStorage:
//
//   bpo_clients     — actual BPO client accounts (name, contact, status).
//                     Distinct from middleware/client-registry.js, which
//                     is login-portal access codes, not business records.
//   bpo_work_items  — the war-room → strategist → exec case pipeline
//                     (one doc per caseId), upserted as a case advances
//                     through stages. Mirrors the TSM_BPO_WAR_RELAY
//                     payload shape from bpo-war-room.html.
//   bpo_audit_logs  — append-only trail of who did what to a client or
//                     work item. Written automatically by the functions
//                     below, not called directly from routes.
// =====================================================

const BPO_CLIENTS_COLLECTION = 'bpo_clients';
const BPO_WORK_ITEMS_COLLECTION = 'bpo_work_items';
const BPO_AUDIT_LOGS_COLLECTION = 'bpo_audit_logs';
// Phase 2 (rest of): append-only collections. Unlike bpo_work_items (one
// doc per caseId, replaced wholesale on each stage advance), these three
// never overwrite — every note/SLA transition/AI output is its own doc,
// so history isn't lost when a case moves war-room -> strategist -> exec.
const BPO_NOTES_COLLECTION = 'bpo_notes';
const BPO_SLA_EVENTS_COLLECTION = 'bpo_sla_events';
const BPO_BNCA_REPORTS_COLLECTION = 'bpo_bnca_reports';
const BPO_DOC_META_COLLECTION = 'bpo_documents_meta';
const BPO_DOC_CHUNKS_COLLECTION = 'bpo_document_chunks';
// Universal Case Engine (Roadmap #10) server-side mirror of the browser's
// tsm_cases_v1 localStorage store (html/shared/tsm-case-manager.js). One
// doc per caseId, upserted wholesale on every TSMCaseManager mutation via
// syncToServer() — same "replace on advance" pattern as bpo_work_items,
// not append-only like bpo_notes/bpo_sla_events (the case's own `timeline`
// array already carries its audit history, so no separate log collection
// is needed here).
const BPO_CASES_COLLECTION = 'bpo_cases';

// SMB Member layer — a Member is a cross-vertical demo tenant (e.g. one
// SMB using Construction + Healthcare + Mortgage under one roof), keyed
// by the same tenantId that bpo_cases already carries. Deliberately a
// separate collection from bpo_clients: bpo_clients is BPO's own
// document-processing client list (a different concept — a BPO client
// pays for case processing; a Member is the multi-vertical demo/tenant
// entity whose cases roll up across verticals). Reusing bpo_clients
// would collide two meanings of "client".
const TSM_MEMBERS_COLLECTION = 'tsm_members';

// Batch intake layer (doc-search-multi ZIP/multi-file ingest). A Batch is
// the persisted counterpart to the DOM-only progress card zsNewBatch()
// creates client-side today — it survives a refresh and gives the
// per-file fault-isolated loop in tsm-doc-search-multi.html something to
// stamp results onto instead of 250 unconnected processFile() calls.
// caseIds accumulates as each file's classification is wired into the
// universal Case Engine (bpo_cases) via bpoUpsertCase, so a batch's
// rollup (batchSummary) is real aggregation over those linked cases —
// same "don't invent a number" discipline as memberCaseSummary, not a
// separately-tracked exposure total that could drift from the cases
// themselves.
const TSM_BATCHES_COLLECTION = 'tsm_batches';

const BPO_PRIORITIES = ['low', 'medium', 'high', 'critical'];

async function bpoClientsCollection() {
  const database = await getDb();
  return database.collection(BPO_CLIENTS_COLLECTION);
}

async function bpoWorkItemsCollection() {
  const database = await getDb();
  return database.collection(BPO_WORK_ITEMS_COLLECTION);
}

async function bpoAuditLogsCollection() {
  const database = await getDb();
  return database.collection(BPO_AUDIT_LOGS_COLLECTION);
}

async function bpoNotesCollection() {
  const database = await getDb();
  return database.collection(BPO_NOTES_COLLECTION);
}

async function bpoSlaEventsCollection() {
  const database = await getDb();
  return database.collection(BPO_SLA_EVENTS_COLLECTION);
}

async function bpoBncaReportsCollection() {
  const database = await getDb();
  return database.collection(BPO_BNCA_REPORTS_COLLECTION);
}

async function bpoCasesCollection() {
  const database = await getDb();
  return database.collection(BPO_CASES_COLLECTION);
}

async function tsmMembersCollection() {
  const database = await getDb();
  return database.collection(TSM_MEMBERS_COLLECTION);
}

async function tsmBatchesCollection() {
  const database = await getDb();
  return database.collection(TSM_BATCHES_COLLECTION);
}

/**
 * Appends one audit entry. Never throws to the caller — an audit-log
 * write failure shouldn't roll back or block the client/work-item
 * mutation it's describing, so callers fire-and-forget this.
 */
async function bpoWriteAudit(entry) {
  try {
    const col = await bpoAuditLogsCollection();
    const doc = { ts: new Date().toISOString(), ...entry };
    await col.insertOne(doc);
  } catch (e) {
    console.warn('[bpoWriteAudit] failed to write audit entry:', e.message);
  }
}

async function bpoListAuditLogs({ entityType, entityId, limit = 100 } = {}) {
  const col = await bpoAuditLogsCollection();
  const query = {};
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// ── Clients ──────────────────────────────────────────────────────────────

function bpoSlugifyClientId(name) {
  const s = (name || '').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'client';
}

async function bpoListClients({ status } = {}) {
  const col = await bpoClientsCollection();
  const query = {};
  if (status) query.status = status;
  const list = await col.find(query).sort({ name: 1 }).toArray();
  return list.map(c => ({ ...c, hasLogin: clientRegistry.idExists(c.id) }));
}

async function bpoGetClient(id) {
  const col = await bpoClientsCollection();
  const doc = await col.findOne({ id });
  if (!doc) return doc;
  return { ...doc, hasLogin: clientRegistry.idExists(id) };
}

/**
 * Creates a client. id is slugified from name, then de-duped by
 * appending -2, -3, ... if it collides with an existing client.
 */
// Admin controls for pricing/SLA plans (Phase 5). Deliberately minimal:
// a threshold hour count for SLA breach detection, and a coarse pricing
// tier + free-text billing note — not a rate table or contract engine.
// Both are per-client only; no vertical-level default layer yet (nothing
// in bpo_clients is vertical-scoped today, so a defaults-then-override
// system would be speculative complexity ahead of a second real use case).
const BPO_PRICING_TIERS = ['standard', 'premium', 'custom'];

async function bpoCreateClient({ name, contactName, contactEmail, contactPhone, notes, tenantId }, actor) {
  const clean = (name || '').toString().trim();
  if (!clean) throw new Error('name required');

  const col = await bpoClientsCollection();
  let id = bpoSlugifyClientId(clean);
  let suffix = 2;
  // Dedupe against both the ledger collection and the login registry so a
  // client's id always lines up 1:1 with its login record (or lack of one).
  while ((await col.findOne({ id })) || clientRegistry.idExists(id)) {
    id = `${bpoSlugifyClientId(clean)}-${suffix++}`;
  }

  // Optional from day one — for a multi-vertical engagement (e.g. GCU)
  // where the Member (tsm_members) is created first, pass its id here so
  // the client login is born already linked, instead of requiring the
  // separate POST /api/admin/clients/:id/link-member retrofit step. Every
  // single-vertical client omits this and is completely unaffected.
  const cleanTenantId = (tenantId || '').toString().trim() || null;

  const doc = {
    id,
    name: clean,
    contactName: (contactName || '').toString().trim(),
    contactEmail: (contactEmail || '').toString().trim(),
    contactPhone: (contactPhone || '').toString().trim(),
    notes: (notes || '').toString().trim(),
    status: 'active',
    tenantId: cleanTenantId,
    // Plan fields default unset — a client with no threshold/tier assigned
    // behaves exactly as every client did before this existed (SLA report
    // emits no breach flag, pricing UI has nothing to show).
    slaThresholdHours: null,
    pricingTier: null,
    billingRate: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await col.insertOne(doc);
  await bpoWriteAudit({
    actor, action: 'client.create', entityType: 'client', entityId: id,
    detail: { name: clean, tenantId: cleanTenantId },
  });

  // Create the matching portal login in the same call. If this fails, the
  // ledger client still exists — just without a login yet — and can be
  // covered later via bpoBackfillClientLogin(). Log it rather than silently
  // swallowing the error so it's visible in the audit trail.
  let hasLogin = false;
  let accessCode = null;
  try {
    const created = clientRegistry.createClientWithId(id, clean, cleanTenantId);
    accessCode = created.accessCode;
    hasLogin = true;
  } catch (e) {
    await bpoWriteAudit({
      actor, action: 'client.login_create_failed', entityType: 'client', entityId: id,
      detail: { error: e.message },
    });
  }

  return { ...doc, hasLogin, accessCode };
}

async function bpoUpdateClient(id, fields, actor) {
  const col = await bpoClientsCollection();
  const allowedText = ['name', 'contactName', 'contactEmail', 'contactPhone', 'notes', 'billingRate'];
  const $set = { updatedAt: new Date().toISOString() };
  for (const key of allowedText) {
    if (fields[key] !== undefined) $set[key] = (fields[key] || '').toString().trim();
  }

  // slaThresholdHours: nullable positive number. null/'' explicitly clears
  // it (removes SLA breach tracking for this client); anything else must
  // parse to a finite number > 0.
  if (fields.slaThresholdHours !== undefined) {
    const raw = fields.slaThresholdHours;
    if (raw === null || raw === '') {
      $set.slaThresholdHours = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('slaThresholdHours must be a positive number, or null to clear it');
      }
      $set.slaThresholdHours = n;
    }
  }

  // pricingTier: nullable enum. null/'' clears it.
  if (fields.pricingTier !== undefined) {
    const raw = fields.pricingTier;
    if (raw === null || raw === '') {
      $set.pricingTier = null;
    } else if (!BPO_PRICING_TIERS.includes(raw)) {
      throw new Error(`pricingTier must be one of: ${BPO_PRICING_TIERS.join(', ')}, or null to clear it`);
    } else {
      $set.pricingTier = raw;
    }
  }

  // tenantId: nullable string. null/'' clears the Member link. Keeps
  // bpo_clients and the login registry (middleware/client-registry.js) in
  // sync so a client's next-login session tenantId always matches what
  // this document shows — this is the retrofit path for a client created
  // before its Member existed; bpoCreateClient's tenantId param above is
  // the day-one path.
  if (fields.tenantId !== undefined) {
    const raw = (fields.tenantId || '').toString().trim() || null;
    $set.tenantId = raw;
    try {
      clientRegistry.setTenantId(id, raw);
    } catch (e) {
      // Ledger update still proceeds — same "log, don't fail the whole
      // request" pattern bpoCreateClient's login-creation step already
      // uses. Most likely cause: this client has no login record yet.
      await bpoWriteAudit({
        actor, action: 'client.tenant_link_sync_failed', entityType: 'client', entityId: id,
        detail: { error: e.message, tenantId: raw },
      });
    }
  }

  const result = await col.findOneAndUpdate(
    { id },
    { $set },
    { returnDocument: 'after' }
  );
  const updated = result && result.value ? result.value : result;
  if (updated) {
    await bpoWriteAudit({
      actor, action: 'client.update', entityType: 'client', entityId: id,
      detail: $set,
    });
  }
  return updated;
}

async function bpoSetClientStatus(id, status, actor) {
  if (status !== 'active' && status !== 'inactive') {
    throw new Error("status must be 'active' or 'inactive'");
  }
  const col = await bpoClientsCollection();
  const result = await col.findOneAndUpdate(
    { id },
    { $set: { status, updatedAt: new Date().toISOString() } },
    { returnDocument: 'after' }
  );
  const updated = result && result.value ? result.value : result;
  if (updated) {
    await bpoWriteAudit({
      actor, action: status === 'active' ? 'client.reactivate' : 'client.deactivate',
      entityType: 'client', entityId: id, detail: { status },
    });
    // Mirror the status into the login registry so a deactivated client is
    // also locked out of portal login, not just hidden from active views.
    // Login records aren't guaranteed to exist (pre-registry clients, or a
    // failed create-time login), so this is best-effort.
    try {
      if (clientRegistry.idExists(id)) {
        clientRegistry.setActive(id, status === 'active');
      }
    } catch (e) {
      await bpoWriteAudit({
        actor, action: 'client.login_status_sync_failed', entityType: 'client', entityId: id,
        detail: { error: e.message, status },
      });
    }
  }
  return updated ? { ...updated, hasLogin: clientRegistry.idExists(id) } : updated;
}

// Creates a login record for a client that doesn't have one yet — either
// because it predates the login registry, or because login creation failed
// at create-time. No-op (returns existing state) if a login already exists.
async function bpoBackfillClientLogin(id, actor) {
  const col = await bpoClientsCollection();
  const client = await col.findOne({ id });
  if (!client) throw new Error('Client not found');

  if (clientRegistry.idExists(id)) {
    return { hasLogin: true, accessCode: null, alreadyExisted: true };
  }

  const { accessCode } = clientRegistry.createClientWithId(id, client.name, client.tenantId || null);
  // New logins default active; align with the client's current ledger status.
  if (client.status === 'inactive') {
    clientRegistry.setActive(id, false);
  }
  await bpoWriteAudit({
    actor, action: 'client.login_backfill', entityType: 'client', entityId: id, detail: {},
  });
  return { hasLogin: true, accessCode, alreadyExisted: false };
}

// ── Work items ───────────────────────────────────────────────────────────
// One doc per caseId, upserted as it moves war-room -> strategist -> exec.
// stage/payload/clientId are replaced wholesale on each upsert; callers
// pass the full current snapshot (same shape as the old localStorage
// TSM_BPO_WAR_RELAY payload), not a partial patch.

async function bpoListWorkItems({ clientId, stage, limit = 100 } = {}) {
  const col = await bpoWorkItemsCollection();
  const query = {};
  if (clientId) query.clientId = clientId;
  if (stage) query.stage = stage;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function bpoGetWorkItem(caseId) {
  const col = await bpoWorkItemsCollection();
  return col.findOne({ caseId });
}

/**
 * Hours between two ISO timestamps (or now, if `to` omitted). Used for
 * slaAgeHours — how long a case has been open, computed at read/write
 * time from createdAt rather than stored as a value that would go stale.
 */
function bpoHoursBetween(fromIso, toIso) {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round(((to - from) / 3600000) * 100) / 100);
}

function bpoNormalizePriority(priority) {
  const p = (priority || '').toString().trim().toLowerCase();
  return BPO_PRIORITIES.includes(p) ? p : 'medium';
}

// The war-room's document extraction already classifies severity
// (payload.extraction.severity, e.g. 'CRITICAL'/'HIGH'/'MED'/'LOW') --
// real, already-computed data, not a guess. But the war-room UI's
// upsert call has never actually sent that through as `priority`, so
// every work item silently defaulted to 'medium' via the fallback below
// regardless of how severe the underlying extraction was. This maps the
// extraction's own severity label onto the same low/medium/high/critical
// scale bpoNormalizePriority already uses, so a case flagged CRITICAL at
// extraction time doesn't quietly show up as medium-priority everywhere
// downstream (exec portal filtering, this file's own priority field).
function bpoSeverityToPriority(severity) {
  const s = (severity || '').toString().trim().toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high') return 'high';
  if (s === 'medium' || s === 'med') return 'medium';
  if (s === 'low') return 'low';
  return null;
}

async function bpoUpsertWorkItem(caseId, fields, actor) {
  if (!caseId) throw new Error('caseId required');
  const col = await bpoWorkItemsCollection();
  const now = new Date().toISOString();
  const {
    clientId, vertical = 'bpo', stage = 'war-room', payload, status = 'open',
    owner, priority, dueDate,
  } = fields || {};

  const existing = await col.findOne({ caseId });
  const createdAt = existing ? existing.createdAt : now;

  const $set = {
    caseId, vertical, stage, status, updatedAt: now,
    slaAgeHours: bpoHoursBetween(createdAt, now),
  };
  // clientId is sticky, same contract as owner/priority/dueDate below: a
  // later upsert that omits it (e.g. the exec-portal's markExecuted() call,
  // which never sends clientId) must not erase the link a prior stage
  // already established. Previously this defaulted to null on every call
  // and overwrote whatever was stored, which silently unlinked a case from
  // its client the moment it was marked executed — the exact point the
  // client's rollup is supposed to reflect it as closed.
  if (clientId !== undefined) $set.clientId = clientId;
  else if (existing && existing.clientId !== undefined) $set.clientId = existing.clientId;
  else $set.clientId = null;
  // payload/owner/priority/dueDate are all optional and sticky — a later
  // upsert that doesn't pass one of them (e.g. the exec-portal resolve
  // call, or a bare priority-only edit) must not wipe out what a prior
  // sync or a human already set. payload defaults to {} only on genuine
  // first creation; any existing doc's payload is preserved verbatim
  // when the caller omits the field, same contract as owner/priority/
  // dueDate below. (Previously payload defaulted to {} unconditionally
  // and was NOT sticky, so a priority-only PATCH silently deleted the
  // stored extraction record — fixed here.)
  if (payload !== undefined) $set.payload = payload;
  else if (existing && existing.payload !== undefined) $set.payload = existing.payload;
  else $set.payload = {};
  // priority has one extra rule: on first creation only (no existing doc
  // yet), fall back to the extraction's own severity classification
  // instead of jumping straight to 'medium' — real computed data (e.g.
  // severity: 'CRITICAL') was being silently discarded here otherwise.
  // Once a doc exists, stored priority stays sticky same as before, even
  // across later resyncs that re-send the same extraction payload — so a
  // human's manual priority edit is never quietly clobbered by a later
  // stage advance.
  if (owner !== undefined) $set.owner = (owner || '').toString().trim();
  else if (existing && existing.owner !== undefined) $set.owner = existing.owner;
  if (priority !== undefined) $set.priority = bpoNormalizePriority(priority);
  else if (existing && existing.priority !== undefined) $set.priority = existing.priority;
  else $set.priority = bpoSeverityToPriority($set.payload && $set.payload.extraction && $set.payload.extraction.severity) || 'medium';
  if (dueDate !== undefined) $set.dueDate = dueDate || null;
  else if (existing && existing.dueDate !== undefined) $set.dueDate = existing.dueDate;

  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { caseId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ caseId });

  const previousStage = existing ? existing.stage : null;
  await bpoWriteAudit({
    actor, action: existing ? 'work_item.advance' : 'work_item.create',
    entityType: 'work_item', entityId: caseId,
    detail: { stage, clientId, previousStage },
  });

  // Auto-emit an SLA event for open/advance/resolve — separate from the
  // audit log, which is a generic who-did-what trail. This is specifically
  // the stage-timeline a reporting query can walk to compute time-in-stage
  // and breach counts, without parsing audit-log detail blobs.
  let slaEventType = 'advanced';
  if (!existing) slaEventType = 'opened';
  else if (status === 'resolved' && existing.status !== 'resolved') slaEventType = 'resolved';
  try {
    const slaCol = await bpoSlaEventsCollection();
    await slaCol.insertOne({
      caseId, clientId, vertical,
      type: slaEventType,
      fromStage: previousStage,
      toStage: stage,
      status,
      ageHoursAtEvent: $set.slaAgeHours,
      actor,
      ts: now,
    });
  } catch (e) {
    console.warn('[bpoUpsertWorkItem] failed to write SLA event:', e.message);
  }

  // Slack notification is opt-in (SLACK_BPO_NOTIFY_ENABLED) and a silent
  // no-op when unconfigured — see server/integrations/slack-notifier.js.
  // Never let a Slack delivery failure fail the upsert itself.
  try {
    await slackNotifier.notify({
      caseId, clientId: $set.clientId, vertical, stage, status,
      slaEventType, actor,
    });
  } catch (e) {
    console.warn('[bpoUpsertWorkItem] failed to send Slack notification:', e.message);
  }

  return doc;
}

// ── Case Engine (Roadmap #10) ───────────────────────────────────────────
// Server-side mirror of TSMCaseManager's tsm_cases_v1 localStorage store.
// Whole-document upsert on caseId — same "replace on every mutation"
// pattern as bpoUpsertWorkItem above, since a TSMCase's own `timeline`
// array is already the audit history (no separate append-only log needed
// here the way notes/sla-events have one). tenantId is a structural
// filter distinct from clientId on work items — cases carry both since a
// case can originate from a non-client-scoped exception feed.

async function bpoListCases({ vertical, tenantId, status, limit = 200 } = {}) {
  const col = await bpoCasesCollection();
  const query = {};
  if (vertical) query.vertical = vertical;
  if (tenantId) query.tenantId = tenantId;
  if (status) query.status = status;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function bpoGetCase(caseId) {
  const col = await bpoCasesCollection();
  return col.findOne({ caseId });
}

/**
 * Upserts the full case document as sent by TSMCaseManager.syncToServer()
 * — the browser is the source of truth for the case's shape (TSMCase in
 * tsm-case-manager.js); this just persists whatever snapshot it sends,
 * the same "caller sends the full current object" contract bpoUpsertWorkItem
 * uses for work items. Doesn't reject on unknown/extra fields, since
 * TSMCase's field set is intentionally wider than any one vertical needs.
 */
async function bpoUpsertCase(caseId, caseDoc, actor) {
  if (!caseId) throw new Error('caseId required');
  const col = await bpoCasesCollection();
  const now = new Date().toISOString();

  const existing = await col.findOne({ caseId });
  const createdAt = existing ? existing.createdAt : (caseDoc && caseDoc.detectedAt) || now;

  const $set = Object.assign({}, caseDoc || {}, {
    caseId,
    createdAt,
    syncedAt: now,
  });
  delete $set._id;

  await col.updateOne({ caseId }, { $set }, { upsert: true });
  const doc = await col.findOne({ caseId });

  await bpoWriteAudit({
    actor, action: existing ? 'case.sync' : 'case.create',
    entityType: 'case', entityId: caseId,
    detail: { status: (caseDoc || {}).status, vertical: (caseDoc || {}).vertical },
  });

  return doc;
}

// ── SMB Member layer ────────────────────────────────────────────────────
// A Member's id IS the tenantId used to tag cases (TSMCase.tenantId,
// wired in at exception->case creation time in the Construction/
// Healthcare/Mortgage exec portals). memberCaseSummary() is pure
// aggregation over bpo_cases already filtered by that tenantId — no
// numbers invented, nothing mocked; a member with zero tagged cases
// just gets zeros back.

function memberSlugifyId(name) {
  const s = (name || '').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'member';
}

async function memberList() {
  const col = await tsmMembersCollection();
  return col.find({}).sort({ name: 1 }).toArray();
}

async function memberGet(id) {
  const col = await tsmMembersCollection();
  return col.findOne({ id });
}

/**
 * Creates a Member. id is slugified from name (same de-dupe pattern as
 * bpoCreateClient) and becomes the tenantId new cases get tagged with.
 */
async function memberCreate({ name, verticals, notes }, actor) {
  const clean = (name || '').toString().trim();
  if (!clean) throw new Error('name required');

  const col = await tsmMembersCollection();
  let id = memberSlugifyId(clean);
  let suffix = 2;
  while (await col.findOne({ id })) {
    id = `${memberSlugifyId(clean)}-${suffix++}`;
  }

  const doc = {
    id,
    name: clean,
    verticals: Array.isArray(verticals) ? verticals.filter(Boolean) : [],
    notes: (notes || '').toString().trim(),
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await col.insertOne(doc);
  await bpoWriteAudit({
    actor, action: 'member.create', entityType: 'member', entityId: id,
    detail: { name: clean },
  });
  return doc;
}

/**
 * Real cross-vertical rollup for one member, aggregated from bpo_cases
 * filtered by tenantId === member id. No live-DB call in this codebase
 * invents a number that isn't in the underlying case docs:
 *   - exposureTotal sums only cases where `exposure` is an actual number
 *     (typeof check) -- a case with no exposure figure is EXCLUDED from
 *     the sum, not silently counted as $0, so the total never implies
 *     precision the source data doesn't have. exposureCaseCount tracks
 *     how many cases actually contributed, so a caller can tell a real
 *     $0 total from "no case here has exposure data yet" -- both
 *     isExposurePartial and exposureCaseCount are returned so a UI can
 *     show that distinction instead of a bare, misleadingly-precise
 *     dollar figure.
 *   - slaAtRisk: cases with a deadline within the next 7 days that
 *     aren't already CLOSED -- same "at risk" window used elsewhere in
 *     the BPO reports; a case with no deadline can't be at risk, so it's
 *     excluded rather than defaulted.
 *   - byVertical / byStatus / bySeverity are plain counts, always exact.
 */
async function memberCaseSummary(memberId) {
  const cases = await bpoListCases({ tenantId: memberId, limit: 5000 });

  const summary = {
    memberId,
    totalCases: cases.length,
    exposureTotal: 0,
    exposureCaseCount: 0,
    isExposurePartial: false,
    slaAtRisk: 0,
    byVertical: {},
    byStatus: {},
    bySeverity: {},
  };

  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const c of cases) {
    const vertical = c.vertical || c.sector || 'unknown';
    summary.byVertical[vertical] = (summary.byVertical[vertical] || 0) + 1;

    const status = c.status || 'UNKNOWN';
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

    const detected = Array.isArray(c.detectedExceptions) ? c.detectedExceptions : [];
    const severity = (detected[0] && detected[0].severity) || 'unknown';
    summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1;

    if (typeof c.exposure === 'number') {
      summary.exposureTotal += c.exposure;
      summary.exposureCaseCount += 1;
    } else {
      summary.isExposurePartial = true;
    }

    if (c.deadline && status !== 'CLOSED') {
      const deadlineMs = Date.parse(c.deadline);
      if (!Number.isNaN(deadlineMs) && deadlineMs - now <= SEVEN_DAYS_MS) {
        summary.slaAtRisk += 1;
      }
    }
  }

  return summary;
}

// ── Batch intake layer ──────────────────────────────────────────────────
// Closes the gap flagged against tsm-doc-search-multi.html: no persisted
// TSMBatch entity, no batchId on the resulting case records, no batch-
// level exposure rollup, and non-ZIP multi-select uploads had zero shared
// context linking them. This gives the ingest UI a real record to create
// up front and update as its existing fault-isolated per-file loop runs.

function batchGenerateId() {
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates a persisted batch. Call this once, before the per-file loop
 * starts (ZIP-expanded or plain multi-select — both cases now get a
 * shared batchId to stamp onto their resulting cases, closing the
 * "250 independent processFile() calls" gap for non-ZIP uploads too).
 */
async function batchCreate({ vertical, source, totalDocuments, tenantId } = {}, actor) {
  const total = Number.isFinite(Number(totalDocuments)) ? Number(totalDocuments) : 0;
  if (total <= 0) throw new Error('totalDocuments required');

  const col = await tsmBatchesCollection();
  const now = new Date().toISOString();
  const doc = {
    batchId: batchGenerateId(),
    vertical: vertical || 'unknown',
    source: source || 'upload',
    tenantId: tenantId || null,
    totalDocuments: total,
    processedDocuments: 0,
    failedDocuments: 0,
    caseIds: [],
    status: 'processing',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  await col.insertOne(doc);
  await bpoWriteAudit({
    actor, action: 'batch.create', entityType: 'batch', entityId: doc.batchId,
    detail: { vertical: doc.vertical, totalDocuments: total },
  });
  return doc;
}

async function batchGet(batchId) {
  const col = await tsmBatchesCollection();
  return col.findOne({ batchId });
}

async function batchList({ vertical, tenantId, status, limit = 200 } = {}) {
  const col = await tsmBatchesCollection();
  const query = {};
  if (vertical) query.vertical = vertical;
  if (tenantId) query.tenantId = tenantId;
  if (status) query.status = status;
  return col.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
}

/**
 * Records the outcome of one file in the batch's existing per-file
 * fault-isolated loop (the loop itself is unchanged — this just gives it
 * somewhere to report to instead of nowhere). Pass caseId when the file
 * was successfully classified and linked into the Case Engine via
 * bpoUpsertCase; pass ok:false with no caseId when the file was skipped
 * (the loop's existing `continue` path). Flips status to 'complete' once
 * processed+failed reaches totalDocuments -- never fabricates completion
 * early, and is safe to call out of order/concurrently since counters
 * are incremented with $inc rather than read-modify-write.
 */
async function batchRecordDocument(batchId, { caseId, ok = true } = {}, actor) {
  if (!batchId) throw new Error('batchId required');
  const col = await tsmBatchesCollection();
  const existing = await col.findOne({ batchId });
  if (!existing) throw new Error(`batch not found: ${batchId}`);

  const inc = ok ? { processedDocuments: 1 } : { failedDocuments: 1 };
  const update = { $inc: inc, $set: { updatedAt: new Date().toISOString() } };
  if (caseId && !existing.caseIds.includes(caseId)) {
    update.$addToSet = { caseIds: caseId };
  }
  await col.updateOne({ batchId }, update);

  const refreshed = await col.findOne({ batchId });
  const done = refreshed.processedDocuments + refreshed.failedDocuments >= refreshed.totalDocuments;
  if (done && refreshed.status !== 'complete') {
    const now = new Date().toISOString();
    await col.updateOne({ batchId }, { $set: { status: 'complete', completedAt: now, updatedAt: now } });
    await bpoWriteAudit({
      actor, action: 'batch.complete', entityType: 'batch', entityId: batchId,
      detail: { totalDocuments: refreshed.totalDocuments, caseCount: refreshed.caseIds.length },
    });
  }

  return col.findOne({ batchId });
}

/**
 * Real cross-case rollup for one batch, aggregated from the actual
 * bpo_cases docs the batch's caseIds point to -- same "no invented
 * numbers" discipline as memberCaseSummary: exposureTotal only sums
 * cases with a numeric exposure field (exposureCaseCount + isExposurePartial
 * mark when some linked cases don't have one yet), and a caseId that no
 * longer resolves to a case (deleted, or bpoUpsertCase hasn't landed yet)
 * is skipped rather than counted as zero.
 */
async function batchSummary(batchId) {
  const batch = await batchGet(batchId);
  if (!batch) throw new Error(`batch not found: ${batchId}`);

  const summary = {
    batchId,
    vertical: batch.vertical,
    status: batch.status,
    totalDocuments: batch.totalDocuments,
    processedDocuments: batch.processedDocuments,
    failedDocuments: batch.failedDocuments,
    linkedCaseCount: batch.caseIds.length,
    exposureTotal: 0,
    exposureCaseCount: 0,
    isExposurePartial: false,
    requiringReview: 0,
    byStatus: {},
    bySeverity: {},
  };

  for (const caseId of batch.caseIds) {
    const c = await bpoGetCase(caseId);
    if (!c) continue;

    const status = c.status || 'UNKNOWN';
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;
    if (status !== 'CLOSED' && status !== 'AUTO_APPROVED') {
      summary.requiringReview += 1;
    }

    const detected = Array.isArray(c.detectedExceptions) ? c.detectedExceptions : [];
    const severity = (detected[0] && detected[0].severity) || 'unknown';
    summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1;

    if (typeof c.exposure === 'number') {
      summary.exposureTotal += c.exposure;
      summary.exposureCaseCount += 1;
    } else {
      summary.isExposurePartial = true;
    }
  }

  return summary;
}

// ── Notes ────────────────────────────────────────────────────────────────
// Append-only — one doc per note, never edited/deleted in place, so a
// case's note history can't be silently rewritten.

async function bpoAddNote(caseId, { text, clientId } = {}, actor) {
  if (!caseId) throw new Error('caseId required');
  const clean = (text || '').toString().trim();
  if (!clean) throw new Error('text required');

  const col = await bpoNotesCollection();
  const doc = { caseId, clientId: clientId || null, text: clean, actor, ts: new Date().toISOString() };
  await col.insertOne(doc);
  await bpoWriteAudit({
    actor, action: 'work_item.note', entityType: 'work_item', entityId: caseId,
    detail: { textPreview: clean.slice(0, 120) },
  });
  return doc;
}

async function bpoListNotes({ caseId, limit = 100 } = {}) {
  const col = await bpoNotesCollection();
  const query = {};
  if (caseId) query.caseId = caseId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// ── SLA events ───────────────────────────────────────────────────────────
// Read-only from the outside — these are only ever written by
// bpoUpsertWorkItem above, not accepted directly from a route body.

async function bpoListSlaEvents({ caseId, clientId, limit = 200 } = {}) {
  const col = await bpoSlaEventsCollection();
  const query = {};
  if (caseId) query.caseId = caseId;
  if (clientId) query.clientId = clientId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// ── BNCA / AI-output reports ────────────────────────────────────────────
// Append-only — every AI/BNCA extraction+recommendation the strategist
// screen renders gets its own doc here, not just whatever the current
// bpo_work_items.payload snapshot happens to hold. Lets Phase 4 reporting
// (and any future audit) see what the model actually said at each point,
// not just the latest state.

async function bpoSaveBncaReport(caseId, report, actor) {
  if (!caseId) throw new Error('caseId required');
  if (!report || typeof report !== 'object') throw new Error('report object required');

  const col = await bpoBncaReportsCollection();
  const doc = {
    caseId,
    clientId: report.clientId || null,
    vertical: report.vertical || 'bpo',
    confidence: Number.isFinite(report.confidence) ? report.confidence : null,
    confidenceDefaulted: !!report.confidenceDefaulted,
    recommendation: report.recommendation || null,
    explainability: report.explainability || null,
    exposure: report.exposure || null, // { ifIgnored, ifActed, urgencyWindow } from TSMBNCAExposureEngine
    raw: report.raw !== undefined ? report.raw : report,
    actor,
    ts: new Date().toISOString(),
  };
  await col.insertOne(doc);
  await bpoWriteAudit({
    actor, action: 'work_item.bnca_report', entityType: 'work_item', entityId: caseId,
    detail: { confidence: doc.confidence },
  });
  return doc;
}

async function bpoListBncaReports({ caseId, limit = 50 } = {}) {
  const col = await bpoBncaReportsCollection();
  const query = {};
  if (caseId) query.caseId = caseId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// ── Client-facing rollup + monthly snapshots (Phase 4) ──────────────────
// Latorrey's call on scope (2026-08-24): full rollup (WIP + SLA +
// case-level summaries, same shape family as the internal
// executive-rollup) rather than a flat WIP/SLA dump, available both
// on-demand and as a generated monthly snapshot. Deliberately excludes
// anything the internal executive-rollup also excludes (no SLA
// breach/leakage/recovery figures — no threshold is defined anywhere in
// this codebase, and setting one is a client-contract decision per
// docs/BPO_PRODUCTION_READINESS.md, not something to invent here) and
// additionally excludes internal-only work-item fields (payload/owner)
// that have no reason to leave the building.
const BPO_CLIENT_MONTHLY_REPORTS_COLLECTION = 'bpo_client_monthly_reports';

async function bpoClientMonthlyReportsCollection() {
  const database = await getDb();
  return database.collection(BPO_CLIENT_MONTHLY_REPORTS_COLLECTION);
}

/**
 * Builds the full client-facing rollup for one clientId: the same
 * counts/average shape as bpoBuildRollup below (reused, not
 * reimplemented) plus a case-level summary list stripped to
 * client-safe fields. Shared by the on-demand report route and the
 * monthly-snapshot generator so both always agree.
 */
async function bpoBuildClientRollup(clientId) {
  if (!clientId) throw new Error('clientId is required');
  const [items, slaEvents] = await Promise.all([
    bpoListWorkItems({ clientId, limit: 5000 }),
    bpoListSlaEvents({ clientId, limit: 5000 }),
  ]);

  const byStage = {};
  const byStatus = {};
  const byPriority = {};
  let openAgeSum = 0;
  let openCount = 0;
  for (const item of items) {
    byStage[item.stage] = (byStage[item.stage] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byPriority[item.priority] = (byPriority[item.priority] || 0) + 1;
    if (item.status !== 'resolved' && Number.isFinite(item.slaAgeHours)) {
      openAgeSum += item.slaAgeHours;
      openCount += 1;
    }
  }

  const slaEventsByType = {};
  for (const ev of slaEvents) slaEventsByType[ev.type] = (slaEventsByType[ev.type] || 0) + 1;

  // Client-safe case-level summary: no `payload` (raw war-room
  // extraction detail is internal), no `owner` (internal staff
  // assignment isn't a client's concern) — just the fields a client
  // already sees one-at-a-time via GET /api/bpo/work-items/:caseId.
  const cases = items
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(item => ({
      caseId: item.caseId,
      vertical: item.vertical,
      stage: item.stage,
      status: item.status,
      priority: item.priority,
      dueDate: item.dueDate || null,
      slaAgeHours: item.slaAgeHours,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));

  return {
    clientId,
    totalWorkItems: items.length,
    byStage,
    byStatus,
    byPriority,
    avgOpenAgeHours: openCount ? Math.round((openAgeSum / openCount) * 100) / 100 : null,
    slaEventsByType,
    cases,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Cross-vertical counterpart to bpoBuildClientRollup, for a client session
 * linked to a Member (tenantId) rather than (or in addition to) a single
 * bpo_clients clientId. Reads bpo_cases (the universal Case Engine every
 * vertical exec portal syncs into via tsm-case-manager.js) filtered by
 * tenantId, instead of bpo_work_items (the legacy BPO-only pipeline
 * bpoBuildClientRollup reads). Returns the SAME top-level shape as
 * bpoBuildClientRollup (totalWorkItems/byStatus/byPriority/
 * avgOpenAgeHours/slaEventsByType/cases/generatedAt) so client-portal.html
 * renders it with zero changes, plus additive fields (byVertical,
 * exposureTotal, isExposurePartial, slaAtRisk) a UI can opt into showing.
 *
 * Client-safe by construction: only pulls fields a client should see
 * (caseId, vertical, status, priority, deadline, timestamps) — never
 * `owner`, `fields`, `timeline`, or any of TSMCase's internal-only
 * properties, mirroring the same allowlist-not-blocklist approach
 * bpoBuildClientRollup already uses for bpo_work_items.
 *
 * `stage` has no TSMCase equivalent (that's a bpo_work_items-only concept)
 * so it's set equal to `status` here — same information, just no separate
 * pipeline-stage label exists for a universal case yet.
 */
async function bpoBuildMemberClientRollup(tenantId) {
  if (!tenantId) throw new Error('tenantId is required');

  const [cases, summary] = await Promise.all([
    bpoListCases({ tenantId, limit: 5000 }),
    memberCaseSummary(tenantId),
  ]);

  const byPriority = {};
  let openAgeSum = 0;
  let openCount = 0;
  const now = new Date().toISOString();

  const safeCases = cases
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(c => {
      const priority = c.priority || 'unknown';
      byPriority[priority] = (byPriority[priority] || 0) + 1;

      const ageHours = bpoHoursBetween(c.detectedAt || c.createdAt, now);
      if (c.status !== 'CLOSED' && Number.isFinite(ageHours)) {
        openAgeSum += ageHours;
        openCount += 1;
      }

      return {
        caseId: c.caseId,
        vertical: c.vertical || c.sector || 'unknown',
        stage: c.status || null,
        status: c.status || null,
        priority,
        dueDate: c.deadline || null,
        slaAgeHours: Number.isFinite(ageHours) ? ageHours : null,
        createdAt: c.detectedAt || c.createdAt || null,
        updatedAt: c.updatedAt || null,
      };
    });

  return {
    memberId: tenantId,
    totalWorkItems: safeCases.length,
    byStage: summary.byStatus,
    byStatus: summary.byStatus,
    byPriority,
    byVertical: summary.byVertical,
    exposureTotal: summary.exposureTotal,
    exposureCaseCount: summary.exposureCaseCount,
    isExposurePartial: summary.isExposurePartial,
    slaAtRisk: summary.slaAtRisk,
    avgOpenAgeHours: openCount ? Math.round((openAgeSum / openCount) * 100) / 100 : null,
    slaEventsByType: {}, // bpo_cases has no SLA-event stream today (that's a bpo_work_items/bpo_sla_events concept) — empty, not fabricated
    cases: safeCases,
    generatedAt: new Date().toISOString(),
  };
}

function bpoCurrentPeriodLabel(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Persists a point-in-time rollup as that client's snapshot for a given
 * period (default: current UTC year-month, e.g. "2026-08"). Upsert on
 * {clientId, periodLabel} so re-running the generator mid-month (or
 * after a fix) replaces that period's snapshot rather than duplicating
 * it -- a monthly report is meant to be one canonical artifact per
 * client per period, not an append-only log.
 */
async function bpoSaveClientMonthlyReport(clientId, rollup, periodLabel = bpoCurrentPeriodLabel()) {
  const col = await bpoClientMonthlyReportsCollection();
  const now = new Date().toISOString();
  const doc = { clientId, periodLabel, rollup, generatedAt: now };
  await col.updateOne({ clientId, periodLabel }, { $set: doc }, { upsert: true });
  return doc;
}

async function bpoListClientMonthlyReports({ clientId, limit = 24 } = {}) {
  const col = await bpoClientMonthlyReportsCollection();
  const query = {};
  if (clientId) query.clientId = clientId;
  return col.find(query).sort({ periodLabel: -1 }).limit(limit).toArray();
}

async function bpoGetClientMonthlyReport(clientId, periodLabel) {
  const col = await bpoClientMonthlyReportsCollection();
  return col.findOne({ clientId, periodLabel });
}

// =====================================================
// BPO DOCUMENT STORAGE (Phase 3)
// This DB is Firestore's MongoDB-compatibility layer, not real MongoDB —
// the driver's built-in GridFSBucket lazily calls createIndex() on first
// use, which is unverified against this backend and not used anywhere
// else in this codebase. To stay inside the exact insertOne/find pattern
// already proven safe here (see rest of this file), documents are stored
// manually as base64 chunks across two plain collections instead of real
// GridFS:
//   bpo_documents_meta   — one doc per uploaded file (filename, mimetype,
//                          size, caseId, clientId, chunk count, uploader,
//                          soft-delete flag)
//   bpo_document_chunks  — ordered chunk docs, each a base64 slice under
//                          CHUNK_SIZE_BYTES so a full chunk doc (with
//                          ~33% base64 overhead + field overhead) stays
//                          well under Firestore's native 1 MiB per-document
//                          ceiling, in case this compat layer inherits it
// No files are ever deleted from disk/S3 (there is none) — deactivation
// is a soft-delete flag so the audit trail and chunk data stay intact,
// consistent with bpoSetClientStatus's soft-delete pattern above.
// =====================================================

const BPO_DOC_MAX_BYTES = 8 * 1024 * 1024; // matches routes/doc-router.js, routes/construction.js, routes/finops.js upload caps
const BPO_DOC_CHUNK_SIZE_BYTES = 400 * 1024; // pre-base64 size; ~533KB post-encoding, safely under a 1 MiB document ceiling
const BPO_DOC_TEXT_MAX_BYTES = 5 * 1024 * 1024; // extracted text is truncated (not rejected) past this — the source file already passed BPO_DOC_MAX_BYTES, extraction shouldn't be able to fail the whole upload

// ── Encryption at rest ──────────────────────────────────────────────────
// Firestore's Mongo-compat layer gives no server-side encryption knob of
// its own (unlike real MongoDB Atlas/self-hosted, which has an at-rest
// encryption option in the deployment config), so "encryption at rest"
// for this backend has to be done in the app layer: encrypt the file
// bytes here, before they're base64-chunked and written, with a key that
// only this server process holds. That's the part that's actually code —
// which KMS/secrets-manager holds TSM_DOC_ENCRYPTION_KEY in production,
// who's authorized to rotate it, and how a rotation/re-encryption run
// gets scheduled are operational decisions for whoever owns infra, not
// something this module decides on its own.
//
// AES-256-GCM, one random IV per document, key from
// TSM_DOC_ENCRYPTION_KEY (32 raw bytes, base64-encoded — e.g.
// `openssl rand -base64 32`). Fails closed: if the key isn't set or isn't
// exactly 32 bytes once decoded, uploads are rejected rather than
// silently falling back to storing plaintext.
const crypto = require('crypto');
const BPO_DOC_ENC_ALGO = 'aes-256-gcm';

function bpoDocEncryptionKey() {
  const raw = process.env.TSM_DOC_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TSM_DOC_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` ' +
      'and add it to .env / Fly secrets before uploading documents.'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TSM_DOC_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 of a 256-bit key).');
  }
  return key;
}

function bpoEncryptBuffer(plaintext) {
  const key = bpoDocEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV, GCM standard
  const cipher = crypto.createCipheriv(BPO_DOC_ENC_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv: iv.toString('base64'), authTag: authTag.toString('base64') };
}

function bpoDecryptBuffer(ciphertext, ivB64, authTagB64) {
  const key = bpoDocEncryptionKey();
  const decipher = crypto.createDecipheriv(BPO_DOC_ENC_ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function bpoDocMetaCollection() {
  const database = await getDb();
  return database.collection(BPO_DOC_META_COLLECTION);
}

async function bpoDocChunksCollection() {
  const database = await getDb();
  return database.collection(BPO_DOC_CHUNKS_COLLECTION);
}

function bpoGenerateDocId() {
  return 'doc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Truncates a UTF-8 byte buffer to at most maxBytes without splitting a
 * multi-byte character at the cut point. A naive buf.subarray(0, maxBytes)
 * can land inside a 2-4 byte UTF-8 sequence (e.g. mid-way through an emoji
 * or CJK character), which Buffer#toString('utf8') then silently renders
 * as a U+FFFD replacement character on read — not a crash, but a
 * corrupted-looking tail on stored text. Walks back at most 3 bytes to
 * find and drop an incomplete trailing sequence.
 */
function truncateUtf8Safe(buf, maxBytes) {
  if (buf.length <= maxBytes) return buf;
  let end = maxBytes;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = buf[end - back];
    if ((byte & 0xC0) === 0x80) continue; // continuation byte, keep walking back
    if ((byte & 0xC0) === 0xC0) {
      // lead byte of a multi-byte sequence — how many bytes does it need?
      const seqLen = (byte & 0xF8) === 0xF0 ? 4 : (byte & 0xF0) === 0xE0 ? 3 : 2;
      if (back < seqLen) end -= back; // sequence doesn't fully fit before maxBytes — drop it
      break;
    }
    break; // plain ASCII byte — cut point is already safe
  }
  return buf.subarray(0, end);
}

/**
 * Stores an uploaded file's buffer as ordered base64 chunk documents plus
 * one metadata document. Rejects anything over BPO_DOC_MAX_BYTES before
 * writing anything. Writes a bpo.document_upload audit entry on success.
 */
async function bpoStoreDocument({ caseId, clientId, filename, mimetype, buffer, extractedText, extractionError }, actor) {
  if (!caseId) throw new Error('caseId is required');
  // Zero-byte uploads are legitimate (e.g. a placeholder file a client
  // drops before the real one, or an intentionally empty attachment) —
  // stress-tested via scripts/stress-test/run-stress-test.js, which
  // flagged the old `!buffer.length` check as wrongly rejecting these
  // with a 400. Only a genuinely missing buffer (null/undefined, i.e.
  // multer never attached a file) is an error; an empty-but-present
  // Buffer is stored as a zero-length document with no extracted text.
  if (!buffer) throw new Error('file buffer is required');
  if (buffer.length > BPO_DOC_MAX_BYTES) {
    throw new Error(`file exceeds ${BPO_DOC_MAX_BYTES} byte limit`);
  }

  // Encrypt before chunking — chunks below hold ciphertext only, never
  // the original bytes. bpoDocEncryptionKey() throws (upload rejected)
  // if TSM_DOC_ENCRYPTION_KEY isn't configured, rather than silently
  // storing plaintext.
  const { ciphertext, iv, authTag } = bpoEncryptBuffer(buffer);

  const docId = bpoGenerateDocId();
  const chunksCol = await bpoDocChunksCollection();
  const chunkCount = Math.ceil(ciphertext.length / BPO_DOC_CHUNK_SIZE_BYTES) || 1;

  for (let i = 0; i < chunkCount; i++) {
    const start = i * BPO_DOC_CHUNK_SIZE_BYTES;
    const slice = ciphertext.subarray(start, start + BPO_DOC_CHUNK_SIZE_BYTES);
    // kind: 'file' explicitly tags these as raw-file chunks so they can
    // share BPO_DOC_CHUNKS_COLLECTION with the extracted-text chunks below
    // without index collisions. Pre-existing chunks written before this
    // field existed have no `kind` at all — bpoGetDocumentBuffer treats
    // "no kind" the same as kind:'file' for backward compatibility.
    await chunksCol.insertOne({ docId, index: i, data: slice.toString('base64'), kind: 'file' });
  }

  // Extracted text (docs/BPO_PRODUCTION_READINESS.md Phase 3, "Add metadata
  // extraction") gets the same at-rest encryption as the file bytes, its
  // own IV/authTag, and its own chunk set in the same collection tagged
  // kind:'text'. Best-effort and non-fatal: no text / an extraction error
  // never blocks storing the document itself.
  let hasExtractedText = false;
  let textChunkCount = 0;
  let textEncIv = null;
  let textEncAuthTag = null;
  let textTruncated = false;

  if (typeof extractedText === 'string' && extractedText.length > 0) {
    let textBuffer = Buffer.from(extractedText, 'utf8');
    if (textBuffer.length > BPO_DOC_TEXT_MAX_BYTES) {
      textBuffer = truncateUtf8Safe(textBuffer, BPO_DOC_TEXT_MAX_BYTES);
      textTruncated = true;
    }
    const textEnc = bpoEncryptBuffer(textBuffer);
    textEncIv = textEnc.iv;
    textEncAuthTag = textEnc.authTag;
    textChunkCount = Math.ceil(textEnc.ciphertext.length / BPO_DOC_CHUNK_SIZE_BYTES) || 1;
    for (let i = 0; i < textChunkCount; i++) {
      const start = i * BPO_DOC_CHUNK_SIZE_BYTES;
      const slice = textEnc.ciphertext.subarray(start, start + BPO_DOC_CHUNK_SIZE_BYTES);
      await chunksCol.insertOne({ docId, index: i, data: slice.toString('base64'), kind: 'text' });
    }
    hasExtractedText = true;
  }

  const metaCol = await bpoDocMetaCollection();
  const meta = {
    docId, caseId, clientId: clientId || null,
    filename: (filename || 'untitled').toString().slice(0, 255),
    mimetype: mimetype || 'application/octet-stream',
    sizeBytes: buffer.length, // original plaintext size, for display — not the (slightly larger) ciphertext size
    chunkCount,
    uploadedBy: actor || 'unknown',
    uploadedAt: new Date().toISOString(),
    deleted: false,
    encAlgo: BPO_DOC_ENC_ALGO,
    encIv: iv,
    encAuthTag: authTag,
    hasExtractedText,
    textChunkCount,
    textEncIv,
    textEncAuthTag,
    textTruncated,
    extractionError: extractionError || null,
  };
  await metaCol.insertOne(meta);

  await bpoWriteAudit({
    actor, action: 'document.upload', entityType: 'work_item', entityId: caseId,
    detail: { docId, filename: meta.filename, sizeBytes: meta.sizeBytes, hasExtractedText },
  });

  return meta;
}

/**
 * Lists non-deleted document metadata for a case (no file bytes — use
 * bpoGetDocumentBuffer for that). Newest first.
 */
async function bpoListDocuments({ caseId, limit = 100 } = {}) {
  const col = await bpoDocMetaCollection();
  const query = { deleted: { $ne: true } };
  if (caseId) query.caseId = caseId;
  return col.find(query).sort({ uploadedAt: -1 }).limit(limit).toArray();
}

async function bpoGetDocumentMeta(docId) {
  const col = await bpoDocMetaCollection();
  return col.findOne({ docId, deleted: { $ne: true } });
}

/**
 * Reassembles a stored document's full buffer from its ordered chunks.
 * Returns null if the doc doesn't exist or was soft-deleted. Writes a
 * bpo.document_download audit entry on every successful read, since a
 * document download is itself a sensitive access event worth logging
 * (same reasoning as gating audit-log reads to BPO_MANAGE_ROLES above).
 */
async function bpoGetDocumentBuffer(docId, actor) {
  const meta = await bpoGetDocumentMeta(docId);
  if (!meta) return null;

  const chunksCol = await bpoDocChunksCollection();
  // kind:'file' or missing kind (pre-dates the text-extraction feature,
  // see bpoStoreDocument) — must exclude kind:'text' chunks that may
  // share this docId in the same collection.
  const chunks = await chunksCol
    .find({ docId, $or: [{ kind: 'file' }, { kind: { $exists: false } }] })
    .sort({ index: 1 }).toArray();
  if (chunks.length !== meta.chunkCount) {
    throw new Error(`document ${docId} is missing chunks (expected ${meta.chunkCount}, found ${chunks.length})`);
  }
  const stored = Buffer.concat(chunks.map(c => Buffer.from(c.data, 'base64')));
  // encIv/encAuthTag only exist on documents uploaded after encryption at
  // rest was added — anything uploaded before that migrates on next
  // access would need a one-time re-encryption pass, not attempted here.
  // Older, unencrypted docs are returned as-is rather than failing.
  const buffer = (meta.encIv && meta.encAuthTag)
    ? bpoDecryptBuffer(stored, meta.encIv, meta.encAuthTag)
    : stored;

  await bpoWriteAudit({
    actor, action: 'document.download', entityType: 'work_item', entityId: meta.caseId,
    detail: { docId, filename: meta.filename },
  });

  return { meta, buffer };
}

/**
 * Returns a document's extracted text (see bpoStoreDocument), decrypted,
 * or null text if the doc had no supported/successful extraction. Returns
 * null overall (not just null text) if the doc doesn't exist or was
 * soft-deleted, same as bpoGetDocumentBuffer. Writes a lighter-weight
 * audit entry than a full binary download, since reading extracted text
 * is still an access to the document's content.
 */
async function bpoGetDocumentText(docId, actor) {
  const meta = await bpoGetDocumentMeta(docId);
  if (!meta) return null;

  if (!meta.hasExtractedText) {
    return { meta, text: null };
  }

  const chunksCol = await bpoDocChunksCollection();
  const chunks = await chunksCol
    .find({ docId, kind: 'text' })
    .sort({ index: 1 }).toArray();
  if (chunks.length !== meta.textChunkCount) {
    throw new Error(`document ${docId} is missing text chunks (expected ${meta.textChunkCount}, found ${chunks.length})`);
  }
  const stored = Buffer.concat(chunks.map(c => Buffer.from(c.data, 'base64')));
  const buffer = bpoDecryptBuffer(stored, meta.textEncIv, meta.textEncAuthTag);

  await bpoWriteAudit({
    actor, action: 'document.text_access', entityType: 'work_item', entityId: meta.caseId,
    detail: { docId, filename: meta.filename },
  });

  return { meta, text: buffer.toString('utf8') };
}

/**
 * Soft-deletes a document (flips deleted:true on the meta doc; chunk data
 * and the meta record itself are left intact for audit purposes, same
 * pattern as bpoSetClientStatus). Returns the updated meta, or null if
 * the doc didn't exist / was already deleted.
 */
async function bpoDeleteDocument(docId, actor) {
  const col = await bpoDocMetaCollection();
  const result = await col.findOneAndUpdate(
    { docId, deleted: { $ne: true } },
    { $set: { deleted: true, deletedAt: new Date().toISOString(), deletedBy: actor || 'unknown' } },
    { returnDocument: 'after' }
  );
  const updated = result && result.value ? result.value : null;
  if (updated) {
    await bpoWriteAudit({
      actor, action: 'document.delete', entityType: 'work_item', entityId: updated.caseId,
      detail: { docId, filename: updated.filename },
    });
  }
  return updated;
}

// =====================================================
// CONCIERGE TRANSPORT PERSISTENCE
// Same ledger-service-first, routes-second pattern as BPO above. Maps a
// server/services/concierge-transport-adapter.js booking to a durable
// mission record plus an append-only status timeline, replacing what the
// adapter otherwise only holds in-memory:
//
//   concierge_missions      — one doc per bookingId, upserted as a
//                              booking's status advances (mirrors
//                              BOOKING_STATUSES: confirmed -> ... ->
//                              completed/cancelled). Mirrors bpo_work_items.
//   concierge_status_events — append-only status-transition trail, one doc
//                              per transition, so history survives a
//                              mission doc being overwritten on the next
//                              upsert. Mirrors bpo_sla_events.
// =====================================================

const CONCIERGE_MISSIONS_COLLECTION = 'concierge_missions';
const CONCIERGE_STATUS_EVENTS_COLLECTION = 'concierge_status_events';

async function conciergeMissionsCollection() {
  const database = await getDb();
  return database.collection(CONCIERGE_MISSIONS_COLLECTION);
}

async function conciergeStatusEventsCollection() {
  const database = await getDb();
  return database.collection(CONCIERGE_STATUS_EVENTS_COLLECTION);
}

async function conciergeListMissions({ status, provider, propertyId, limit = 100 } = {}) {
  const col = await conciergeMissionsCollection();
  const query = {};
  if (status) query.status = status;
  if (provider) query.provider = provider;
  if (propertyId) query.propertyId = propertyId;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function conciergeGetMission(bookingId) {
  const col = await conciergeMissionsCollection();
  return col.findOne({ bookingId });
}

/**
 * Upserts a mission from a booking (as returned by the adapter's book(),
 * status(), or simulateEvent()). Same slaAgeHours-at-write-time approach
 * as bpoUpsertWorkItem, and same "optional fields are sticky" rule so a
 * later status-only update doesn't wipe guestName/propertyId set earlier.
 */
async function conciergeUpsertMission(bookingId, fields, actor) {
  if (!bookingId) throw new Error('bookingId required');
  const col = await conciergeMissionsCollection();
  const now = new Date().toISOString();
  const {
    provider = null, quoteId = null, status = 'confirmed', confirmationCode = null,
    request = null, driver = null, guestName, propertyId, vertical = 'concierge', note,
    priceEstimate,
  } = fields || {};

  const existing = await col.findOne({ bookingId });
  const createdAt = existing ? existing.createdAt : now;

  const $set = {
    bookingId, provider, quoteId, status, confirmationCode, request, driver, vertical,
    updatedAt: now,
    ageHoursAtUpdate: bpoHoursBetween(createdAt, now),
  };
  if (priceEstimate !== undefined) $set.priceEstimate = priceEstimate;
  else if (existing && existing.priceEstimate !== undefined) $set.priceEstimate = existing.priceEstimate;
  if (guestName !== undefined) $set.guestName = (guestName || '').toString().trim();
  else if (existing && existing.guestName !== undefined) $set.guestName = existing.guestName;
  if (propertyId !== undefined) $set.propertyId = propertyId || null;
  else if (existing && existing.propertyId !== undefined) $set.propertyId = existing.propertyId;

  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { bookingId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ bookingId });

  const previousStatus = existing ? existing.status : null;
  if (!existing || previousStatus !== status) {
    try {
      const evCol = await conciergeStatusEventsCollection();
      await evCol.insertOne({
        bookingId, provider, vertical,
        fromStatus: previousStatus,
        toStatus: status,
        note: note || undefined,
        actor,
        ts: now,
      });
    } catch (e) {
      console.warn('[conciergeUpsertMission] failed to write status event:', e.message);
    }
  }

  return doc;
}

async function conciergeListStatusEvents({ bookingId, limit = 200 } = {}) {
  const col = await conciergeStatusEventsCollection();
  const query = {};
  if (bookingId) query.bookingId = bookingId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// =====================================================
// PM COPILOT PERSISTENCE
// Standalone vertical -- not layered on BPO or Concierge/HotelOps.
// Mirrors the same ledger-service-first pattern as both: one collection
// per stage-tracked entity (work_order, lease, vendor_compliance) plus
// units as a reference collection (no stage lifecycle), and a single
// shared append-only status-event trail tagged by entityType so history
// survives each entity's own upsert-in-place doc being overwritten.
// See html/war-rooms/pm-copilot/services/pm-engine.js for the client-side
// mirror of this same entity shape.
// =====================================================

const PM_UNITS_COLLECTION = 'pm_units';
const PM_WORK_ORDERS_COLLECTION = 'pm_work_orders';
const PM_LEASES_COLLECTION = 'pm_leases';
const PM_VENDORS_COLLECTION = 'pm_vendors';
const PM_STATUS_EVENTS_COLLECTION = 'pm_status_events';

async function pmUnitsCollection() {
  const database = await getDb();
  return database.collection(PM_UNITS_COLLECTION);
}
async function pmWorkOrdersCollection() {
  const database = await getDb();
  return database.collection(PM_WORK_ORDERS_COLLECTION);
}
async function pmLeasesCollection() {
  const database = await getDb();
  return database.collection(PM_LEASES_COLLECTION);
}
async function pmVendorsCollection() {
  const database = await getDb();
  return database.collection(PM_VENDORS_COLLECTION);
}
async function pmStatusEventsCollection() {
  const database = await getDb();
  return database.collection(PM_STATUS_EVENTS_COLLECTION);
}

/**
 * Shared by pmUpsertWorkOrder/pmUpsertLease/pmUpsertVendor -- writes one
 * append-only status-event doc whenever an upsert changes `stage`
 * (or creates the record). entityType distinguishes the three kinds in
 * the shared pm_status_events collection.
 */
async function pmWriteStatusEvent({ entityType, entityId, fromStage, toStage, note, actor }) {
  try {
    const col = await pmStatusEventsCollection();
    await col.insertOne({
      entityType, entityId, fromStage, toStage,
      note: note || undefined, actor, ts: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[pmWriteStatusEvent] failed to write status event:', e.message);
  }
}

async function pmListStatusEvents({ entityType, entityId, limit = 200 } = {}) {
  const col = await pmStatusEventsCollection();
  const query = {};
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  return col.find(query).sort({ ts: -1 }).limit(limit).toArray();
}

// ── PM Intelligence V3 action status (lifecycle persistence) ───────────────
// Actions themselves are ephemeral -- rebuilt on every POST /api/pm/intelligence-v3
// from whatever decisions[] the caller sends. This collection is the only
// thing that survives a reload: it stores the current lifecycle status
// (OPEN/ACKNOWLEDGED/IN_PROGRESS/RESOLVED/VERIFIED) and verification result
// per action_id, keyed off action-engine.js's deterministic `ACT-<decisionId>`
// id scheme, so the same action always overlays the same persisted state.
const PM_ACTION_STATUS_COLLECTION = 'pm_action_status';

async function pmActionStatusCollection() {
  const database = await getDb();
  return database.collection(PM_ACTION_STATUS_COLLECTION);
}

async function pmGetActionStatus(actionId) {
  if (!actionId) return null;
  const col = await pmActionStatusCollection();
  return col.findOne({ action_id: actionId });
}

async function pmUpsertActionStatus(actionId, fields, actor) {
  if (!actionId) throw new Error('actionId required');
  const col = await pmActionStatusCollection();
  const now = new Date().toISOString();
  const { status, note, ...rest } = fields || {};

  const existing = await col.findOne({ action_id: actionId });
  const createdAt = existing ? existing.createdAt : now;
  const previousStatus = existing ? existing.status : null;

  const $set = {
    action_id: actionId, ...rest, status, updatedAt: now,
  };
  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { action_id: actionId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ action_id: actionId });

  if (!existing || previousStatus !== status) {
    await pmWriteStatusEvent({ entityType: 'pm_action', entityId: actionId, fromStage: previousStatus, toStage: status, note, actor });
  }
  return doc;
}

// ── Units (reference data, no stage lifecycle) ─────────────────────────────

async function pmListUnits({ propertyId, status } = {}) {
  const col = await pmUnitsCollection();
  const query = {};
  if (propertyId) query.property = propertyId;
  if (status) query.status = status;
  return col.find(query).sort({ unit_id: 1 }).toArray();
}

async function pmGetUnit(unitId) {
  const col = await pmUnitsCollection();
  return col.findOne({ unit_id: unitId });
}

async function pmUpsertUnit(unitId, fields, actor) {
  if (!unitId) throw new Error('unitId required');
  const col = await pmUnitsCollection();
  const now = new Date().toISOString();
  const existing = await col.findOne({ unit_id: unitId });
  const createdAt = existing ? existing.createdAt : now;

  const $set = { unit_id: unitId, ...fields, updatedAt: now };
  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { unit_id: unitId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  return col.findOne({ unit_id: unitId });
}

// ── Work orders ──────────────────────────────────────────────────────────

async function pmListWorkOrders({ unitId, stage, limit = 100 } = {}) {
  const col = await pmWorkOrdersCollection();
  const query = {};
  if (unitId) query.unit_id = unitId;
  if (stage) query.stage = stage;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function pmGetWorkOrder(workOrderId) {
  const col = await pmWorkOrdersCollection();
  return col.findOne({ work_order_id: workOrderId });
}

async function pmUpsertWorkOrder(workOrderId, fields, actor) {
  if (!workOrderId) throw new Error('workOrderId required');
  const col = await pmWorkOrdersCollection();
  const now = new Date().toISOString();
  const { stage = 'submitted', note, ...rest } = fields || {};

  const existing = await col.findOne({ work_order_id: workOrderId });
  const createdAt = existing ? existing.createdAt : now;
  const previousStage = existing ? existing.stage : null;

  const $set = {
    work_order_id: workOrderId, ...rest, stage, updatedAt: now,
    ageHoursAtUpdate: bpoHoursBetween(createdAt, now),
  };
  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { work_order_id: workOrderId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ work_order_id: workOrderId });

  if (!existing || previousStage !== stage) {
    await pmWriteStatusEvent({ entityType: 'work_order', entityId: workOrderId, fromStage: previousStage, toStage: stage, note, actor });
  }
  return doc;
}

// ── Leases ───────────────────────────────────────────────────────────────

async function pmListLeases({ unitId, stage, limit = 100 } = {}) {
  const col = await pmLeasesCollection();
  const query = {};
  if (unitId) query.unit_id = unitId;
  if (stage) query.stage = stage;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function pmGetLease(leaseId) {
  const col = await pmLeasesCollection();
  return col.findOne({ lease_id: leaseId });
}

async function pmUpsertLease(leaseId, fields, actor) {
  if (!leaseId) throw new Error('leaseId required');
  const col = await pmLeasesCollection();
  const now = new Date().toISOString();
  const { stage = 'active', note, ...rest } = fields || {};

  const existing = await col.findOne({ lease_id: leaseId });
  const createdAt = existing ? existing.createdAt : now;
  const previousStage = existing ? existing.stage : null;

  const $set = { lease_id: leaseId, ...rest, stage, updatedAt: now };
  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { lease_id: leaseId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ lease_id: leaseId });

  if (!existing || previousStage !== stage) {
    await pmWriteStatusEvent({ entityType: 'lease', entityId: leaseId, fromStage: previousStage, toStage: stage, note, actor });
  }
  return doc;
}

// ── Vendors (compliance status: insurance/license) ─────────────────────────

async function pmListVendors({ trade, stage, limit = 100 } = {}) {
  const col = await pmVendorsCollection();
  const query = {};
  if (trade) query.trade = trade;
  if (stage) query.stage = stage;
  return col.find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
}

async function pmGetVendor(vendorId) {
  const col = await pmVendorsCollection();
  return col.findOne({ vendor_id: vendorId });
}

async function pmUpsertVendor(vendorId, fields, actor) {
  if (!vendorId) throw new Error('vendorId required');
  const col = await pmVendorsCollection();
  const now = new Date().toISOString();
  const { stage = 'current', note, ...rest } = fields || {};

  const existing = await col.findOne({ vendor_id: vendorId });
  const createdAt = existing ? existing.createdAt : now;
  const previousStage = existing ? existing.stage : null;

  const $set = { vendor_id: vendorId, ...rest, stage, updatedAt: now };
  const $setOnInsert = existing ? undefined : { createdAt: now };

  await col.updateOne(
    { vendor_id: vendorId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  const doc = await col.findOne({ vendor_id: vendorId });

  if (!existing || previousStage !== stage) {
    await pmWriteStatusEvent({ entityType: 'vendor', entityId: vendorId, fromStage: previousStage, toStage: stage, note, actor });
  }
  return doc;
}

// =====================================================
// COLLECTIVE BNCA PERSISTENCE
// Mongo-backed replacement for the COLLECTIVE_SIGNALS / COLLECTIVE_BNCA
// in-memory arrays in server.js. Mirrors the bpo_notes / bpo_bnca_reports
// pattern exactly: append-only collections, newest-first, capped by
// limit on read rather than truncated on write, since Mongo has no
// realistic size pressure the way a plain JS array kept in process
// memory does (and this survives a dyno restart, which the array didn't).
//
//   collective_signals — one doc per war-room push (POST /api/collective/signal)
//   collective_bnca     — one doc per synthesis run (POST /api/collective/bnca)
// =====================================================

const COLLECTIVE_SIGNALS_COLLECTION = 'collective_signals';
const COLLECTIVE_BNCA_COLLECTION = 'collective_bnca';

async function collectiveSignalsCollection() {
  const database = await getDb();
  return database.collection(COLLECTIVE_SIGNALS_COLLECTION);
}

async function collectiveBncaCollection() {
  const database = await getDb();
  return database.collection(COLLECTIVE_BNCA_COLLECTION);
}

async function collectiveAddSignal(entry) {
  const col = await collectiveSignalsCollection();
  const doc = { ...entry, ts: new Date().toISOString() };
  await col.insertOne(doc);
  return doc;
}

// clientId undefined/null = admin rollup (no scoping). Pass a real
// clientId to scope to one client's signals, mirroring the role check
// server.js already does before calling this.
async function collectiveListSignals({ clientId, limit = 200 } = {}) {
  const col = await collectiveSignalsCollection();
  const query = {};
  if (clientId) query.clientId = clientId;
  return col.find(query).sort({ timestamp: -1 }).limit(limit).toArray();
}

async function collectiveDeleteSignals({ clientId } = {}) {
  const col = await collectiveSignalsCollection();
  const query = {};
  if (clientId) query.clientId = clientId;
  const result = await col.deleteMany(query);
  return result.deletedCount || 0;
}

async function collectiveAddBncaResult(result) {
  const col = await collectiveBncaCollection();
  const doc = { ...result, ts: new Date().toISOString() };
  await col.insertOne(doc);
  return doc;
}

// Newest synthesis first, optionally scoped to one clientId — same
// lookup server.js's GET /api/collective/bnca/latest needs (find the
// first doc matching clientId in a newest-first sort, or the very
// first doc for the admin rollup).
async function collectiveLatestBnca({ clientId } = {}) {
  const col = await collectiveBncaCollection();
  const query = {};
  if (clientId) query.clientId = clientId;
  return col.find(query).sort({ timestamp: -1 }).limit(1).next();
}

// ── Vertical node-report persistence (Mortgage/Construction/future) ────────
// Node reports were previously kept only in server.js's in-memory
// mortgageNodeReports/constructionNodeReports objects, which reset on every
// deploy/restart. That silently empties the Intelligence V3 decision queue
// with no error -- the panel just renders "no open decisions." This is a
// generic, vertical-keyed collection so any vertical's node-report route
// can persist through restarts without a new collection per vertical.
// Mirrors the pm_action_status get/upsert pattern above.
const VERTICAL_NODE_REPORTS_COLLECTION = 'vertical_node_reports';

async function verticalNodeReportsCollection() {
  const database = await getDb();
  return database.collection(VERTICAL_NODE_REPORTS_COLLECTION);
}

async function verticalGetNodeReport(vertical, nodeId) {
  if (!vertical || !nodeId) return null;
  const col = await verticalNodeReportsCollection();
  return col.findOne({ vertical, nodeId });
}

async function verticalListNodeReports(vertical) {
  if (!vertical) return [];
  const col = await verticalNodeReportsCollection();
  return col.find({ vertical }).sort({ ts: -1 }).toArray();
}

async function verticalUpsertNodeReport(vertical, nodeId, fields) {
  if (!vertical) throw new Error('vertical required');
  if (!nodeId) throw new Error('nodeId required');
  const col = await verticalNodeReportsCollection();
  const now = Date.now();

  const $set = { vertical, nodeId, ...fields, receivedAt: now };
  const existing = await col.findOne({ vertical, nodeId });
  const $setOnInsert = existing ? undefined : { firstReceivedAt: now };

  await col.updateOne(
    { vertical, nodeId },
    $setOnInsert ? { $set, $setOnInsert } : { $set },
    { upsert: true }
  );
  return col.findOne({ vertical, nodeId });
}

async function verticalDeleteNodeReport(vertical, nodeId) {
  if (!vertical) throw new Error('vertical required');
  const col = await verticalNodeReportsCollection();
  if (nodeId) {
    await col.deleteOne({ vertical, nodeId });
    return { vertical, nodeId };
  }
  await col.deleteMany({ vertical });
  return { vertical, nodeId: 'all' };
}

module.exports = {
  connect,
  getDb,
  getLedgerCollection,
  writeEntry,
  readRecentEntries,
  close,
  // property accounting
  paEnsureMission,
  paGetMission,
  paUpdateBudget,
  paAdjustActual,
  paListGlEntries,
  paPostGlEntry,
  paListApInvoices,
  paEnsureApInvoices,
  paSetApInvoiceStatus,
  paResetMission,
  // HITL gate persistence
  hitlWriteDecision,
  hitlReadDecisions,
  hitlAdapter,
  // BPO operational persistence
  bpoListClients,
  bpoGetClient,
  bpoCreateClient,
  bpoUpdateClient,
  BPO_PRICING_TIERS,
  bpoSetClientStatus,
  bpoBackfillClientLogin,
  bpoListWorkItems,
  bpoGetWorkItem,
  bpoUpsertWorkItem,
  bpoListAuditLogs,
  bpoWriteAudit,
  // Case Engine (Roadmap #10)
  bpoListCases,
  bpoGetCase,
  bpoUpsertCase,
  // SMB Member layer
  memberList,
  memberGet,
  memberCreate,
  memberCaseSummary,
  // Batch intake layer
  batchCreate,
  batchGet,
  batchList,
  batchRecordDocument,
  batchSummary,
  // BPO Phase 2 (rest of): notes / SLA events / BNCA reports
  bpoAddNote,
  bpoListNotes,
  bpoListSlaEvents,
  bpoSaveBncaReport,
  bpoListBncaReports,
  bpoBuildClientRollup,
  bpoBuildMemberClientRollup,
  bpoSaveClientMonthlyReport,
  bpoListClientMonthlyReports,
  bpoGetClientMonthlyReport,
  // BPO Phase 3: document storage
  bpoStoreDocument,
  bpoListDocuments,
  bpoGetDocumentMeta,
  bpoGetDocumentBuffer,
  bpoGetDocumentText,
  truncateUtf8Safe, // exported for testing only — internal helper, not part of the public ledger API
  bpoDeleteDocument,
  // Concierge transport persistence
  conciergeListMissions,
  conciergeGetMission,
  conciergeUpsertMission,
  conciergeListStatusEvents,
  // PM Copilot persistence
  pmListUnits,
  pmGetUnit,
  pmUpsertUnit,
  pmListWorkOrders,
  pmGetWorkOrder,
  pmUpsertWorkOrder,
  pmListLeases,
  pmGetLease,
  pmUpsertLease,
  pmListVendors,
  pmGetVendor,
  pmUpsertVendor,
  pmListStatusEvents,
  pmGetActionStatus,
  pmUpsertActionStatus,
  // Vertical node-report persistence
  verticalGetNodeReport,
  verticalListNodeReports,
  verticalUpsertNodeReport,
  verticalDeleteNodeReport,
  // Collective BNCA persistence
  collectiveAddSignal,
  collectiveListSignals,
  collectiveDeleteSignals,
  collectiveAddBncaResult,
  collectiveLatestBnca,
};
