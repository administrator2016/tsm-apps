
const { externalLlmFetch } = require('../server/external-llm-policy');
// routes/finance-chat.js
//
// Backend for html/finops-suite/finance-index.html ("TSM Financial
// Intelligence Pro"). Two concerns:
//
//   1. POST /api/chat  — the per-tab conversational AI (Dashboard/Reports/
//      Audit/Invoices/Health/How-To). finance-index.html's callTSMNeuralCore()
//      posts { message, conversationHistory, stream } and reads back
//      { answer } (also checks .data/.response/.result/.choices as fallbacks —
//      we return { answer } directly).
//
//   2. POST /api/audit — the Audit Engine's runAudit()/sendTabMessage('audit')
//      path. Same Groq call, audit-calibrated system prompt, PLUS real
//      persistence: every run is appended to an in-memory audit log
//      (id, timestamp, sector, factor/query, output, actor). This is the
//      real record — swap AUDIT_LOG for your DB of choice when ready, the
//      route contract below stays the same. Given this app is scoped to
//      managing real department accounts, "ran an audit" needs to be a
//      fact you can go back and prove later, not just a chat bubble that
//      vanishes on reload.
//
// Mount in server.js:
//   app.use('/api/chat', require('./routes/finance-chat').chatRouter);
//   app.use('/api/audit', require('./routes/finance-chat').auditRouter);
//
// Env:
//   GROQ_API_KEY        — required for real AI output (falls back to a
//                          clearly-labeled degraded response otherwise,
//                          and still logs the attempt)
//   TSM_FINANCE_MODEL    — optional override, defaults to openai/gpt-oss-120b

'use strict';

const express = require('express');
const crypto = require('crypto');

const chatRouter = express.Router();
const auditRouter = express.Router();

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const CHAT_SYSTEM_PROMPT =
  'You are the TSM Financial Intelligence assistant embedded in TSM RCM OS. ' +
  'You help Controllers, Staff Accountants, and department account owners ' +
  'with financial analysis, reporting, audit questions, invoices, and ' +
  'financial health scoring. Be precise, cite concrete numbers when given ' +
  'them, and flag anything that needs human sign-off. Never mention your ' +
  'provider, model name, or underlying infrastructure.';

const AUDIT_SYSTEM_PROMPT =
  'You are the TSM Audit Engine, a financial-controls analyst calibrated for ' +
  'SOX 302/404, PCAOB AS 2201, and IFRS compliance review. Given an audit ' +
  'scope or query, identify concrete control gaps or deficiencies, rank them ' +
  'by severity, and recommend specific remediation steps. Be concise and ' +
  'actionable — this output is read by Controllers who need to act on it, ' +
  'not a general essay. IMPORTANT: the query you receive is a sector/factor ' +
  'label only — you are NOT given the organization\'s actual ledger, control ' +
  'evidence, or prior audit findings. Do not present findings as if verified ' +
  'against real data: frame this as a general risk framework for that ' +
  'sector/factor (what a real audit in this area would typically check), not ' +
  'as confirmed deficiencies found in this organization\'s environment. Do ' +
  'not invent specific dollar amounts, dates, account names, or deadlines as ' +
  'if they were observed — use those only if they were literally present in ' +
  'the query itself. Never mention your provider, model name, or ' +
  'underlying infrastructure.\n\n' +
  'After your narrative answer, append a fenced block of the individual risk ' +
  'items you raised, formatted EXACTLY like this (no other text inside the ' +
  'fence):\n' +
  '```findings\n' +
  '[{"severity":"high|medium|low","area":"short control area name","title":' +
  '"one-line description of the gap","recommendation":"one-line remediation ' +
  'step"}]\n' +
  '```\n' +
  'List at most 6 items, ordered by severity (high first). If your answer ' +
  'raised no discrete risk items, emit an empty array []. Every item must be ' +
  'derived from what you actually wrote above it — do not add items to the ' +
  'JSON that weren\'t discussed in the narrative.';

// ── In-memory audit log ─────────────────────────────────────────────────────
// Append-only. Swap for Postgres/Mongo/etc when ready — keep the shape below
// (id, ts, sector, factor, query, output, degraded) so finance-index.html's
// history views (once built) and any downstream export don't need to change.
const AUDIT_LOG = [];
const MAX_LOG = 2000; // oldest-drop cap, matches Sentinel audit-log convention elsewhere in the app

function appendAuditEntry(entry) {
  AUDIT_LOG.push(entry);
  if (AUDIT_LOG.length > MAX_LOG) AUDIT_LOG.shift();
  return entry;
}

// ── In-memory findings store ────────────────────────────────────────────────
// Each finding is derived from a real audit run's own output (see
// extractFindings below) and tracked open/resolved so the Audit Engine tab's
// metric cards and findings panel reflect actual runs, never placeholder
// numbers. Swap for a real table alongside AUDIT_LOG when persisting to a DB.
const FINDINGS_LOG = [];
const MAX_FINDINGS = 2000;
const VALID_SEVERITIES = new Set(['high', 'medium', 'low']);

function extractFindings(rawText, auditEntryId, sector, factor) {
  if (!rawText) return { narrative: '', findings: [] };
  const match = rawText.match(/```findings\s*([\s\S]*?)```/i);
  const narrative = match ? rawText.slice(0, match.index).trim() : rawText.trim();
  if (!match) return { narrative, findings: [] };

  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch (e) {
    return { narrative, findings: [] }; // malformed block — log the run, zero findings, don't crash
  }
  if (!Array.isArray(parsed)) return { narrative, findings: [] };

  const findings = parsed.slice(0, 6).map(item => {
    if (!item || typeof item !== 'object') return null;
    const severity = VALID_SEVERITIES.has(String(item.severity).toLowerCase())
      ? String(item.severity).toLowerCase() : 'medium';
    const title = typeof item.title === 'string' ? item.title.slice(0, 300) : '';
    if (!title) return null; // no usable title — skip rather than store a blank finding
    return {
      id: crypto.randomUUID(),
      auditEntryId,
      sector: sector || null,
      factor: factor || null,
      severity,
      area: typeof item.area === 'string' ? item.area.slice(0, 120) : null,
      title,
      recommendation: typeof item.recommendation === 'string' ? item.recommendation.slice(0, 300) : null,
      status: 'open',
      ts: new Date().toISOString(),
      resolvedAt: null
    };
  }).filter(Boolean);

  return { narrative, findings };
}

function appendFindings(findings) {
  for (const f of findings) {
    FINDINGS_LOG.push(f);
    if (FINDINGS_LOG.length > MAX_FINDINGS) FINDINGS_LOG.shift();
  }
}

async function callGroq(systemPrompt, messages, { max_tokens = 900, temperature = 0.25 } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return { text: null, degraded: true, reason: 'GROQ_API_KEY not configured on server' };
  }
  try {
    const res = await externalLlmFetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL(),
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens,
        temperature
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { text: null, degraded: true, reason: `Upstream ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return { text: null, degraded: true, reason: 'Empty upstream response' };
    return { text, degraded: false };
  } catch (err) {
    return { text: null, degraded: true, reason: err.message };
  }
}

// ── POST /api/chat ───────────────────────────────────────────────────────────
chatRouter.post('/', express.json({ limit: '5mb' }), async (req, res) => {
  const { message, conversationHistory, context } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const history = Array.isArray(conversationHistory) ? conversationHistory.slice(-10) : [];
  const messages = [...history, { role: 'user', content: message }];

  const systemPrompt = (context && typeof context === 'string')
    ? `${CHAT_SYSTEM_PROMPT}\n\n${context.slice(0, 4000)}`
    : CHAT_SYSTEM_PROMPT;

  const { text, degraded, reason } = await callGroq(systemPrompt, messages, { max_tokens: 1024, temperature: 0.3 });

  if (degraded) {
    return res.json({
      answer: `AI analysis is temporarily unavailable (${reason}). Your question has been noted — please try again shortly, or route this to a Controller directly if time-sensitive.`,
      degraded: true
    });
  }
  return res.json({ answer: text });
});

// ── POST /api/audit ───────────────────────────────────────────────────────────
// Body: { query } — finance-index.html sends a formatted string like
//   `auditops "sector" --factor "factor" --logic strategist`
// or a free-text audit scope from the Audit Engine tab. Either way we treat
// it as the audit prompt, run it, and persist the run regardless of outcome
// (a failed/degraded run is still an auditable fact — it means the check
// did NOT happen, which matters for compliance trail purposes).
auditRouter.post('/', express.json({ limit: '5mb' }), async (req, res) => {
  const { query, sector, factor, actor } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }

  const { text, degraded, reason } = await callGroq(AUDIT_SYSTEM_PROMPT, [{ role: 'user', content: query }]);

  const entryId = crypto.randomUUID();
  let narrative = null;
  let findings = [];
  if (!degraded) {
    const extracted = extractFindings(text, entryId, sector, factor);
    narrative = extracted.narrative;
    findings = extracted.findings;
    appendFindings(findings);
  }

  const entry = {
    id: entryId,
    ts: new Date().toISOString(),
    sector: sector || null,
    factor: factor || null,
    query,
    actor: actor || 'unknown',
    output: degraded ? null : narrative,
    findingCount: findings.length,
    degraded,
    degradedReason: degraded ? reason : undefined
  };
  appendAuditEntry(entry);

  if (degraded) {
    return res.json({
      output: `Audit scan could not complete (${reason}). This attempt has been logged for the compliance trail — re-run once resolved.`,
      id: entry.id,
      degraded: true
    });
  }
  return res.json({ output: narrative, id: entry.id, findings, degraded: false });
});

// ── GET /api/audit/summary ──────────────────────────────────────────────────
// Real numbers only, computed live from AUDIT_LOG/FINDINGS_LOG. Zero runs so
// far → zeroed-out cards, not a fabricated placeholder.
auditRouter.get('/summary', (req, res) => {
  const open = FINDINGS_LOG.filter(f => f.status === 'open');
  const resolved = FINDINGS_LOG.filter(f => f.status === 'resolved');
  const clean = AUDIT_LOG.filter(e => !e.degraded);
  res.json({
    totalRuns: AUDIT_LOG.length,
    cleanRuns: clean.length,
    degradedRuns: AUDIT_LOG.length - clean.length,
    lastRunAt: AUDIT_LOG.length ? AUDIT_LOG[AUDIT_LOG.length - 1].ts : null,
    openFindings: {
      total: open.length,
      high: open.filter(f => f.severity === 'high').length,
      medium: open.filter(f => f.severity === 'medium').length,
      low: open.filter(f => f.severity === 'low').length
    },
    resolvedFindings: resolved.length
  });
});

// ── GET /api/audit/findings ─────────────────────────────────────────────────
auditRouter.get('/findings', (req, res) => {
  const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : 'open';
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_FINDINGS);
  const list = FINDINGS_LOG.filter(f => f.status === status).slice(-limit).reverse();
  res.json({ count: list.length, findings: list });
});

// ── POST /api/audit/findings/:id/resolve ────────────────────────────────────
auditRouter.post('/findings/:id/resolve', express.json({ limit: '1mb' }), (req, res) => {
  const finding = FINDINGS_LOG.find(f => f.id === req.params.id);
  if (!finding) return res.status(404).json({ error: 'finding not found' });
  finding.status = 'resolved';
  finding.resolvedAt = new Date().toISOString();
  res.json(finding);
});

// ── GET /api/audit/history ───────────────────────────────────────────────────
// Metadata-only list, most recent first — for an eventual history panel.
auditRouter.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, MAX_LOG);
  const list = AUDIT_LOG.slice(-limit).reverse().map(e => ({
    id: e.id, ts: e.ts, sector: e.sector, factor: e.factor,
    query: e.query, actor: e.actor, degraded: e.degraded
  }));
  res.json({ count: list.length, total: AUDIT_LOG.length, entries: list });
});

// ── GET /api/audit/:id ────────────────────────────────────────────────────────
auditRouter.get('/:id', (req, res) => {
  const entry = AUDIT_LOG.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: 'not found' });
  res.json(entry);
});

module.exports = { chatRouter, auditRouter };