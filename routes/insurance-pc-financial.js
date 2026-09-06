// routes/insurance-pc-financial.js
//
// Server-side underwriting-review-cost + liability-reserve-risk computation
// AND AI analysis for the Insurance Property & Casualty domain. Same
// private-rate-card-server-side-only pattern as
// routes/insurance-claims-financial.js, generalized to P&C's two entity
// kinds (underwriting_submissions, liability_exposures).
//
// Two disclosed dollar signals:
//   1. senior_review_cost     — deterministic: flat cost per HIGH-severity
//                                submission needing senior underwriter review
//   2. liability_reserve_risk — probabilistic: reserve_amount ×
//                                severity-band risk rate
//
// The rate card lives only in
// server/private-config/insurance/pc-financial-model.json and is never sent
// to the client — only the *computed* dollar totals are.
//
// Mount in server.js:
//   app.use('/api/insurance/pc', requireAnyAuth, require('./routes/insurance-pc-financial'));
//
// Endpoints:
//   POST /api/insurance/pc/financial-summary
//   Body: { kpis, underwriting_submissions: [{submission_id,applicant,line,severity,premium_estimate,days_in_queue},...], liability_exposures: [{exposure_id,policy_ref,type,severity,reserve_amount},...] }
//   Response: { currency, senior_review_cost_total, senior_review_cost_items, liability_reserve_risk_total, liability_reserve_risk_items, total_premium_in_queue, total_exposure, note, review_confidence, reserve_confidence }
//
//   POST /api/insurance/pc/analysis
//   Body: { kpis, underwriting_submissions, liability_exposures, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env: GROQ_API_KEY, TSM_INSURANCE_MODEL (see insurance-claims-financial.js header)

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'insurance', 'pc-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[insurance-pc-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_INSURANCE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const PC_SYSTEM_PROMPT =
  'You are an underwriting and liability-reserve prioritization AI for a P&C insurance carrier. ' +
  'Expert in submission triage and liability/malpractice exposure. Given structured underwriting ' +
  'submission and liability exposure data plus computed dollar exposure, identify which ' +
  'submissions need senior underwriter attention first, flag liability exposures with the ' +
  'highest reserve risk, and recommend the specific next action per item, prioritized by ' +
  'severity and dollar exposure. Reference submission/exposure IDs. Be precise and operational. ' +
  'No preamble. For any deadline: use only a date or day-count explicitly present in the data ' +
  'provided — never calculate, estimate, or infer one.';

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

function seniorReviewCost(submissions) {
  if (!RATE_CARD || RATE_CARD.senior_review_cost_per_high_severity_submission == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const cost = RATE_CARD.senior_review_cost_per_high_severity_submission;
  const items = (submissions || [])
    .filter(s => normalizedSeverity(s.severity) === 'HIGH')
    .map(s => ({ id: s.submission_id, applicant: s.applicant, line: s.line, exposure: cost }))
    .sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function liabilityReserveRisk(exposures) {
  if (!RATE_CARD || !RATE_CARD.liability_reserve_risk_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.liability_reserve_risk_by_severity;
  const items = (exposures || []).map(e => {
    const band = normalizedSeverity(e.severity);
    const rate = bands[band] != null ? bands[band] : 0;
    const exposure = Math.round((e.reserve_amount || 0) * rate);
    return { id: e.exposure_id, policy_ref: e.policy_ref, type: e.type, severity: band, reserve_amount: e.reserve_amount || 0, risk_rate: rate, exposure };
  }).sort((a, b) => b.exposure - a.exposure);
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
    return res.status(500).json({ error: 'pc financial model unavailable' });
  }
  const { underwriting_submissions, liability_exposures } = req.body || {};
  const submissions = asArray(underwriting_submissions);
  const exposures = asArray(liability_exposures);

  const reviewCost = seniorReviewCost(submissions);
  const reserveRisk = liabilityReserveRisk(exposures);
  const totalPremiumInQueue = submissions.reduce((sum, s) => sum + (s.premium_estimate || 0), 0);

  res.json({
    currency: reviewCost.currency || reserveRisk.currency || 'USD',
    senior_review_cost_total: reviewCost.total,
    senior_review_cost_items: reviewCost.items,
    liability_reserve_risk_total: reserveRisk.total,
    liability_reserve_risk_items: reserveRisk.items,
    total_premium_in_queue: totalPremiumInQueue,
    total_exposure: reviewCost.total + reserveRisk.total,
    note: RATE_CARD.note || null,
    review_confidence: confidenceFor(RATE_CARD.senior_review_cost_per_high_severity_submission != null),
    reserve_confidence: confidenceFor(
      !!RATE_CARD.liability_reserve_risk_by_severity,
      ' Probabilistic estimate of reserve-development risk, not a certain shortfall — do not report as realized loss.'
    )
  });
});

router.post('/analysis', async (req, res) => {
  const { kpis, underwriting_submissions, liability_exposures, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, underwriting_submissions, liability_exposures,
    counts: {
      underwriting_submissions: Array.isArray(underwriting_submissions) ? underwriting_submissions.length : undefined,
      liability_exposures: Array.isArray(liability_exposures) ? liability_exposures.length : undefined
    }
  }, null, 2);
  const prompt = `Current Property & Casualty snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify which submissions need senior review first and which liability exposures carry the highest reserve risk, and recommend the single most important next action for each. Reference submission/exposure IDs.`;

  const { text, degraded, reason } = await callGroq(PC_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
