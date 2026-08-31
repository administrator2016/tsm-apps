// Verifies relayToAnomalyBridge()'s new AI-generated-steps path in
// html/healthcare/hc-office-manager-doc-intake.html, extracted straight from
// the shipped file (not reimplemented) so this can't drift from real code.
// No live network / no real Groq call — fetch is mocked per-case.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const filePath = path.join(__dirname, '..', 'html/healthcare/hc-office-manager-doc-intake.html');
const html = fs.readFileSync(filePath, 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const rawScript = scripts.find(s => s.includes('function relayToAnomalyBridge'));
assert.ok(rawScript, 'relayToAnomalyBridge not found in shipped file');

// The full script has top-level DOMContentLoaded-independent
// addEventListener calls tied to page chrome irrelevant to this test —
// pull out just the function declarations under test (still the REAL
// shipped source, not reimplemented) rather than running the whole file.
function extractFn(name, src) {
  let start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  const asyncIdx = src.lastIndexOf('async ', start);
  if (asyncIdx !== -1 && src.slice(asyncIdx + 6, start).trim() === '') start = asyncIdx;
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end !== -1, `could not find end of function ${name}`);
  return src.slice(start, end);
}
const mainScript = [
  'extractClientData', 'genericSteps', 'parseAdvisorSteps',
  'fetchClaimSpecificSteps', 'relayToAnomalyBridge',
].map(name => extractFn(name, rawScript)).join('\n\n');

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  ok - ${label}`); }
  else { failed++; console.log(`  FAIL - ${label}`); }
}

function makeSandbox(fetchImpl) {
  const store = {};
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
  const sandbox = {
    localStorage,
    fetch: fetchImpl,
    AbortController: global.AbortController,
    setTimeout, clearTimeout,
    console,
    window: {},
    document: { getElementById: () => null },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // Only need extractClientData + the new functions; strip DOM-heavy init
  // calls at the bottom by only running up through relayToAnomalyBridge's
  // closing brace — simplest robust approach: run the whole script, it only
  // *defines* functions at top level (no auto-invoked init in this file).
  vm.runInContext(mainScript, sandbox, { filename: 'hc-office-manager-doc-intake.html' });
  return { sandbox, store };
}

const SAMPLE_EV = {
  id: 'evt1',
  description: 'Patient Name: Angela M. Brooks Date of Birth: 01/01/1980\nClaim #: CLM-99123\nCPT Code: 47562\nDenial Reason Code: CO-197 — Precertification/authorization absent',
  suggestedNode: 'billing',
  suggestedLabel: 'Billing',
  confidence: 'high',
  reason: 'Denial code matched billing affinity',
  sourceFileName: 'File5_ANOMALY.pdf',
};

(async () => {
  // Case 1: AI call succeeds with a well-formed numbered list -> claim-specific steps used
  {
    const fetchImpl = async (url) => {
      assert.strictEqual(url, '/api/hc/query');
      return {
        ok: true,
        json: async () => ({ ok: true, output:
          '1. ⚠ CPT CODE — 47562 lacks a matching precert on file — Insurance tab → Prior Auth field, attach precert number before resubmitting.\n' +
          '2. ⚠ CLAIM AMOUNT — Not verified against payer fee schedule — Billing tab → Amount field, confirm against CO-197 payer schedule.'
        }),
      };
    };
    const { sandbox, store } = makeSandbox(fetchImpl);
    await sandbox.relayToAnomalyBridge(SAMPLE_EV, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('AI-success: steps come from parsed AI output, not the generic template',
      payload.steps.length === 2 && payload.steps[0].includes('CPT CODE'));
    check('AI-success: steps still start with ⚠', payload.steps.every(s => s.startsWith('⚠')));
    check('AI-success: clientData still auto-extracted independently of AI call',
      payload.clientData && payload.clientData.claim === 'CLM-99123' && payload.clientData.cpt === '47562');
    check('AI-success: fileName/source/targetNodeIds unchanged shape',
      payload.fileName === 'File5_ANOMALY.pdf' && payload.source === 'office-manager-intake' && payload.targetNodeIds[0] === 'billing');
  }

  // Case 2: fetch throws (network error) -> falls back to generic 4-line template
  {
    const fetchImpl = async () => { throw new Error('network down'); };
    const { sandbox, store } = makeSandbox(fetchImpl);
    await sandbox.relayToAnomalyBridge(SAMPLE_EV, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('network-error: falls back to generic steps (4 lines)', payload.steps.length === 4);
    check('network-error: generic steps mention Mission Objectives panel',
      payload.steps[0].includes('Mission Objectives'));
    check('network-error: generic "clientData was auto-filled" variant used since clientData exists',
      payload.steps[1].includes('auto-filled from the routed document'));
  }

  // Case 3: fetch resolves but !res.ok -> falls back
  {
    const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
    const { sandbox, store } = makeSandbox(fetchImpl);
    await sandbox.relayToAnomalyBridge(SAMPLE_EV, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('non-2xx response: falls back to generic steps', payload.steps.length === 4);
  }

  // Case 4: fetch resolves ok but output is empty/unparseable -> falls back
  {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, output: '' }) });
    const { sandbox, store } = makeSandbox(fetchImpl);
    await sandbox.relayToAnomalyBridge(SAMPLE_EV, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('empty AI output: falls back to generic steps', payload.steps.length === 4);
  }

  // Case 5: fetch hangs past the 8s abort watchdog -> falls back (use fake short timeout via real abort signal)
  {
    const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      // never resolves otherwise
    });
    const { sandbox, store } = makeSandbox(fetchImpl);
    // Speed up the test: monkey-patch setTimeout inside sandbox already uses real setTimeout(...,8000);
    // instead of waiting 8s for real, temporarily override global timeout via sandbox before call.
    const realSetTimeout = sandbox.setTimeout;
    sandbox.setTimeout = (fn, ms) => realSetTimeout(fn, Math.min(ms, 50));
    await sandbox.relayToAnomalyBridge(SAMPLE_EV, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('timeout/abort: falls back to generic steps', payload.steps.length === 4);
  }

  // Case 6: no clientData extractable (description has none of the regex-matched fields) -> AI success still used, generic fallback picks the no-clientData variant
  {
    const evNoData = { ...SAMPLE_EV, description: 'A vague unstructured note with no structured fields.' };
    const fetchImpl = async () => { throw new Error('down'); };
    const { sandbox, store } = makeSandbox(fetchImpl);
    await sandbox.relayToAnomalyBridge(evNoData, 'billing');
    const payload = JSON.parse(store['tsm-doc-anomaly']);
    check('no-clientData fallback: uses the non-auto-fill generic variant',
      payload.steps[1].includes('Update this node') && payload.clientData === undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
