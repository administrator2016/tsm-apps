// =====================================================
// INTERVIEW ENGINE SERVICE
// Sector/role → competency mapping → question selection → interview
// session lifecycle. This is the engine described as "Phase 2" of the
// Interview Intelligence proposal: it reads sector/role/competency/
// question definitions from a JSON registry (see loadRegistry() below)
// rather than having any of that hardcoded here, so a new sector is a
// new set of registry files, not a code change.
//
// STATUS: engine scaffolding only. The registry directory
// (/interview-intelligence/*.json) doesn't exist yet — that's Phase 1,
// built one sector at a time (mortgage first). Until those files exist,
// loadRegistry() returns empty collections and every lookup function
// returns null/[] rather than throwing, so this file is safe to land
// and unit-test ahead of the data.
//
// Scoring: this service does NOT fabricate competency scores. Grading a
// free-text interview answer requires an LLM call, and the LLM proxy
// (groqChat) lives in routes/training-intelligence.js, not here — so
// recordAnswer() takes a `grade` function as a parameter (dependency
// injection) rather than importing groqChat directly. Call it without a
// grade function and you get an honest "not scored yet" response object
// instead of an invented number. Same honesty pattern as
// server/staffing-engine-service.js's computeFee() — a value is either
// computed from something real, or explicitly reported as absent.
//
// Uses the same MongoClient connection pattern as
// server/candidate-registry-service.js and server/staffing-engine-service.js.
// Connection string comes from MONGODB_URI in .env. Only interview
// SESSIONS live in Mongo — sector/role/competency/question definitions
// are static JSON, not database records.
// =====================================================

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const DEFAULT_DB_NAME = 'tsm-consultz';
const SESSIONS_COLLECTION = 'interview_sessions';

const REGISTRY_DIR = path.join(__dirname, '..', 'interview-intelligence');
// Each sector's roles/competencies/scenarios/evidenceSources live nested
// inside its own entry in sectors.json (matches the config shape from the
// original proposal) rather than as separate normalized files — simpler
// for a handful of sectors, and there's nothing here yet that needs
// cross-sector lookups. Split these out into their own files later only
// if that stops being true.
const REGISTRY_FILES = {
  sectors: 'sectors.json',
  questions: 'questions.json',
};

let client = null;
let db = null;
let connecting = null;

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
      return db;
    } finally {
      connecting = null;
    }
  })();

  db = await connecting;
  return db;
}

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------
// Registry loading — static JSON, cached in memory per process.
// Call reloadRegistry() (e.g. from an admin endpoint) to pick up
// edited registry files without a restart.
// ---------------------------------------------------------------

let _registryCache = null;

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${err.message}`);
  }
}

/**
 * Loads sectors/roles/competencies/scenarios/questions from
 * /interview-intelligence/*.json. Missing files are treated as "not
 * built yet" (empty object/array), not an error — this lets the engine
 * ship ahead of the data and pick up each sector as its registry file
 * is added.
 */
function loadRegistry() {
  if (_registryCache) return _registryCache;

  const sectors = readJsonSafe(path.join(REGISTRY_DIR, REGISTRY_FILES.sectors)) || {};
  const questions = readJsonSafe(path.join(REGISTRY_DIR, REGISTRY_FILES.questions)) || [];

  _registryCache = { sectors, questions };
  return _registryCache;
}

function reloadRegistry() {
  _registryCache = null;
  return loadRegistry();
}

// ---------------------------------------------------------------
// Sector / role selection
// ---------------------------------------------------------------

function listSectors() {
  const { sectors } = loadRegistry();
  return Object.keys(sectors).map((id) => ({ id, name: sectors[id].name || id }));
}

function getSector(sectorId) {
  const { sectors } = loadRegistry();
  return sectors[sectorId] || null;
}

/**
 * Resolves a target role for a sector. Explicit roleId wins if it's
 * valid for the sector. Otherwise falls back to the sector's first
 * defined role. Real multi-signal inference (certification selected +
 * active tools + user's TSM project history, per the proposal) is not
 * built yet — that's a later pass once there's real signal data to
 * infer from, not something worth guessing at with no input.
 */
function selectRole(sectorId, { roleId } = {}) {
  const sector = getSector(sectorId);
  if (!sector || !Array.isArray(sector.roles) || sector.roles.length === 0) return null;

  if (roleId) {
    const match = sector.roles.find((r) => (typeof r === 'string' ? r === roleId : r.id === roleId));
    if (match) return match;
  }
  return sector.roles[0];
}

// ---------------------------------------------------------------
// Question selection
// ---------------------------------------------------------------

/**
 * Filters the question bank down to a pool matching sector (required)
 * and, if given, role/competency/difficulty/type. Returns [] rather
 * than throwing if the registry has no questions loaded yet.
 */
function buildQuestionPool(sectorId, { roleId, competency, difficulty, type } = {}) {
  const { questions } = loadRegistry();
  return questions.filter((q) => {
    if (q.sector !== sectorId) return false;
    if (roleId && q.role && q.role !== roleId) return false;
    if (competency && q.competency !== competency) return false;
    if (difficulty && q.difficulty !== difficulty) return false;
    if (type && q.type !== type) return false;
    return true;
  });
}

/**
 * Builds an ordered interview plan for a sector, following the
 * three-level structure from the proposal: knowledge -> scenario ->
 * business/executive. Picks up to `perLevel` questions per level. If a
 * level has no matching questions yet (registry incomplete), it's
 * simply skipped rather than padded with placeholders.
 */
function buildInterviewPlan(sectorId, { roleId, perLevel = 2 } = {}) {
  const sector = getSector(sectorId);
  if (!sector) return null;

  const role = selectRole(sectorId, { roleId });
  const levels = ['knowledge', 'scenario', 'business'];
  const plan = [];

  for (const level of levels) {
    const pool = buildQuestionPool(sectorId, { roleId: role && role.id, type: level });
    plan.push(...pool.slice(0, perLevel));
  }

  return {
    sectorId,
    sectorName: sector.name || sectorId,
    role,
    competencies: sector.competencies || [],
    evidenceSources: sector.evidenceSources || [],
    questions: plan,
  };
}

// ---------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------

/**
 * Creates and persists a new interview session for a candidate. Stores
 * the resolved plan on the session so a session always replays with the
 * exact questions it started with, even if the registry changes later.
 */
async function createSession({ candidateId, sectorId, roleId }) {
  if (!candidateId) throw new Error('candidateId is required');
  const plan = buildInterviewPlan(sectorId, { roleId });
  if (!plan) throw new Error(`No sector found for sectorId ${sectorId}`);
  if (plan.questions.length === 0) {
    throw new Error(
      `No questions available yet for sector "${sectorId}" — registry may not be built for this sector.`
    );
  }

  const database = await connect();
  const session = {
    sessionId: genId('ivw'),
    candidateId,
    sectorId,
    sectorName: plan.sectorName,
    role: plan.role,
    competencies: plan.competencies,
    questions: plan.questions,
    responses: [],
    currentIndex: 0,
    status: 'in_progress',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await database.collection(SESSIONS_COLLECTION).insertOne(session);
  return session;
}

async function getSession(sessionId) {
  const database = await connect();
  return database.collection(SESSIONS_COLLECTION).findOne({ sessionId });
}

async function listSessions({ candidateId, sectorId, status } = {}) {
  const database = await connect();
  const query = {};
  if (candidateId) query.candidateId = candidateId;
  if (sectorId) query.sectorId = sectorId;
  if (status) query.status = status;
  return database
    .collection(SESSIONS_COLLECTION)
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
}

/**
 * Records an answer to the session's current question and advances to
 * the next one. If a `grade` function is provided — async (question,
 * answerText) => { scores: {...}, notes: [...] } — the answer is scored
 * and the score is stored on the response. Without one, the response is
 * stored with `scored: false` rather than a fabricated score. This is
 * the seam routes/interview-engine.js will use to plug in the actual
 * groqChat-backed grader once that's built (Phase 4).
 */
async function recordAnswer(sessionId, { questionId, answerText, grade } = {}) {
  const session = await getSession(sessionId);
  if (!session) throw new Error(`No session found for sessionId ${sessionId}`);
  if (session.status !== 'in_progress') {
    throw new Error(`Session ${sessionId} is not in progress (status: ${session.status})`);
  }

  const question = session.questions.find((q) => q.id === questionId);
  if (!question) throw new Error(`Question ${questionId} is not part of session ${sessionId}`);

  let scoreResult = { scored: false, reason: 'no grader supplied' };
  if (typeof grade === 'function') {
    try {
      const graded = await grade(question, answerText);
      scoreResult = { scored: true, ...graded };
    } catch (err) {
      scoreResult = { scored: false, reason: `grading failed: ${err.message}` };
    }
  }

  const response = {
    questionId,
    answerText,
    ...scoreResult,
    answeredAt: new Date(),
  };

  const nextIndex = session.currentIndex + 1;
  const isComplete = nextIndex >= session.questions.length;

  const database = await connect();
  await database.collection(SESSIONS_COLLECTION).updateOne(
    { sessionId },
    {
      $push: { responses: response },
      $set: {
        currentIndex: nextIndex,
        status: isComplete ? 'completed' : 'in_progress',
        updatedAt: new Date(),
      },
    }
  );

  return getSession(sessionId);
}

/**
 * Averages scored competencies across a session's responses. Returns
 * null (not zero) if nothing has been scored yet — a session with no
 * scored answers has no readiness number to report, same "absent
 * rather than fabricated" rule as everywhere else in this file.
 */
function computeReadiness(session) {
  const scored = (session.responses || []).filter((r) => r.scored && r.scores);
  if (scored.length === 0) return null;

  const totals = {};
  const counts = {};
  for (const r of scored) {
    for (const [competency, value] of Object.entries(r.scores)) {
      if (typeof value !== 'number') continue;
      totals[competency] = (totals[competency] || 0) + value;
      counts[competency] = (counts[competency] || 0) + 1;
    }
  }

  const byCompetency = {};
  for (const competency of Object.keys(totals)) {
    byCompetency[competency] = Math.round((totals[competency] / counts[competency]) * 10) / 10;
  }

  const overallValues = Object.values(byCompetency);
  const overall = overallValues.length
    ? Math.round((overallValues.reduce((a, b) => a + b, 0) / overallValues.length) * 10) / 10
    : null;

  return { overall, byCompetency, basis: `${scored.length} scored response(s)` };
}

/**
 * Identifies weakest/strongest competencies from a session's scores.
 * Returns null if there's nothing scored yet, same rule as
 * computeReadiness — no gap can be "detected" from zero data.
 */
function detectGaps(session, { threshold = 75 } = {}) {
  const readiness = computeReadiness(session);
  if (!readiness) return null;

  const entries = Object.entries(readiness.byCompetency).sort((a, b) => a[1] - b[1]);
  return {
    weakest: entries.filter(([, score]) => score < threshold).map(([competency, score]) => ({ competency, score })),
    strongest: entries.filter(([, score]) => score >= threshold).map(([competency, score]) => ({ competency, score })),
    threshold,
  };
}

async function deleteSession(sessionId) {
  const database = await connect();
  const result = await database.collection(SESSIONS_COLLECTION).deleteOne({ sessionId });
  return result.deletedCount > 0;
}

module.exports = {
  loadRegistry,
  reloadRegistry,
  listSectors,
  getSector,
  selectRole,
  buildQuestionPool,
  buildInterviewPlan,
  createSession,
  getSession,
  listSessions,
  recordAnswer,
  computeReadiness,
  detectGaps,
  deleteSession,
};
