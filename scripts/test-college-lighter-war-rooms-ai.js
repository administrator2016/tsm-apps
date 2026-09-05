// Functional harness for the AI wiring added to Endowment, Research/F&A,
// and Accreditation college war rooms — extracts each real shipped file's
// functions via jsdom (not reimplemented), mocks fetch, and drives the
// same code paths a real click would.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', label); }
}

const pages = [
  {
    file: 'college-endowment-command.html',
    domain: 'COLLEGE_ENDOWMENT',
    callFnName: 'callEndowmentAI'
  },
  {
    file: 'college-research-fa-command.html',
    domain: 'COLLEGE_RESEARCH_FA',
    callFnName: 'callResearchFaAI'
  },
  {
    file: 'college-accred-command.html',
    domain: 'COLLEGE_ACCRED',
    callFnName: 'callAccredAI'
  }
];

async function testPage(p) {
  const filePath = path.join(__dirname, '..', 'html', 'war-rooms', 'college-command', p.file);
  const html = fs.readFileSync(filePath, 'utf8');

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: 'https://example.test/' });
  const { window } = dom;

  // Let init() run (it's called synchronously at the bottom of the IIFE)
  await new Promise(r => setTimeout(r, 20));

  const doc = window.document;

  // 1. Structural: AI section exists with expected controls
  check(`${p.file}: aiStatus element present`, !!doc.getElementById('aiStatus'));
  check(`${p.file}: runAiBtn present`, !!doc.getElementById('runAiBtn'));
  check(`${p.file}: aiKeyModal present`, !!doc.getElementById('aiKeyModal'));
  check(`${p.file}: aiRiskOut initial text is placeholder`,
    /Not run yet/.test(doc.getElementById('aiRiskOut').textContent));

  // 2. Mock fetch: server path succeeds
  let lastFetchBody = null;
  window.fetch = async (url, opts) => {
    lastFetchBody = opts && opts.body ? JSON.parse(opts.body) : null;
    if (url === '/api/chat') {
      return {
        ok: true,
        json: async () => ({ answer: 'MOCK_SERVER_ANSWER for ' + p.domain, degraded: false })
      };
    }
    throw new Error('unexpected fetch to ' + url);
  };

  doc.getElementById('runAiBtn').click();
  // runAiAnalysis is async; wait for both sequential awaited calls
  await new Promise(r => setTimeout(r, 50));

  check(`${p.file}: /api/chat called with folded system+user message`,
    lastFetchBody && typeof lastFetchBody.message === 'string' && lastFetchBody.message.length > 0);
  check(`${p.file}: conversationHistory sent as empty array`,
    lastFetchBody && Array.isArray(lastFetchBody.conversationHistory) && lastFetchBody.conversationHistory.length === 0);
  check(`${p.file}: aiStatus shows CONNECTED after server success`,
    doc.getElementById('aiStatus').textContent === 'AI: CONNECTED');
  check(`${p.file}: aiRiskOut populated with server answer`,
    doc.getElementById('aiRiskOut').textContent.indexOf('MOCK_SERVER_ANSWER') === 0);
  check(`${p.file}: aiActionOut populated with server answer`,
    doc.getElementById('aiActionOut').textContent.indexOf('MOCK_SERVER_ANSWER') === 0);
  check(`${p.file}: run button re-enabled after completion`,
    doc.getElementById('runAiBtn').disabled === false);

  // 3. Relay payload: ai_analysis should now be populated (aiRan = true)
  const relayEventPromise = new Promise(resolve => {
    window.addEventListener('TSM_RELAY_EVENT', (e) => resolve(e.detail));
  });
  doc.getElementById('relayBtn').click();
  const relayDetail = await relayEventPromise;
  check(`${p.file}: relay payload domain matches`, relayDetail.domain === p.domain);
  check(`${p.file}: relay payload ai_analysis present after a real run`,
    relayDetail.data.ai_analysis && typeof relayDetail.data.ai_analysis.risk_prioritization === 'string');
  check(`${p.file}: relay payload ai_analysis.action_plan present`,
    relayDetail.data.ai_analysis && typeof relayDetail.data.ai_analysis.action_plan === 'string');

  // 4. Fetch failure path -> falls back to "unavailable" when no session key set
  window.fetch = async () => { throw new Error('network down'); };
  doc.getElementById('runAiBtn').click();
  await new Promise(r => setTimeout(r, 50));
  check(`${p.file}: aiStatus shows UNAVAILABLE when proxy unreachable and no fallback key`,
    doc.getElementById('aiStatus').textContent === 'AI: UNAVAILABLE');
  check(`${p.file}: aiRiskOut shows Error: text on failure`,
    /^Error:/.test(doc.getElementById('aiRiskOut').textContent));

  // 5. Degraded server response (ok but data.answer missing / degraded:true) also falls through
  window.fetch = async () => ({ ok: true, json: async () => ({ degraded: true }) });
  doc.getElementById('aiKeySaveBtn'); // sanity: modal buttons exist
  doc.getElementById('runAiBtn').click();
  await new Promise(r => setTimeout(r, 50));
  check(`${p.file}: degraded server response without fallback key -> UNAVAILABLE`,
    doc.getElementById('aiStatus').textContent === 'AI: UNAVAILABLE');

  // 6. Fallback key path: set a session key via the modal, then hit direct Groq
  window.fetch = async (url, opts) => {
    if (url === '/api/chat') throw new Error('proxy down');
    if (url === 'https://api.groq.com/openai/v1/chat/completions') {
      const body = JSON.parse(opts.body);
      check(`${p.file}: direct Groq call carries Authorization bearer`,
        opts.headers['Authorization'] === 'Bearer test-key-123');
      check(`${p.file}: direct Groq call uses expected model`,
        body.model === 'openai/gpt-oss-120b');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'DIRECT_KEY_ANSWER' } }] }) };
    }
    throw new Error('unexpected fetch to ' + url);
  };
  doc.getElementById('aiKeyInput').value = 'test-key-123';
  doc.getElementById('aiKeySaveBtn').click();
  doc.getElementById('runAiBtn').click();
  await new Promise(r => setTimeout(r, 50));
  check(`${p.file}: aiStatus shows FALLBACK KEY after direct Groq success`,
    doc.getElementById('aiStatus').textContent === 'AI: FALLBACK KEY');
  check(`${p.file}: aiRiskOut populated via fallback key path`,
    doc.getElementById('aiRiskOut').textContent === 'DIRECT_KEY_ANSWER');

  window.close();
}

(async () => {
  for (const p of pages) {
    await testPage(p);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
