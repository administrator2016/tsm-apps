// routes/college-bursar-financial.js
//
// Server-side AR exposure computation AND AI collections analysis for the
// College Bursar / Tuition war room. Second College domain to get real
// backend wiring (Financial Aid was first) — same
// private-rate-card-server-side-only pattern as
// routes/college-finaid-financial.js, generalized to Bursar's two entity
// kinds (payment_plans, registration_holds).
//
// Unlike Financial Aid's per-day statutory penalty, Bursar exposure is
// three separate real-world dollar signals, all disclosed on the response
// so a CFO can see exactly what's driving the number rather than one
// opaque total:
//   1. late_fee_exposure       — deterministic: days past due × per-day fee
//   2. writeoff_risk_exposure  — probabilistic: balance × aging-band
//                                 write-off rate (this is a RISK estimate,
//                                 not a certain loss — confidence/note
//                                 says so explicitly)
//   3. hold_revenue_at_risk    — deterministic: active holds × average
//                                 per-term tuition at risk if the hold
//                                 blocks re-enrollment
//
// The rate card lives only in
// server/private-config/college/bursar-financial-model.json and is never
// sent to the client — only the *computed* dollar totals are.
//
// AI analysis endpoint modeled on college-finaid-financial.js's /analysis
// (structured snapshot → domain system prompt → single Groq call) rather
// than on college-bursar-command.html's existing client-side
// proxy-then-direct-key callBursarAI() — that path works, but routes every
// case through the generic /api/chat endpoint with no domain-specific
// system prompt structure and no server-side exposure math behind it.
// This endpoint replaces it with the same resilient, always-200,
// structured pattern the other backed domain already uses.
//
// Mount in server.js:
//   app.use('/api/college/bursar', requireAnyAuth, require('./routes/college-bursar-financial'));
//
// Endpoints:
//   POST /api/college/bursar/financial-summary
//   Body: {
//     kpis: { open_payment_plans, plans_past_due, registration_holds_active },
//     payment_plans: [{ plan_id, student_ref, term, severity, days_past_due, balance }, ...],
//     registration_holds: [{ hold_id, student_ref, reason, severity, days_active }, ...]
//   }
//   Response:
//   {
//     currency, late_fee_exposure_total, late_fee_exposure_items,
//     writeoff_risk_exposure_total, writeoff_risk_exposure_items,
//     hold_revenue_at_risk_total, hold_revenue_at_risk_items,
//     total_ar_balance, total_exposure, note,
//     late_fee_confidence, writeoff_risk_confidence, hold_revenue_confidence
//   }
//
//   POST /api/college/bursar/analysis
//   Body: { kpis, payment_plans, registration_holds, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env:
//   GROQ_API_KEY          — required for real AI output on /analysis (falls
//                            back to a clearly-labeled degraded response
//                            otherwise, still returns 200)
//   TSM_COLLEGE_MODEL      — optional override for /analysis, defaults to
//                            TSM_FINANCE_MODEL, then 'openai/gpt-oss-120b'

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'college', 'bursar-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[college-bursar-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

// ── AI ANALYSIS ──────────────────────────────────────────────────────────
// Self-contained Groq call — same shape as college-finaid-financial.js's
// callGroq(), duplicated rather than shared because route files in this
// repo don't reach back into each other or into the server.js monolith.
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_COLLEGE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const BURSAR_SYSTEM_PROMPT =
  'You are a collections risk and prioritization AI for a college bursar/tuition office. ' +
  'Expert in payment-plan delinquency, AR aging, and registration holds. Given structured ' +
  'payment-plan and registration-hold data plus computed dollar exposure, identify the ' +
  'highest-priority accounts by combined delinquency and exposure, flag any registration ' +
  'holds that may be blocking re-enrollment inappropriately (e.g. a hold for a small balance ' +
  'blocking a student close to graduation), and recommend the specific next action per ' +
  'at-risk account (payment plan restructure, hold release conditions, escalation to ' +
  'collections), prioritized by days-past-due/days-active and dollar exposure. Reference ' +
  'plan/hold IDs. Be precise and operational. No preamble. For any deadline: use only a date ' +
  'or day-count explicitly present in the data provided — never calculate, estimate, or infer ' +
  'one. Only state an account as resolved or cleared if the data confirms it — anything shown ' +
  'as open or active must be listed as still-needed, not treated as resolved.';

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

// Aging bands keyed off days_past_due. Bands are uppercase/underscore in
// the rate card ('CURRENT'/'30_DAY'/'60_DAY'/'90_DAY_PLUS') — computed
// server-side from the raw day count rather than trusting a caller-supplied
// band label, same lesson as college-finaid-financial.js's rateForBand():
// an unnormalized or spoofable band field can silently mis-price real
// exposure.
function agingBandFor(daysPastDue) {
  const d = Number(daysPastDue) || 0;
  if (d <= 0) return 'CURRENT';
  if (d <= 30) return '30_DAY';
  if (d <= 60) return '60_DAY';
  return '90_DAY_PLUS';
}

// Guards against a caller sending a non-array for a field that's normally
// an array (e.g. a malformed upload or upstream parser bug) — without this,
// (x || []).filter(...)/.map(...) still throws when x is truthy but not an
// array (a string, object, or number), crashing the request with an
// unhandled 500 instead of the graceful, always-200 behavior these routes
// intend.
function asArray(x) {
  // Also drop null/undefined/non-object entries within an otherwise-valid
  // array (e.g. a blank row from a CSV/JSON upload parsed as null) —
  // mapping over those still throws "Cannot read properties of null"
  // even after the array-vs-non-array check above passes.
  return Array.isArray(x) ? x.filter(item => item != null && typeof item === 'object') : [];
}

function lateFeeExposure(plans) {
  if (!RATE_CARD || RATE_CARD.late_fee_accrual_per_day_past_due == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.late_fee_accrual_per_day_past_due;
  const items = (plans || [])
    .filter(p => (p.days_past_due || 0) > 0)
    .map(p => {
      const days = Math.round(p.days_past_due || 0);
      const exposure = Math.round(days * rate);
      return { id: p.plan_id, student_ref: p.student_ref, days_past_due: days, exposure };
    })
    .sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function writeoffRiskExposure(plans) {
  if (!RATE_CARD || !RATE_CARD.collections_writeoff_risk_by_aging_band) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.collections_writeoff_risk_by_aging_band;
  const items = (plans || []).map(p => {
    const band = agingBandFor(p.days_past_due);
    const rate = bands[band] != null ? bands[band] : 0;
    const exposure = Math.round((p.balance || 0) * rate);
    return { id: p.plan_id, student_ref: p.student_ref, aging_band: band, balance: p.balance || 0, risk_rate: rate, exposure };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function holdRevenueAtRisk(holds) {
  if (!RATE_CARD || RATE_CARD.registration_hold_revenue_at_risk_per_hold == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const perHold = RATE_CARD.registration_hold_revenue_at_risk_per_hold;
  const items = (holds || []).map(h => ({
    id: h.hold_id,
    student_ref: h.student_ref,
    reason: h.reason,
    days_active: h.days_active,
    exposure: perHold
  })).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 90, note: note || ' Modeled estimate — see rate card note for calibration guidance.' };
}

// POST /api/college/bursar/financial-summary
router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'bursar financial model unavailable' });
  }
  const { payment_plans, registration_holds } = req.body || {};
  const plans = asArray(payment_plans);
  const holds = asArray(registration_holds);

  const lateFee = lateFeeExposure(plans);
  const writeoffRisk = writeoffRiskExposure(plans);
  const holdRevenue = holdRevenueAtRisk(holds);
  const totalArBalance = plans.reduce((sum, p) => sum + (p.balance || 0), 0);

  res.json({
    currency: lateFee.currency || writeoffRisk.currency || holdRevenue.currency || 'USD',
    late_fee_exposure_total: lateFee.total,
    late_fee_exposure_items: lateFee.items,
    writeoff_risk_exposure_total: writeoffRisk.total,
    writeoff_risk_exposure_items: writeoffRisk.items,
    hold_revenue_at_risk_total: holdRevenue.total,
    hold_revenue_at_risk_items: holdRevenue.items,
    total_ar_balance: totalArBalance,
    total_exposure: lateFee.total + writeoffRisk.total + holdRevenue.total,
    note: RATE_CARD.note || null,
    late_fee_confidence: confidenceFor(RATE_CARD.late_fee_accrual_per_day_past_due != null),
    writeoff_risk_confidence: confidenceFor(
      !!RATE_CARD.collections_writeoff_risk_by_aging_band,
      ' Probabilistic estimate of expected write-off, not a certain loss — do not report as realized AR loss.'
    ),
    hold_revenue_confidence: confidenceFor(
      RATE_CARD.registration_hold_revenue_at_risk_per_hold != null,
      ' Average per-term tuition at risk assumption — calibrate to your institution\'s actual average.'
    )
  });
});

// POST /api/college/bursar/analysis
// Body: { kpis, payment_plans, registration_holds, context, maxTokens }
// Response: { ok, answer, degraded, createdAt }
// Always 200 — a degraded upstream returns a graceful placeholder answer
// (same resilience pattern as college-finaid-financial.js's /analysis)
// rather than a 500, since the case data above it on screen is still valid
// even when the AI call itself fails.
router.post('/analysis', async (req, res) => {
  const { kpis, payment_plans, registration_holds, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    payment_plans,
    registration_holds,
    counts: {
      payment_plans: Array.isArray(payment_plans) ? payment_plans.length : undefined,
      registration_holds: Array.isArray(registration_holds) ? registration_holds.length : undefined
    }
  }, null, 2);
  const prompt = `Current Bursar / Tuition collections snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-priority delinquent payment plans and registration holds, flag any holds that may be blocking re-enrollment inappropriately, and recommend the single most important next action for each at-risk account. Reference plan/hold IDs.`;

  const { text, degraded, reason } = await callGroq(BURSAR_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
