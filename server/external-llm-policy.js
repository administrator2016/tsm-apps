'use strict';
// Explicit, process-level opt-in. Never derived from an HTTP body or API key.
const NOTICE = 'Synthetic demonstration only. Do not send real learner, student, patient, client or confidential data to external AI providers.';
const enabled = () => process.env.TSM_EXTERNAL_LLM_OPT_IN === 'synthetic-only';
function assertEnabled() {
  if (!enabled()) { const e = new Error('External AI is disabled by default. ' + NOTICE); e.code = 'EXTERNAL_LLM_DISABLED'; throw e; }
}
function isProvider(input) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  return /(^|\.)(groq\.com|openai\.com|anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai|together\.xyz|together\.ai|api\.mistral\.ai|api\.cohere\.ai|api\.deepseek\.com)$/.test(url.hostname) || /\/(chat\/completions|completions|messages|responses|[^/]*:generateContent)(?:[/?]|$)/.test(url.pathname);
}
async function externalLlmFetch(input, init) {
  if (isProvider(input)) assertEnabled();
  return globalThis.fetch(input, init);
}
function middleware(req, res, next) {
  res.setHeader('X-TSM-Data-Notice', NOTICE);
  // Legacy static pages contain direct browser provider calls. Until opt-in,
  // same-origin connections only: local UI/API works, remote browser AI cannot.
  if (!enabled()) res.setHeader('Content-Security-Policy', "connect-src 'self'");
  next();
}
module.exports = { NOTICE, enabled, assertEnabled, isProvider, externalLlmFetch, middleware };
