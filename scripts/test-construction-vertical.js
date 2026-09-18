// scripts/test-construction-vertical.js
//
// Step 6 (cross-vertical release regression) coverage for Construction —
// one of the 13+ verticals in docs/audit/step6-cross-vertical-release-
// status.md with zero real logic testing. Exercises the real handlers in
// routes/construction.js directly (mounted in a minimal express app, real
// code, not a reimplementation), with global.fetch mocked so groqChat()'s
// branches can be driven deterministically without a live Groq key.
//
// Covers:
//   POST /api/construction/report   — grounded-analysis vs generic-fallback
//                                      branching (hasRealContent, GROQ_API_KEY,
//                                      Groq success/failure)
//   POST /api/construction/query    — system-prompt passthrough (the fix
//                                      landed in d87ab84e) and memory logging
//   POST /api/construction/upload-doc — file-type gating and classification
//
// FINDING (pinned, not fixed here — flagged for the same reason FinOps's
// missing auth guard was flagged rather than silently assumed away):
// none of these three routes are behind requireAnyAuth, unlike /api/hc/*,
// /api/finops/report (as of c41fccc6), and other vertical routers. Unlike
// FinOps's report route, these are NOT orphaned — construction-war-room.html
// and multiple other live pages call them directly (confirmed via grep
// across html/). This is a live auth gap, not a dead one.

const express = require('express');

const realFetch = global.fetch;

async function startTestServer() {
  let currentFetchMock = async () => { throw new Error('no fetch mock configured for this test case'); };
  global.fetch = (...args) => currentFetchMock(...args);

  const constructionRouter = require('../routes/construction.js');
  const app = express();
  app.use(express.json());
  app.use(constructionRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  return {
    baseUrl: `http://localhost:${port}`,
    setFetchMock: (fn) => { currentFetchMock = fn; },
    close: () => new Promise((r) => server.close(r)),
  };
}

async function post(baseUrl, path, body) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function groqSuccess(contentObj) {
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(contentObj) } }] }),
  });
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  const { baseUrl, setFetchMock, close } = await startTestServer();
  const savedKey = process.env.GROQ_API_KEY;
  global.__TSM_MEMORY__ = {};

  try {
    // --- Auth finding: pin that none of these routes currently reject an
    // unauthenticated caller, despite being live production endpoints ---
    {
      const { status, json } = await post(baseUrl, '/api/construction/report', { workflow: 'Job Cost Report', content: '' });
      check('FINDING (not fixed): /api/construction/report has no auth guard — unauthenticated call is served, not 401ed',
        status === 200 && json.ok === true);
    }

    // --- /api/construction/report: no content submitted -> generic checklist ---
    {
      delete process.env.GROQ_API_KEY;
      const { status, json } = await post(baseUrl, '/api/construction/report', { workflow: 'Job Cost Report', content: '' });
      check('no-content case: returns 200 ok:true', status === 200 && json.ok === true);
      check('no-content case: grounded:false, confidence 0, risk_level UNKNOWN', json.report.grounded === false && json.report.confidence === 0 && json.report.risk_level === 'UNKNOWN');
    }

    // --- real content, but no GROQ_API_KEY -> generic fallback, not a crash ---
    {
      delete process.env.GROQ_API_KEY;
      const longContent = 'Change order #4 adds $82,000 to the concrete package and pushes the pour date by 9 business days. '.repeat(2);
      const { status, json } = await post(baseUrl, '/api/construction/report', { workflow: 'Change Order Review', content: longContent });
      check('no-key case: returns 200 ok:true', status === 200 && json.ok === true);
      check('no-key case: falls back generic, grounded:false, confidence 50', json.report.grounded === false && json.report.confidence === 50 && json.report.risk_level === 'MEDIUM');
    }

    // --- real content + real key + Groq succeeds with valid JSON -> grounded analysis ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      const longContent = 'Change order #4 adds $82,000 to the concrete package and pushes the pour date by 9 business days. '.repeat(2);
      setFetchMock(groqSuccess({
        risk_level: 'HIGH', summary: 'Change order materially impacts cost and schedule.',
        findings: ['$82,000 cost increase', '9-day schedule slip'], actions: ['Route to owner for change-order approval'],
        project_note: 'Escalate before next draw request.', confidence: 91
      }));

      const { status, json } = await post(baseUrl, '/api/construction/report', { workflow: 'Change Order Review', content: longContent });
      check('grounded case: returns 200 ok:true', status === 200 && json.ok === true);
      check('grounded case: report is marked grounded:true and reflects the real parsed Groq JSON', json.report.grounded === true && json.report.risk_level === 'HIGH' && json.report.confidence === 91);
    }

    // --- real content + real key + Groq call throws -> falls through to generic fallback, not a 500 ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      const longContent = 'Change order #4 adds $82,000 to the concrete package and pushes the pour date by 9 business days. '.repeat(2);
      setFetchMock(async () => { throw new TypeError('fetch failed'); });

      const { status, json } = await post(baseUrl, '/api/construction/report', { workflow: 'Change Order Review', content: longContent });
      check('groq-failure case: still returns 200 ok:true, does not crash the request', status === 200 && json.ok === true);
      check('groq-failure case: falls back generic, grounded:false (not silently mislabeled grounded:true)', json.report.grounded === false && json.report.confidence === 50);
    }

    // --- /api/construction/query: confirms d87ab84e's system-prompt passthrough fix still holds ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      let sentSystemPrompt = null;
      setFetchMock(async (url, opts) => {
        const body = JSON.parse(opts.body);
        sentSystemPrompt = body.messages[0].content;
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Custom-guarded answer.' } }] }) };
      });

      const customSystem = 'CON_ENGINE_SYSTEM_GUARD: never infer a lien-filing date not stated in the source document.';
      const { status, json } = await post(baseUrl, '/api/construction/query', { question: 'When is the lien deadline?', system: customSystem });
      check('query case: returns 200 ok:true', status === 200 && json.ok === true);
      check('REGRESSION GUARD (d87ab84e): custom req.body.system reaches the outgoing Groq request unmodified, not overwritten by the generic default', sentSystemPrompt === customSystem);
      check('query case: memory logging fires for real traffic (global.__TSM_MEMORY__.construction.recent)', Array.isArray(global.__TSM_MEMORY__?.construction?.recent) && global.__TSM_MEMORY__.construction.recent.length === 1);
    }

    // --- /api/construction/query: no GROQ_API_KEY -> groqChat throws -> 500, no graceful fallback ---
    {
      delete process.env.GROQ_API_KEY;
      const { status, json } = await post(baseUrl, '/api/construction/query', { question: 'test', system: 'test system' });
      check('FINDING (not fixed): no-key query call surfaces a raw 500 instead of a graceful fallback (unlike /api/construction/report and /api/finops/report, which both degrade gracefully)',
        status === 500 && json.ok === false);
    }

    // --- /api/construction/upload-doc: unsupported file type rejected ---
    {
      const form = new FormData();
      form.append('file', new Blob(['hello world'], { type: 'text/plain' }), 'note.xyz');
      const res = await realFetch(`${baseUrl}/api/construction/upload-doc`, { method: 'POST', body: form });
      const json = await res.json();
      check('upload-doc: unsupported extension rejected with 400', res.status === 400 && json.ok === false);
    }

    // --- /api/construction/upload-doc: supported file type extracted + classified ---
    {
      const form = new FormData();
      form.append('file', new Blob(['This subcontract agreement covers electrical rough-in work.'], { type: 'text/plain' }), 'subcontract.txt');
      const res = await realFetch(`${baseUrl}/api/construction/upload-doc`, { method: 'POST', body: form });
      const json = await res.json();
      check('upload-doc: supported .txt file returns 200 ok:true', res.status === 200 && json.ok === true);
      check('upload-doc: classifies subcontract text correctly', json.docType === 'Subcontractor Agreement');
      check('upload-doc: extracted text matches the uploaded content', json.text.includes('electrical rough-in'));
    }

    // --- /api/construction/upload-doc: no auth guard here either (same finding as above) ---
    // (already implicitly covered by the two checks above succeeding with no session/cookie at all)
  } finally {
    if (savedKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedKey;
    await close();
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
