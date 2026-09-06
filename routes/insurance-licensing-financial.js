// routes/insurance-licensing-financial.js
//
// Server-side lapsed-license revenue-at-risk + CE non-compliance fine
// computation AND AI analysis for the Insurance Licensing & CE domain. Same
// private-rate-card-server-side-only pattern as
// routes/insurance-claims-financial.js, generalized to Licensing's two
// entity kinds (producer_licenses, ce_requirements).
//
// Two disclosed dollar signals:
//   1. lapsed_license_revenue_at_risk — flat commission-at-risk estimate per
//                                        license expiring within the risk
//                                        window
//   2. ce_noncompliance_fine          — flat fine per deficient CE hour, only
//                                        for requirements past their
//                                        deadline window
//
// The rate card lives only in
// server/private-config/insurance/licensing-financial-model.json and is
// never sent to the client — only the *computed* dollar totals are.
//
// Mount in server.js:
//   app.use('/api/insurance/licensing', requireAnyAuth, require('./routes/insurance-licensing-financial'));
//
// Endpoints:
//   POST /api/insurance/licensing/financial-summary
//   Body: { kpis, producer_licenses: [{agent_ref,state,license_type,expires_in_days},...], ce_requirements: [{agent_ref,course,hours_required,hours_completed,deadline_days},...] }
//   Response: { currency, lapsed_license_revenue_at_risk_total, lapsed_license_revenue_at_risk_items, ce_noncompliance_fine_total, ce_noncompliance_fine_items, total_exposure, note, license_confidence, ce_confidence }
//
//   POST /api/insurance/licensing/analysis
//   Body: { kpis, producer_licenses, ce_requirements, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env: GROQ_API_KEY, TSM_INSURANCE_MODEL (see insurance-claims-financial.js header)

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'insurance', 'licensing-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[insurance-licensing-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_INSURANCE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const LICENSING_SYSTEM_PROMPT =
  'You are a producer-licensing and CE-compliance prioritization AI for an insurance agency. ' +
  'Expert in state license renewal timelines and continuing-education requirements. Given ' +
  'structured license and CE data plus computed dollar exposure, identify which agents are at ' +
  'highest risk of a lapsed license or CE non-compliance, and recommend the specific next ' +
  'action per agent, prioritized by days-to-expiry and dollar exposure. Reference agent ' +
  'references by agent_ref. Be precise and operational. No preamble. For any deadline: use ' +
  'only a date or day-count explicitly present in the data provided — never calculate, ' +
  'estimate, or infer one.';

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

function lapsedLicenseRevenueAtRisk(licenses) {
  if (!RATE_CARD || RATE_CARD.lapsed_license_revenue_at_risk_per_license == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const perLicense = RATE_CARD.lapsed_license_revenue_at_risk_per_license;
  const window = RATE_CARD.license_expiry_risk_window_days != null ? RATE_CARD.license_expiry_risk_window_days : 30;
  const items = (licenses || [])
    .filter(l => (l.expires_in_days != null ? l.expires_in_days : 9999) <= window)
    .map(l => ({ agent_ref: l.agent_ref, state: l.state, license_type: l.license_type, expires_in_days: l.expires_in_days, exposure: perLicense }))
    .sort((a, b) => (a.expires_in_days || 0) - (b.expires_in_days || 0));
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function ceNoncomplianceFine(ceItems) {
  if (!RATE_CARD || RATE_CARD.ce_noncompliance_fine_per_deficient_hour == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const perHour = RATE_CARD.ce_noncompliance_fine_per_deficient_hour;
  const items = (ceItems || [])
    .map(c => {
      const deficientHours = Math.max(0, (c.hours_required || 0) - (c.hours_completed || 0));
      return { agent_ref: c.agent_ref, course: c.course, deficient_hours: deficientHours, deadline_days: c.deadline_days, exposure: Math.round(deficientHours * perHour) };
    })
    .filter(it => it.deficient_hours > 0)
    .sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 85, note: note || ' Modeled estimate — see rate card note for calibration guidance.' };
}

router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'licensing financial model unavailable' });
  }
  const { producer_licenses, ce_requirements } = req.body || {};
  const licenses = asArray(producer_licenses);
  const ceItems = asArray(ce_requirements);

  const licenseRisk = lapsedLicenseRevenueAtRisk(licenses);
  const ceFine = ceNoncomplianceFine(ceItems);

  res.json({
    currency: licenseRisk.currency || ceFine.currency || 'USD',
    lapsed_license_revenue_at_risk_total: licenseRisk.total,
    lapsed_license_revenue_at_risk_items: licenseRisk.items,
    ce_noncompliance_fine_total: ceFine.total,
    ce_noncompliance_fine_items: ceFine.items,
    total_exposure: licenseRisk.total + ceFine.total,
    note: RATE_CARD.note || null,
    license_confidence: confidenceFor(
      RATE_CARD.lapsed_license_revenue_at_risk_per_license != null,
      ' Average commission-per-license assumption — calibrate to your agency\'s actual figures.'
    ),
    ce_confidence: confidenceFor(RATE_CARD.ce_noncompliance_fine_per_deficient_hour != null)
  });
});

router.post('/analysis', async (req, res) => {
  const { kpis, producer_licenses, ce_requirements, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, producer_licenses, ce_requirements,
    counts: {
      producer_licenses: Array.isArray(producer_licenses) ? producer_licenses.length : undefined,
      ce_requirements: Array.isArray(ce_requirements) ? ce_requirements.length : undefined
    }
  }, null, 2);
  const prompt = `Current Licensing & CE snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify which agents are at highest risk of a lapsed license or CE non-compliance, and recommend the single most important next action for each. Reference agent_ref.`;

  const { text, degraded, reason } = await callGroq(LICENSING_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
