// =====================================================
// CANDIDATE REGISTRY SERVICE
// Single source of truth for candidate records, shared by:
//   - Career Training Platform (html/tsm-career-training-platform.html)
//   - Staffing Readiness Assessment (html/tsm-candidate-readiness-v2.html)
//
// Uses the same MongoClient connection pattern as
// server/tsm-ledger-service.js. Connection string comes from
// MONGODB_URI in .env, e.g.:
//   mongodb://<user>:<pass>@<host>:443/tsm-consultz
//     ?loadBalanced=true&tls=true&authMechanism=SCRAM-SHA-256&retryWrites=false
//
// NOTE: retryWrites=false is required if pointed at Firestore's
// Mongo-compatibility layer (see tsm-ledger-service.js header).
// =====================================================

const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');

const DEFAULT_DB_NAME = 'tsm-consultz';
const CANDIDATES_COLLECTION = 'candidates';
const TRAINING_EVENTS_COLLECTION = 'candidate_training_events';

let client = null;
let db = null;
let connecting = null;

/**
 * Lazily connects and caches a single MongoClient for the process.
 * Safe to call from multiple places concurrently.
 */
async function connect() {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env — see server/tsm-ledger-service.js header for format.'
    );
  }

  connecting = (async () => {
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 15000,
        retryWrites: false,
      });
      await client.connect();
      db = client.db(process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME);

      const col = db.collection(CANDIDATES_COLLECTION);
      await col.createIndex({ candidateId: 1 }, { unique: true });
      await col.createIndex({ status: 1 });
      await col.createIndex({ updatedAt: -1 });

      return db;
    } finally {
      connecting = null;
    }
  })();

  db = await connecting;
  return db;
}

function genCandidateId() {
  return 'cand_' + crypto.randomBytes(6).toString('hex');
}

/**
 * Computes a readiness score from actual recorded training-event data
 * instead of a typed-in number. This is intentionally simple and
 * transparent so it can be explained in a client meeting; swap the
 * weighting below once real assessment/training data sources are wired in.
 *
 * events: array of { type: 'module_complete'|'quiz'|'mock_shift', score?: number, weight?: number }
 */
function computeReadinessScore(events = []) {
  if (!events.length) return { score: 0, breakdown: [], basis: 'no-training-data' };

  let totalWeight = 0;
  let weightedSum = 0;
  const breakdown = [];

  for (const ev of events) {
    const weight = typeof ev.weight === 'number' ? ev.weight : 1;
    const score = typeof ev.score === 'number' ? ev.score : 0;
    totalWeight += weight;
    weightedSum += score * weight;
    breakdown.push({ type: ev.type, score, weight });
  }

  const raw = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return {
    score: Math.round(raw * 10) / 10,
    breakdown,
    basis: 'weighted-average-of-training-events',
  };
}

async function listCandidates({ status } = {}) {
  const database = await connect();
  const query = status ? { status } : {};
  return database
    .collection(CANDIDATES_COLLECTION)
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
}

async function getCandidate(candidateId) {
  const database = await connect();
  return database.collection(CANDIDATES_COLLECTION).findOne({ candidateId });
}

async function upsertCandidate(payload) {
  const database = await connect();
  const now = new Date().toISOString();
  const candidateId = payload.candidateId || genCandidateId();

  const events = await database
    .collection(TRAINING_EVENTS_COLLECTION)
    .find({ candidateId })
    .toArray();
  const readiness = computeReadinessScore(events);

  const doc = {
    candidateId,
    name: payload.name,
    role: payload.role || null,
    email: payload.email || null,
    status: payload.status || 'in_training',
    source: payload.source || 'career_training_platform',
    isSampleData: payload.isSampleData !== undefined ? payload.isSampleData : true,
    readinessScore: readiness.score,
    readinessBasis: readiness.basis,
    updatedAt: now,
    createdAt: payload.createdAt || now,
  };

  await database
    .collection(CANDIDATES_COLLECTION)
    .updateOne({ candidateId }, { $set: doc }, { upsert: true });

  return getCandidate(candidateId);
}

async function recordTrainingEvent(candidateId, event) {
  const database = await connect();
  const doc = {
    candidateId,
    type: event.type,
    score: event.score,
    weight: event.weight || 1,
    recordedAt: new Date().toISOString(),
    meta: event.meta || {},
  };
  await database.collection(TRAINING_EVENTS_COLLECTION).insertOne(doc);

  // Recompute and persist the candidate's readiness score off real data.
  const events = await database
    .collection(TRAINING_EVENTS_COLLECTION)
    .find({ candidateId })
    .toArray();
  const readiness = computeReadinessScore(events);

  await database.collection(CANDIDATES_COLLECTION).updateOne(
    { candidateId },
    {
      $set: {
        readinessScore: readiness.score,
        readinessBasis: readiness.basis,
        updatedAt: new Date().toISOString(),
      },
    }
  );

  return getCandidate(candidateId);
}

async function deleteCandidate(candidateId) {
  const database = await connect();
  await database.collection(TRAINING_EVENTS_COLLECTION).deleteMany({ candidateId });
  const result = await database
    .collection(CANDIDATES_COLLECTION)
    .deleteOne({ candidateId });
  return result.deletedCount > 0;
}

/**
 * Seeds realistic, clearly-labeled placeholder candidates + training events
 * so both apps have something to render before a real intake pipeline is
 * wired in. Safe to call repeatedly — it upserts, not duplicates.
 */
async function seedSampleData() {
  const samples = [
    {
      name: 'J. Alvarez',
      role: 'Medical Billing Specialist',
      status: 'in_training',
      events: [
        { type: 'module_complete', score: 88, weight: 1 },
        { type: 'quiz', score: 74, weight: 1 },
        { type: 'mock_shift', score: 81, weight: 2 },
      ],
    },
    {
      name: 'M. Chen',
      role: 'Loan Processing Associate',
      status: 'ready_for_placement',
      events: [
        { type: 'module_complete', score: 95, weight: 1 },
        { type: 'quiz', score: 91, weight: 1 },
        { type: 'mock_shift', score: 93, weight: 2 },
      ],
    },
    {
      name: 'R. Okafor',
      role: 'Construction Admin Coordinator',
      status: 'in_training',
      events: [
        { type: 'module_complete', score: 70, weight: 1 },
        { type: 'quiz', score: 65, weight: 1 },
      ],
    },
    {
      name: 'S. Patel',
      role: 'Front Desk / Hotel Ops',
      status: 'needs_review',
      events: [
        { type: 'module_complete', score: 60, weight: 1 },
        { type: 'quiz', score: 55, weight: 1 },
        { type: 'mock_shift', score: 58, weight: 2 },
      ],
    },
  ];

  const database = await connect();
  const results = [];
  for (const s of samples) {
    const candidate = await upsertCandidate({
      name: s.name,
      role: s.role,
      status: s.status,
      isSampleData: true,
      source: 'seed_script',
    });
    for (const ev of s.events) {
      await recordTrainingEvent(candidate.candidateId, ev);
    }
    results.push(await getCandidate(candidate.candidateId));
  }
  return results;
}

module.exports = {
  connect,
  listCandidates,
  getCandidate,
  upsertCandidate,
  recordTrainingEvent,
  deleteCandidate,
  seedSampleData,
  computeReadinessScore,
};
