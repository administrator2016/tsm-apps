// Runtime test of the mortgage Interview Prep UI wiring, extracted
// straight from html/tsm-career-training-platform.html (not retyped) and
// run against the REAL routes/interview-engine.js on a local server, same
// fake-Mongo harness as scripts/test-interview-engine.js.
//
// Uses a minimal document stub (not a full DOM) — just enough for
// getElementById/innerHTML/style/createElement to behave the way the
// extracted code expects. Not a substitute for opening it in an actual
// browser, but confirms the fetch calls, response shapes, and rendering
// logic all actually work end to end rather than just parsing.
//
// Run from repo root: node scripts/test-interview-prep-ui.js

const Module = require('module');
const path = require('path');
const http = require('http');
const express = require('express');
const fs = require('fs');

// ---- fake in-memory Mongo (same as scripts/test-interview-engine.js) ----
function matches(doc, query) {
  return Object.keys(query || {}).every((k) => doc[k] === query[k]);
}
class FakeCollection {
  constructor() { this.docs = []; }
  async insertOne(doc) { this.docs.push(doc); return { insertedId: doc.id || String(this.docs.length) }; }
  async findOne(query) { return this.docs.find((d) => matches(d, query)) || null; }
  find(query) {
    const results = this.docs.filter((d) => matches(d, query));
    return {
      _results: results,
      sort() { return this; },
      limit(n) { this._results = this._results.slice(0, n); return this; },
      async toArray() { return this._results; },
    };
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
      return { matchedCount: 1, modifiedCount: 1 };
    }
    if (opts && opts.upsert) {
      this.docs.push({ ...query, ...setFields });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    return { matchedCount: 0, modifiedCount: 0 };
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
require.cache['__fake_mongodb__'] = { id: '__fake_mongodb__', filename: '__fake_mongodb__', loaded: true, exports: { MongoClient: FakeMongoClient } };
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'mongodb') return '__fake_mongodb__';
  return originalResolveFilename.call(this, request, ...rest);
};
process.env.MONGODB_URI = 'mongodb://fake-for-test/tsm-consultz';

// ---- real server, real route file ----
const app = express();
app.use(express.json());
app.use(require(path.join(__dirname, '..', 'routes', 'interview-engine.js')));

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

// ---- minimal DOM stub, just enough for the extracted UI code ----
function makeElement() {
  return {
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
    style: {},
    textContent: '',
    setAttribute() {},
  };
}

async function main() {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Point the extracted code's bare fetch('/api/...') calls at our local
  // server, same as the browser would against a same-origin path.
  const realFetch = global.fetch;
  global.fetch = (url, opts) => realFetch(base + url, opts);

  const elements = {
    mortgageInterviewIntel: makeElement(),
    mortgageInterviewSessionStatus: makeElement(),
    crossTrackCandidate: makeElement(),
    crossTrackSap: makeElement(),
    crossTrackHealthcare: makeElement(),
    crossTrackAutomation: makeElement(),
    crossTrackFinops: makeElement(),
  };
  global.document = {
    getElementById: (id) => ({
      'cross-track-candidate': elements.crossTrackCandidate,
      'cross-track-sap': elements.crossTrackSap,
      'cross-track-healthcare': elements.crossTrackHealthcare,
      'cross-track-automation': elements.crossTrackAutomation,
      'cross-track-finops': elements.crossTrackFinops,
    }[id] || elements[id] || null),
    addEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => {
      // Mimics the browser's textContent->innerHTML escaping trick that
      // the real escapeHtml() relies on.
      const el = {};
      Object.defineProperty(el, 'textContent', {
        set(v) {
          el._innerHTML = String(v)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        },
      });
      Object.defineProperty(el, 'innerHTML', { get() { return el._innerHTML; } });
      return el;
    },
  };
  global.console.warn = console.warn; // keep as-is, just confirming it exists

  // Pull the actual <script> block containing the new UI functions
  // straight out of the real HTML file — not a retyped copy, so this
  // test breaks if the real code breaks.
  const htmlPath = path.join(__dirname, '..', 'html', 'tsm-career-training-platform.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptBlocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const realCode = scriptBlocks.find((s) => s.includes('handleMortgageInterviewPrepToggle'));
  if (!realCode) {
    throw new Error('Could not find the mortgage Interview Prep UI functions in tsm-career-training-platform.html');
  }
  const vm = require('vm');
  const context = {
    document: global.document,
    fetch: global.fetch,
    console,
    window: {
      scrollTo: () => {},
      _candidateRegistryById: {
        cand_test_interview_001: {
          candidateId: 'cand_test_interview_001',
          name: 'Test Interview Candidate',
          readinessEvidence: {
            track: 'Medical Billing / Healthcare Admin',
            strengths: ['Medical Billing'],
            operational: {
              l1: {
                resolution: {
                  category: 'Software/Access',
                  status: 'resolved'
                }
              }
            }
          }
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(realCode, context);

  try {
    // Select a canonical candidate exactly as the Career Command Center
    // registry row does. The UI must resolve the candidate by ID rather
    // than embedding a whole candidate object or using a demo identity.
    context.selectCareerCandidate('cand_test_interview_001');
    check('candidate selection resolves through Candidate Registry lookup', context.window._selectedCandidateId === 'cand_test_interview_001');
    check('selected candidate name comes from the registry snapshot', context.window._selectedCandidateName === 'Test Interview Candidate');
    check('cross-track profile resolves the selected candidate', elements.crossTrackCandidate.textContent === 'Test Interview Candidate');
    check('healthcare profile uses explicit registry track evidence', elements.crossTrackHealthcare.innerHTML.includes('Medical Billing / Healthcare Admin'));
    check('automation profile accepts structured L1 operational evidence', elements.crossTrackAutomation.innerHTML.includes('L1 operational evidence recorded'));
    check('SAP profile does not infer evidence from generic strengths', elements.crossTrackSap.innerHTML.includes('No SAP-specific evidence recorded yet.'));
    check('FinOps profile does not infer evidence from generic strengths', elements.crossTrackFinops.innerHTML.includes('No FinOps / AI-specific evidence recorded yet.'));
    // 1. Checking the box loads the real plan
    const checkbox = { checked: true };
    await context.handleMortgageInterviewPrepToggle(checkbox);
    const panelHtml = elements.mortgageInterviewIntel.innerHTML;
    check('panel shows INTERVIEW READY after checking the box', panelHtml.includes('INTERVIEW READY'));
    check('panel shows the resolved role name', panelHtml.includes('Mortgage Operations Analyst'));
    check('panel is honest about readiness (not a fake %)', panelHtml.includes('Not yet assessed'));
    check('panel lists all 3 levels', ['KNOWLEDGE', 'SCENARIO', 'BUSINESS'].every((l) => panelHtml.includes(l)));
    check('panel lists a real question verbatim', panelHtml.includes('pre-qualification and pre-approval'));
    check('panel HTML-escapes question text (no raw &lt;script&gt; etc. risk)', !panelHtml.includes('<script'));

    // 2. Unchecking hides it
    await context.handleMortgageInterviewPrepToggle({ checked: false });
    check('panel hides when unchecked', elements.mortgageInterviewIntel.style.display === 'none');

    // 3. Re-check, then start a real session via the button handler
    await context.handleMortgageInterviewPrepToggle({ checked: true });
    await context.startMortgageInterviewSession();
    const statusHtml = elements.mortgageInterviewSessionStatus.innerHTML;
    check('session start reports a real sessionId', /ivw_[0-9a-f]+/.test(statusHtml));
    check('session start is honest about no guided UI yet', statusHtml.includes('next piece to build'));

    // 4. Confirm that session really exists server-side (not just a UI claim)
    const sessionId = statusHtml.match(/ivw_[0-9a-f]+/)[0];
    const res = await realFetch(`${base}/api/interview/sessions/${sessionId}`);
    const data = await res.json();
    check('session created by the button actually persisted server-side', data.session && data.session.sectorId === 'mortgage');
    check('session is tagged with the selected canonical candidateId', data.session.candidateId === 'cand_test_interview_001');
  } finally {
    global.fetch = realFetch;
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nTest run stopped early:', err.stack || err.message);
  process.exit(1);
});
