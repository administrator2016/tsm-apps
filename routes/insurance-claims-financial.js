// routes/insurance-claims-financial.js
//
// Server-side reserve-risk exposure computation AND AI triage analysis for
// the Insurance Claims & Appeals domain. First of six Insurance domains to
// get real backend wiring, same private-rate-card-server-side-only pattern
// as routes/college-bursar-financial.js, generalized to Claims' two entity
// kinds (claims, appeals).
//
// Two disclosed dollar signals, both probabilistic risk estimates (not
// certain losses — confidence/note says so explicitly):
//   1. reserve_adequacy_risk  — reserve_amount × severity-band risk rate
//   2. appeal_handling_cost   — flat per-open-appeal handling cost
//
// The rate card lives only in
// server/private-config/insurance/claims-financial-model.json and is never
// sent to the client — only the *computed* dollar totals are.
//
// Mount in server.js:
//   app.use('/api/insurance/claims', requireAnyAuth, require('./routes/insurance-claims-financial'));
//
// Endpoints:
//   POST /api/insurance/claims/financial-summary
//   Body: { kpis, claims: [{claim_id,policy_ref,line,severity,days_open,reserve_amount},...], appeals: [{appeal_id,claim_ref,reason,severity,days_pending},...] }
//   Response: { currency, reserve_adequacy_risk_total, reserve_adequacy_risk_items, appeal_handling_cost_total, appeal_handling_cost_items, total_reserve_amount, total_exposure, note, reserve_confidence, appeal_confidence }
//
//   POST /api/insurance/claims/analysis
//   Body: { kpis, claims, appeals, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env:
//   GROQ_API_KEY        — required for real AI output on /analysis (falls
//                          back to a clearly-labeled degraded response
//                          otherwise, still returns 200)
//   TSM_INSURANCE_MODEL — optional override for /analysis, defaults to
//                          TSM_FINANCE_MODEL, then 'openai/gpt-oss-120b'

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'insurance', 'claims-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[insurance-claims-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_INSURANCE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const CLAIMS_SYSTEM_PROMPT =
  'You are a claims triage and reserve-adequacy AI for a P&C insurance carrier. ' +
  'Expert in claim aging, reserve development risk, and appeal prioritization. Given ' +
  'structured claims and appeals data plus computed dollar exposure, identify the ' +
  'highest-priority open claims by combined age and reserve risk, flag appeals that may ' +
  'indicate a systemic denial issue if the same reason recurs, and recommend the specific ' +
  'next action per at-risk claim, prioritized by days-open and reserve exposure. Reference ' +
  'claim/appeal IDs. Be precise and operational. No preamble. For any deadline: use only a ' +
  'date or day-count explicitly present in the data provided — never calculate, estimate, or ' +
  'infer one. Only state a claim as closed or resolved if the data confirms it.';

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

// Guards against a caller sending a non-array, or an array containing
// non-object entries (blank rows from a CSV/JSON upload) — same lesson as
// college-bursar-financial.js's asArray().
function asArray(x) {
  return Array.isArray(x) ? x.filter(item => item != null && typeof item === 'object') : [];
}

function normalizedSeverity(sev) {
  const s = String(sev || '').toUpperCase();
  return ['LOW', 'MEDIUM', 'HIGH'].includes(s) ? s : 'MEDIUM';
}

function reserveAdequacyRisk(claims) {
  if (!RATE_CARD || !RATE_CARD.reserve_adequacy_risk_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.reserve_adequacy_risk_by_severity;
  const items = (claims || []).map(c => {
    const band = normalizedSeverity(c.severity);
    const rate = bands[band] != null ? bands[band] : 0;
    const exposure = Math.round((c.reserve_amount || 0) * rate);
    return { id: c.claim_id, policy_ref: c.policy_ref, severity: band, reserve_amount: c.reserve_amount || 0, risk_rate: rate, exposure };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function appealHandlingCost(appeals) {
  if (!RATE_CARD || RATE_CARD.appeal_handling_cost_per_appeal == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const perAppeal = RATE_CARD.appeal_handling_cost_per_appeal;
  const items = (appeals || []).map(a => ({
    id: a.appeal_id, claim_ref: a.claim_ref, reason: a.reason, days_pending: a.days_pending, exposure: perAppeal
  })).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 90, note: note || ' Modeled estimate — see rate card note for calibration guidance.' };
}

router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'claims financial model unavailable' });
  }
  const { claims, appeals } = req.body || {};
  const claimList = asArray(claims);
  const appealList = asArray(appeals);

  const reserveRisk = reserveAdequacyRisk(claimList);
  const appealCost = appealHandlingCost(appealList);
  const totalReserveAmount = claimList.reduce((sum, c) => sum + (c.reserve_amount || 0), 0);

  res.json({
    currency: reserveRisk.currency || appealCost.currency || 'USD',
    reserve_adequacy_risk_total: reserveRisk.total,
    reserve_adequacy_risk_items: reserveRisk.items,
    appeal_handling_cost_total: appealCost.total,
    appeal_handling_cost_items: appealCost.items,
    total_reserve_amount: totalReserveAmount,
    total_exposure: reserveRisk.total + appealCost.total,
    note: RATE_CARD.note || null,
    reserve_confidence: confidenceFor(
      !!RATE_CARD.reserve_adequacy_risk_by_severity,
      ' Probabilistic estimate of reserve-development risk, not a certain shortfall — do not report as realized loss.'
    ),
    appeal_confidence: confidenceFor(RATE_CARD.appeal_handling_cost_per_appeal != null)
  });
});

router.post('/analysis', async (req, res) => {
  const { kpis, claims, appeals, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, claims, appeals,
    counts: {
      claims: Array.isArray(claims) ? claims.length : undefined,
      appeals: Array.isArray(appeals) ? appeals.length : undefined
    }
  }, null, 2);
  const prompt = `Current Claims & Appeals snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-priority open claims and any appeal patterns worth flagging, and recommend the single most important next action for each at-risk claim. Reference claim/appeal IDs.`;

  const { text, degraded, reason } = await callGroq(CLAIMS_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
