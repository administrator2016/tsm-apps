// Functional harness for routes/interview-engine.js + server/interview-engine-service.js.
// Mounts the REAL, unmodified route file on a local Express server, backed
// by a fake in-memory Mongo (same technique as scripts/test-staffing-engine.js,
// extended here with $push support since recordAnswer() needs it). Then
// drives it with real HTTP requests, the same way the browser/UI would.
//
// Run from repo root: node scripts/test-interview-engine.js

const Module = require('module');
const path = require('path');
const http = require('http');
const express = require('express');

// ---- fake in-memory Mongo (adds $push to the pattern from test-staffing-engine.js) ----
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
    const pushFields = (update && update.$push) || {};
    if (existing) {
      Object.assign(existing, setFields);
      for (const [field, value] of Object.entries(pushFields)) {
        if (!Array.isArray(existing[field])) existing[field] = [];
        existing[field].push(value);
      }
      return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    }
    if (opts && opts.upsert) {
      const doc = { ...query, ...setFields };
      for (const [field, value] of Object.entries(pushFields)) {
        doc[field] = [value];
      }
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

// ---- mount the REAL route file on a throwaway local server ----
const app = express();
app.use(express.json());
app.use(require(path.join(__dirname, '..', 'routes', 'interview-engine.js')));

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

async function api(base, method, urlPath, body) {
  const res = await fetch(base + urlPath, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  return { status: res.status, data };
}

async function main() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`Local test server: ${base}\n`);

  try {
    // 1. Registry reload + sector listing
    let r = await api(base, 'POST', '/api/interview/registry/reload');
    check('registry reload returns mortgage sector', r.data.sectors.includes('mortgage'));
    check('registry reload reports 42 questions across 6 sectors', r.data.questionCount === 42);

    r = await api(base, 'GET', '/api/interview/sectors');
    check('GET /sectors lists mortgage', r.data.sectors.some((s) => s.id === 'mortgage'));

    // 2. Unknown sector 404s cleanly
    r = await api(base, 'GET', '/api/interview/sectors/nonexistent');
    check('unknown sector 404s', r.status === 404);

    // 3. Plan preview
    r = await api(base, 'GET', '/api/interview/sectors/mortgage/plan?roleId=ops-analyst');
    check('plan preview returns 6 questions', r.data.plan.questions.length === 6);
    check('plan preview resolves role', r.data.plan.role.id === 'ops-analyst');

    // 4. Missing required fields on session create
    r = await api(base, 'POST', '/api/interview/sessions', { sectorId: 'mortgage' });
    check('create session without candidateId -> 400', r.status === 400);

    // 5. Create a real session
    r = await api(base, 'POST', '/api/interview/sessions', {
      candidateId: 'cand_test123',
      sectorId: 'mortgage',
      roleId: 'ops-analyst',
    });
    check('session created', r.status === 201 && /^ivw_/.test(r.data.session.sessionId));
    check('session starts in_progress', r.data.session.status === 'in_progress');
    const sessionId = r.data.session.sessionId;
    const questionIds = r.data.session.questions.map((q) => q.id);
    check('session carries all 6 questions', questionIds.length === 6);

    // 6. Session creation against a sector with no questions fails cleanly
    r = await api(base, 'POST', '/api/interview/sessions', {
      candidateId: 'cand_test123',
      sectorId: 'nonexistent',
    });
    check('create session on unknown sector -> 400 with clear error', r.status === 400 && /No sector found/.test(r.data.error));

    // 7. Answer all 6 questions, in order, and watch it complete
    let lastSession;
    for (const questionId of questionIds) {
      r = await api(base, 'POST', `/api/interview/sessions/${sessionId}/answers`, {
        questionId,
        answerText: `Sample answer for ${questionId}.`,
      });
      lastSession = r.data.session;
    }
    check('session auto-completes after last question', lastSession.status === 'completed');
    check('all 6 responses recorded', lastSession.responses.length === 6);
    check('responses are honestly unscored (no grader wired yet)', lastSession.responses.every((resp) => resp.scored === false));

    // 8. Readiness/gaps report null (not a fabricated number) since nothing's scored
    r = await api(base, 'GET', `/api/interview/sessions/${sessionId}/readiness`);
    check('readiness is null, not a fake number', r.data.readiness === null);

    r = await api(base, 'GET', `/api/interview/sessions/${sessionId}/gaps`);
    check('gaps is null, not fabricated', r.data.gaps === null);

    // 9. Answering a question not in the session is rejected
    r = await api(base, 'POST', `/api/interview/sessions/${sessionId}/answers`, {
      questionId: 'not-a-real-question',
      answerText: 'x',
    });
    check('answering after completion / unknown question -> 400', r.status === 400);

    // 10. List + fetch + cleanup
    r = await api(base, 'GET', `/api/interview/sessions?candidateId=cand_test123`);
    check('listSessions finds the session', r.data.sessions.some((s) => s.sessionId === sessionId));

    r = await api(base, 'DELETE', `/api/interview/sessions/${sessionId}`);
    check('session deleted', r.status === 204);

    r = await api(base, 'GET', `/api/interview/sessions/${sessionId}`);
    check('deleted session 404s', r.status === 404);
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest run stopped early:', err.stack || err.message);
  process.exit(1);
});