'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const p = require('../../server/external-llm-policy');
test('all known provider fetches default off before transport; opt-in must be exact', async t => {
  const prior = process.env.TSM_EXTERNAL_LLM_OPT_IN, fetch = globalThis.fetch;
  let calls = 0; globalThis.fetch = async () => { calls++; return { synthetic: true }; };
  t.after(() => { globalThis.fetch = fetch; if (prior === undefined) delete process.env.TSM_EXTERNAL_LLM_OPT_IN; else process.env.TSM_EXTERNAL_LLM_OPT_IN = prior; });
  for (const value of [undefined, '', 'true', '1', 'false']) {
    if (value === undefined) delete process.env.TSM_EXTERNAL_LLM_OPT_IN; else process.env.TSM_EXTERNAL_LLM_OPT_IN = value;
    for (const url of ['https://api.groq.com/openai/v1/chat/completions','https://api.openai.com/v1/responses','https://api.anthropic.com/v1/messages','https://example.test/v1/chat/completions']) {
      await assert.rejects(p.externalLlmFetch(url, { method: 'POST' }), { code: 'EXTERNAL_LLM_DISABLED' });
    }
    assert.throws(p.assertEnabled, { code: 'EXTERNAL_LLM_DISABLED' });
  }
  assert.equal(calls, 0);
  process.env.TSM_EXTERNAL_LLM_OPT_IN = 'synthetic-only';
  assert.deepEqual(await p.externalLlmFetch(new Request('https://api.groq.com/openai/v1/chat/completions')), { synthetic: true }); assert.equal(calls, 1);
});
test('browser egress is same-origin by default and notice survives opt-in', t => {
  const prior = process.env.TSM_EXTERNAL_LLM_OPT_IN; t.after(() => { if (prior === undefined) delete process.env.TSM_EXTERNAL_LLM_OPT_IN; else process.env.TSM_EXTERNAL_LLM_OPT_IN = prior; });
  for (const opt of [undefined, 'synthetic-only']) {
    if (opt === undefined) delete process.env.TSM_EXTERNAL_LLM_OPT_IN; else process.env.TSM_EXTERNAL_LLM_OPT_IN = opt;
    const headers = {}; let next = false; p.middleware({}, { setHeader: (k,v) => { headers[k] = v; } }, () => { next = true; });
    assert.equal(next, true); assert.match(headers['X-TSM-Data-Notice'], /Synthetic demonstration only/);
    assert.equal(headers['Content-Security-Policy'], opt ? undefined : "connect-src 'self'");
  }
});
