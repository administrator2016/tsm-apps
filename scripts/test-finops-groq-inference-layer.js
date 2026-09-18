// scripts/test-finops-groq-inference-layer.js
//
// docs/audit/step6-cross-vertical-release-status.md, Step 4, named this as
// the one remaining untested piece: "the Groq inference layer itself still
// untested" — only the relay/exec-portal plumbing around it had coverage.
// This test exercises the real POST /api/finops/report handler in
// routes/finops.js directly (mounted in a minimal express app, real code,
// not a reimplementation), with global.fetch mocked so every one of its
// real branches can be driven deterministically without a live Groq key:
//
//   1. GROQ_API_KEY unset
//   2. GROQ_API_KEY set, Groq call succeeds with valid structured JSON
//   3. GROQ_API_KEY set, Groq call succeeds but returns non-JSON narrative text
//   4. GROQ_API_KEY set, Groq call fails (non-ok status)
//
// Also pins a real finding (not yet fixed, flagged here rather than
// silently assumed away): branches 1 and 4 return the exact same
// hardcoded fallback report shape as branch 2/3's real AI output, with no
// disclosure flag distinguishing fabricated content from a real Groq
// analysis — the same bug class fixed for Legal's BNCA report
// (finalizeBNCA's degraded flag) and FinOps's own exposureDefaulted/
// riskScoreDefaulted flags elsewhere in this codebase, just not yet
// applied here. This test does NOT assert that gap is acceptable — it
// pins the current behavior so any future fix (or regression) is visible.

const express = require('express');

const realFetch = global.fetch;

async function startTestServer() {
  // Mock global.fetch BEFORE requiring routes/finops.js's module scope
  // runs any request, and before any request handler fires — the route
  // calls fetch() per-request, not at require time, so we can swap the
  // mock's behavior between requests via currentFetchMock.
  let currentFetchMock = async () => { throw new Error('no fetch mock configured for this test case'); };
  global.fetch = (...args) => currentFetchMock(...args);

  const financeRouter = require('../routes/finops.js');
  const app = express();
  app.use(express.json());
  app.use(financeRouter);

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

async function postReport(baseUrl, body) {
  const res = await realFetch(`${baseUrl}/api/finops/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  const { baseUrl, setFetchMock, close } = await startTestServer();
  const savedKey = process.env.GROQ_API_KEY;

  try {
    // --- Case 1: GROQ_API_KEY unset — the route should never even attempt
    // fetch() in this case (confirmed by making the mock throw if called) ---
    {
      delete process.env.GROQ_API_KEY;
      setFetchMock(async () => { throw new Error('fetch should NOT be called when GROQ_API_KEY is unset'); });

      const { status, json } = await postReport(baseUrl, { workflow: 'AP Aging', source: 'test' });
      check('no-key case: returns 200 ok:true', status === 200 && json.ok === true);
      check('no-key case: falls back to the canned MEDIUM/88 report', json.report.risk_level === 'MEDIUM' && json.report.confidence === 88);
      // Pinning the finding: no field anywhere marks this as fabricated/fallback.
      check('FINDING (not fixed): no-key fallback carries no disclosure flag (degraded/ai_generated/fallback)',
        json.fallback === undefined && json.report.ai_generated === undefined && json.report.degraded === undefined);
    }

    // --- Case 2: real key, Groq returns valid structured JSON ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      setFetchMock(async (url, opts) => {
        check('real-call case: hits the real Groq chat-completions URL', url === 'https://api.groq.com/openai/v1/chat/completions');
        const body = JSON.parse(opts.body);
        check('real-call case: sends the workflow/source through in the prompt', body.messages[1].content.includes('AR Ledger') && body.messages[1].content.includes('unit-test'));
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({
              workflow: 'AR Ledger', risk_level: 'HIGH', summary: 'Real AI summary.',
              findings: ['f1'], actions: ['a1'], controller_note: 'note', business_outcome: 'outcome', confidence: 77
            }) } }]
          })
        };
      });

      const { status, json } = await postReport(baseUrl, { workflow: 'AR Ledger', source: 'unit-test' });
      check('real-call case: returns 200 ok:true', status === 200 && json.ok === true);
      check('real-call case: report reflects the real parsed Groq JSON, not the fallback', json.report.risk_level === 'HIGH' && json.report.confidence === 77 && json.report.summary === 'Real AI summary.');
    }

    // --- Case 3: real key, Groq returns non-JSON narrative text ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      setFetchMock(async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Here is a narrative paragraph, not JSON at all.' } }]
        })
      }));

      const { status, json } = await postReport(baseUrl, { workflow: 'Budget Variance', source: 'unit-test' });
      check('narrative-text case: returns 200 ok:true', status === 200 && json.ok === true);
      check('narrative-text case: wraps the raw text into the narrative-fallback shape (confidence 82)', json.report.confidence === 82 && json.report.summary.includes('narrative paragraph'));
    }

    // --- Case 4: real key, Groq call itself fails (e.g. upstream 500) ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      setFetchMock(async () => ({ ok: false, status: 500, text: async () => 'upstream error' }));

      const { status, json } = await postReport(baseUrl, { workflow: 'AP Aging', source: 'unit-test' });
      check('upstream-failure case: returns 200 ok:true (degrades gracefully, no 500 surfaced to client)', status === 200 && json.ok === true);
      check('upstream-failure case: falls back to the same canned MEDIUM/88 report as the no-key case', json.report.risk_level === 'MEDIUM' && json.report.confidence === 88);
      check('FINDING (not fixed): upstream-failure fallback ALSO carries no disclosure flag — indistinguishable from a real AI response to the client',
        json.fallback === undefined && json.report.ai_generated === undefined && json.report.degraded === undefined);
    }

    // --- Case 5: fetch() throws outright (network error, not just a bad status) ---
    {
      process.env.GROQ_API_KEY = 'fake-test-key';
      setFetchMock(async () => { throw new TypeError('fetch failed'); });

      const { status, json } = await postReport(baseUrl, { workflow: 'AP Aging', source: 'unit-test' });
      check('network-error case: still returns 200 ok:true, does not crash the request', status === 200 && json.ok === true);
      check('network-error case: falls back to the same canned report, not a 500', json.report.risk_level === 'MEDIUM' && json.report.confidence === 88);
    }
  } finally {
    if (savedKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = savedKey;
    await close();
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
