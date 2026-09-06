// routes/insurance-compliance-financial.js
//
// Server-side regulatory-fine + litigation-reserve computation AND AI
// analysis for the Insurance Compliance & Legal domain. Same
// private-rate-card-server-side-only pattern as
// routes/insurance-claims-financial.js, generalized to Compliance's two
// entity kinds (regulatory_findings, legal_matters).
//
// Two disclosed dollar signals:
//   1. regulatory_fine_exposure — flat fine estimate per finding, by severity
//   2. litigation_reserve       — flat reserve estimate per legal matter
//                                  currently in an active-litigation status,
//                                  by severity
//
// The rate card lives only in
// server/private-config/insurance/compliance-financial-model.json and is
// never sent to the client — only the *computed* dollar totals are.
//
// Mount in server.js:
//   app.use('/api/insurance/compliance', requireAnyAuth, require('./routes/insurance-compliance-financial'));
//
// Endpoints:
//   POST /api/insurance/compliance/financial-summary
//   Body: { kpis, regulatory_findings: [{finding_id,regulation,severity,days_open,jurisdiction},...], legal_matters: [{matter_id,type,severity,status,days_open},...] }
//   Response: { currency, regulatory_fine_exposure_total, regulatory_fine_exposure_items, litigation_reserve_total, litigation_reserve_items, total_exposure, note, fine_confidence, litigation_confidence }
//
//   POST /api/insurance/compliance/analysis
//   Body: { kpis, regulatory_findings, legal_matters, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env: GROQ_API_KEY, TSM_INSURANCE_MODEL (see insurance-claims-financial.js header)

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'insurance', 'compliance-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[insurance-compliance-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_INSURANCE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const COMPLIANCE_SYSTEM_PROMPT =
  'You are a regulatory-compliance and litigation-risk prioritization AI for an insurance carrier. ' +
  'Expert in NAIC market-conduct findings and coverage/bad-faith litigation. Given structured ' +
  'regulatory finding and legal matter data plus computed dollar exposure, identify the ' +
  'highest-priority open findings by severity and age, flag legal matters with the highest ' +
  'litigation reserve exposure, and recommend the specific next action per item. Reference ' +
  'finding/matter IDs. Be precise and operational. No preamble. For any deadline: use only a ' +
  'date or day-count explicitly present in the data provided — never calculate, estimate, or ' +
  'infer one. Only state a finding or matter as closed/resolved if the data confirms it.';

async function callGroq(systemPrompt, message, maxTokens = 900) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { text: null, degraded: true, reason: 'GROQ_API_KEY not configured on server' };
  try {
    const res = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        max_tokens: maxTokens,
        temperature: 0.25
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

function asArray(x) {
  return Array.isArray(x) ? x.filter(item => item != null && typeof item === 'object') : [];
}

function normalizedSeverity(sev) {
  const s = String(sev || '').toUpperCase();
  return ['LOW', 'MEDIUM', 'HIGH'].includes(s) ? s : 'MEDIUM';
}

function regulatoryFineExposure(findings) {
  if (!RATE_CARD || !RATE_CARD.regulatory_fine_exposure_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.regulatory_fine_exposure_by_severity;
  const items = (findings || []).map(f => {
    const band = normalizedSeverity(f.severity);
    const exposure = bands[band] != null ? bands[band] : 0;
    return { id: f.finding_id, regulation: f.regulation, jurisdiction: f.jurisdiction, severity: band, exposure };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function litigationReserve(matters) {
  if (!RATE_CARD || !RATE_CARD.litigation_reserve_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.litigation_reserve_by_severity;
  const activeStatuses = (RATE_CARD.litigation_reserve_active_statuses || []).map(s => s.toLowerCase());
  const items = (matters || [])
    .filter(m => activeStatuses.length === 0 || activeStatuses.includes(String(m.status || '').toLowerCase()))
    .map(m => {
      const band = normalizedSeverity(m.severity);
      const exposure = bands[band] != null ? bands[band] : 0;
      return { id: m.matter_id, type: m.type, status: m.status, severity: band, exposure };
    }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 70, note: note || ' Rough planning estimate, not a legal opinion — see rate card note for calibration guidance.' };
}

router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'compliance financial model unavailable' });
  }
  const { regulatory_findings, legal_matters } = req.body || {};
  const findings = asArray(regulatory_findings);
  const matters = asArray(legal_matters);

  const fineExposure = regulatoryFineExposure(findings);
  const litReserve = litigationReserve(matters);

  res.json({
    currency: fineExposure.currency || litReserve.currency || 'USD',
    regulatory_fine_exposure_total: fineExposure.total,
    regulatory_fine_exposure_items: fineExposure.items,
    litigation_reserve_total: litReserve.total,
    litigation_reserve_items: litReserve.items,
    total_exposure: fineExposure.total + litReserve.total,
    note: RATE_CARD.note || null,
    fine_confidence: confidenceFor(!!RATE_CARD.regulatory_fine_exposure_by_severity),
    litigation_confidence: confidenceFor(
      !!RATE_CARD.litigation_reserve_by_severity,
      ' Rough planning estimate only — not a substitute for actual legal counsel reserve-setting.'
    )
  });
});

router.post('/analysis', async (req, res) => {
  const { kpis, regulatory_findings, legal_matters, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, regulatory_findings, legal_matters,
    counts: {
      regulatory_findings: Array.isArray(regulatory_findings) ? regulatory_findings.length : undefined,
      legal_matters: Array.isArray(legal_matters) ? legal_matters.length : undefined
    }
  }, null, 2);
  const prompt = `Current Compliance & Legal snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-priority regulatory findings and legal matters, and recommend the single most important next action for each. Reference finding/matter IDs.`;

  const { text, degraded, reason } = await callGroq(COMPLIANCE_SYSTEM_PROMPT, prompt, maxTokens || 900);
  if (degraded) {
    return res.json({
      ok: true,
      answer: `AI analysis is temporarily unavailable (${reason}). Case data above is still accurate — please try again shortly.`,
      degraded: true,
      createdAt: new Date().toISOString()
    });
  }
  return res.json({ ok: true, answer: text, degraded: false, createdAt: new Date().toISOString() });
});

module.exports = router;
