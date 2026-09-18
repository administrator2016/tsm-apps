// routes/rcm-relay.js
//
// Server-side staging for the FinOps Doc Showcase → TSM RCM OS relay.
//
// Showcase fires all 4 engines on a document, then POSTs the result here.
// RCM OS polls/GETs on load to pick up the latest staged analysis and route
// each piece (triage, variance, action plan, executive) to the module that
// owns handling it. This is a thin staging layer, not a database — swap the
// in-memory store below for your persistence layer of choice (Mongo,
// Postgres, Redis, etc.) when ready; the route contract stays the same.
//
// Mount in server.js:
//   const rcmRelayRouter = require('./routes/rcm-relay');
//   app.use('/api/rcm', rcmRelayRouter);
//
// Endpoints:
//   POST   /api/rcm/relay        — showcase pushes a new analysis payload
//   GET    /api/rcm/relay        — rcm-os fetches the latest staged payload
//   GET    /api/rcm/relay/:id    — fetch a specific staged payload by id
//   GET    /api/rcm/relay/history — list of recent staged payloads (metadata only)
//   DELETE /api/rcm/relay        — clear the current staged payload
//   POST   /api/rcm/guidance     — proactive severity / next-best-action engine
//                                  (ranked, explainable action list for the AI Assistant)

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ── AUTH: shared-secret gate for mutating endpoints ──────────────────────
// Shared with server.js via middleware/require-api-key.js.
// See html/config/tsm-client-key.js for the client-side key this checks against.
const { requireAuth } = require('../middleware/require-auth');

// ── In-memory staging store ────────────────────────────────────────────────
// Swap for a real store when ready. Keeps the last N relays so RCM OS can
// show intake history, not just the single latest handoff.
const MAX_HISTORY = 25;
let relayHistory = []; // newest first
let current = null;    // pointer to the latest staged relay

function stageId() {
  return crypto.randomBytes(6).toString('hex');
}

function summarize(entry) {
  return {
    id: entry.id,
    docName: entry.docName,
    generatedAt: entry.generatedAt,
    receivedAt: entry.receivedAt,
    hasTriage: !!(entry.engines && entry.engines.triage),
    hasVariance: !!(entry.engines && entry.engines.variance),
    hasActionPlan: !!(entry.engines && entry.engines.actionPlan),
    hasExecutive: !!(entry.engines && entry.engines.executive)
  };
}

// ── POST /api/rcm/relay ─────────────────────────────────────────────────────
// Body: { docName, generatedAt, engines: { triage, variance, actionPlan, executive } }
router.post('/relay', requireAuth, express.json({ limit: '2mb' }), (req, res) => {
  const body = req.body || {};

  if (!body.docName || !body.engines) {
    return res.status(400).json({
      error: { message: 'Payload must include docName and an engines object.' }
    });
  }

  const entry = {
    id: stageId(),
    docName: String(body.docName).slice(0, 200),
    generatedAt: body.generatedAt || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    engines: {
      triage: (body.engines.triage || '').slice(0, 20000),
      variance: (body.engines.variance || '').slice(0, 20000),
      actionPlan: (body.engines.actionPlan || '').slice(0, 20000),
      executive: (body.engines.executive || '').slice(0, 20000)
    }
  };

  relayHistory.unshift(entry);
  if (relayHistory.length > MAX_HISTORY) relayHistory = relayHistory.slice(0, MAX_HISTORY);
  current = entry;

  res.json({ ok: true, id: entry.id, receivedAt: entry.receivedAt });
});

// ── GET /api/rcm/relay ───────────────────────────────────────────────────────
// Returns the latest staged relay, or 204 if nothing has been staged yet.
// TSM FIX: this had no auth guard at all, unlike the write endpoints on this
// same router (POST/DELETE /relay, POST /guidance), which already correctly
// use requireAuth. Confirmed as a genuine data exposure, not just a hygiene
// gap: real staged FinOps document analysis (docName + engine narrative
// text, which can include account/variance figures) was readable by any
// unauthenticated caller. No front-end change needed: rcm-relay-client.js's
// load() already calls fetch() with credentials:'include', so the existing
// session cookie is carried automatically.
router.get('/relay', requireAuth, (req, res) => {
  if (!current) return res.status(204).end();
  res.json(current);
});

// ── GET /api/rcm/relay/history ──────────────────────────────────────────────
// Metadata only — for an intake history list in the UI.
// TSM FIX: same auth gap as GET /relay above.
router.get('/relay/history', requireAuth, (req, res) => {
  res.json({ items: relayHistory.map(summarize) });
});

// ── GET /api/rcm/relay/:id ───────────────────────────────────────────────────
// TSM FIX: same auth gap as GET /relay above.
router.get('/relay/:id', requireAuth, (req, res) => {
  const entry = relayHistory.find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ error: { message: 'Not found.' } });
  res.json(entry);
});

// ── DELETE /api/rcm/relay ────────────────────────────────────────────────────
// Clears the "current" pointer (used by the RCM OS "Clear intake" button).
// History is left intact so past intakes are still browsable.
router.delete('/relay', requireAuth, (req, res) => {
  current = null;
  res.json({ ok: true });
});

// ── POST /api/rcm/guidance ────────────────────────────────────────────────────
// The proactive severity / next-best-action engine behind the AI Assistant's
// briefing and the "Proactive Guidance" card. Takes the raw engine narratives
// (triage/variance/actionPlan/executive — free text, not pre-structured) plus
// live workspace stats, and returns a ranked, explainable action list:
//   { items: [{ id, severity, title, summary, tool, nextAction,
//               why, gain, riskOfInaction }] }
// severity is one of critical|high|medium|low (matches .sev-badge CSS).
//
// Body: { engines: { triage, variance, actionPlan, executive },
//          stats: { openExceptions, pctComplete, docName },
//          selfReported: [{ phase, tool, field, value, reportedAt }] }
// selfReported comes from the Task Data Requirements Registry (see
// routes/rcm-requirements.js) — EU-entered values, never verified against a
// live source. The prompt below is explicit that these are self-reported so
// the model doesn't present them with false certainty.
router.post('/guidance', requireAuth, express.json({ limit: '1mb' }), async (req, res) => {
  const { engines = {}, stats = {}, selfReported = [] } = req.body || {};
  const hasAnyEngineText = ['triage', 'variance', 'actionPlan', 'executive'].some(k => (engines[k] || '').trim());
  const hasSelfReported = Array.isArray(selfReported) && selfReported.length > 0;

  if (!process.env.GROQ_API_KEY) {
    return res.json({ items: heuristicGuidance(engines, stats, selfReported), degraded: true, reason: 'GROQ_API_KEY not configured on server' });
  }
  if (!hasAnyEngineText && !stats.openExceptions && !hasSelfReported) {
    return res.json({ items: [] });
  }

  const prompt = buildGuidancePrompt(engines, stats, selfReported);

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b',
        messages: [
          {
            role: 'system',
            content: 'You are the TSM RCM OS proactive guidance engine. Return JSON only — no ' +
              'prose, no markdown fences, no mention of provider/model. Read the raw analysis ' +
              'text and any self-reported field values given, and turn it into a ranked list of ' +
              'concrete, specific issues an End User (EU) needs to act on. Never invent numbers ' +
              'or facts not present in the input. Self-reported values are EU-entered, not ' +
              'verified against a live system — when you reference one, phrase it accordingly ' +
              '(e.g. "self-reported open flag count is 3"), never as a confirmed/audited figure.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        max_tokens: 1400
      })
    });

    if (!upstream.ok) {
      return res.json({ items: heuristicGuidance(engines, stats), degraded: true, reason: `Upstream ${upstream.status}` });
    }
    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content || '';
    let parsed;
    try {
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      return res.json({ items: heuristicGuidance(engines, stats), degraded: true, reason: 'Could not parse model output' });
    }
    const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 8) : heuristicGuidance(engines, stats);
    return res.json({ items, degraded: false });
  } catch (err) {
    return res.json({ items: heuristicGuidance(engines, stats), degraded: true, reason: err.message });
  }
});

function buildGuidancePrompt(engines, stats, selfReported = []) {
  const selfReportedBlock = selfReported.length
    ? selfReported.map(sr => `- [${sr.phase}, source: self-reported ${new Date(sr.reportedAt).toLocaleDateString()}] ${sr.field}: ${sr.value} (owning tool: ${sr.tool})`).join('\n')
    : '(none entered yet)';

  return `Workspace stats: ${JSON.stringify(stats)}

Self-reported field values (EU-entered, NOT verified against a live source — treat as unverified input, not fact):
${selfReportedBlock}

Triage/Flags:
${(engines.triage || '(none)').slice(0, 3000)}

Variance/Risk:
${(engines.variance || '(none)').slice(0, 3000)}

Controller Action Plan:
${(engines.actionPlan || '(none)').slice(0, 3000)}

CFO Executive Intelligence:
${(engines.executive || '(none)').slice(0, 3000)}

Return JSON only, in this exact shape:
{
  "items": [
    {
      "id": "short-slug",
      "severity": "critical|high|medium|low",
      "title": "short specific issue name, reference real figures/accounts if given",
      "summary": "1-2 sentences on what this is, grounded in the text above",
      "tool": "one of: finops-operations.html, finops-accounting.html, compliance.html, finops-scenarios.html, finance-index.html, supplier-vendor-situation-room.html, logistics-situation-room.html",
      "nextAction": "the single concrete next step the EU should take, as an instruction",
      "why": "why this is the right route/tool for this issue specifically",
      "gain": "what's gained by acting on this now",
      "riskOfInaction": "what's at risk if this sits untouched"
    }
  ]
}
Rank items by severity (critical first). Only include issues actually supported by the text above — do not pad the list.`;
}

// Keyword-based fallback so the guidance card still shows *something* real
// (not fabricated) when Groq is unavailable — scans the raw text for
// explicit severity language rather than inventing structured findings.
function heuristicGuidance(engines, stats, selfReported = []) {
  const items = [];
  const sources = [
    { key: 'triage', tool: 'compliance.html', label: 'Triage flag' },
    { key: 'variance', tool: 'finops-accounting.html', label: 'Variance/risk item' },
    { key: 'actionPlan', tool: 'finops-operations.html', label: 'Controller action item' },
    { key: 'executive', tool: 'finance-index.html', label: 'Executive intelligence item' }
  ];
  const sevWords = [
    { re: /\bcritical\b/i, sev: 'critical' },
    { re: /\bhigh[- ]risk\b|\burgent\b/i, sev: 'high' },
    { re: /\bmedium\b|\bmoderate\b/i, sev: 'medium' }
  ];
  sources.forEach(s => {
    const text = engines[s.key];
    if (!text) return;
    const matched = sevWords.find(w => w.re.test(text));
    if (matched) {
      items.push({
        id: `${s.key}-flag`,
        severity: matched.sev,
        title: `${s.label} detected`,
        summary: text.slice(0, 200),
        tool: s.tool,
        nextAction: `Review the ${s.label.toLowerCase()} in ${s.tool.replace('.html', '')}.`,
        why: `This text was routed from the ${s.key} engine, which owns this category of issue.`,
        gain: 'Catching this now avoids it compounding into a larger reconciliation gap.',
        riskOfInaction: 'Left unaddressed, this stays open through the next cadence checkpoint.'
      });
    }
  });
  // Surface self-reported values that read as an open finding (not "0",
  // "none", "no", "n/a") rather than a clean status. Kept deliberately
  // simple in the fallback path — the Groq path above does the real
  // judgment call on what's worth surfacing.
  const nonIssueValues = new Set(['0', 'none', 'no', 'n/a', 'na', 'false', '']);
  selfReported.forEach(sr => {
    if (nonIssueValues.has(String(sr.value).trim().toLowerCase())) return;
    items.push({
      id: `self-reported-${sr.phase}-${sr.field}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      severity: 'medium',
      title: `${sr.field}: ${sr.value}`,
      summary: `Self-reported during ${sr.phase} on ${new Date(sr.reportedAt).toLocaleDateString()} — not yet verified against a live source.`,
      tool: /\.html\b/.test(sr.tool) ? sr.tool.split(/\s*\+\s*/)[0].trim() : 'compliance.html',
      nextAction: `Follow up on "${sr.field}" in ${sr.tool}.`,
      why: `This value was self-reported for the ${sr.phase} phase, which owns this check.`,
      gain: 'Acting on self-reported findings before they age keeps the cadence honest.',
      riskOfInaction: 'Self-reported issues left untouched won\'t self-resolve and will still be open at the next checkpoint.'
    });
  });

  if ((stats.openExceptions || 0) > 0) {
    items.push({
      id: 'open-exceptions',
      severity: stats.openExceptions > 5 ? 'high' : 'medium',
      title: `${stats.openExceptions} open exception${stats.openExceptions === 1 ? '' : 's'} requiring sign-off`,
      summary: 'Exceptions are pending review across the current cadence.',
      tool: 'compliance.html',
      nextAction: 'Open Compliance Desk and clear or escalate each pending exception.',
      why: 'Compliance Desk is the module of record for exception sign-off.',
      gain: 'Clearing exceptions on schedule keeps the audit trail clean.',
      riskOfInaction: 'Unsigned exceptions block month-end close.'
    });
  }
  return items;
}

module.exports = router;
