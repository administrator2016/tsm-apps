// routes/college-research-fa-financial.js
//
// Server-side financial exposure computation AND AI compliance analysis for
// the College Research / F&A war room. Mirrors college-bursar-financial.js's
// pattern: private server-side rate card → computed dollar exposure → real
// Groq analysis with graceful degradation, 0 client-side keys.
//
// Mount in server.js:
//   app.use('/api/college/research-fa', requireAnyAuth, require('./routes/college-research-fa-financial'));
//
// Endpoints:
//   POST /api/college/research-fa/financial-summary
//   Body: {
//     kpis,
//     awards: [{ award_id, pi, sponsor, severity, planned_budget, actual_spend }, ...],
//     effort_reports: [{ report_id, pi, award, severity, days_overdue }, ...],
//     fa_recovery_shortfall  // institution-reported indirect-cost recovery shortfall, passed through like Bursar's total_ar_balance
//   }
//   Response:
//   {
//     currency, overburn_exposure_total, overburn_exposure_items,
//     effort_noncompliance_exposure_total, effort_noncompliance_exposure_items,
//     fa_recovery_shortfall, total_exposure, note,
//     overburn_confidence, effort_confidence
//   }
//
//   POST /api/college/research-fa/analysis
//   Body: { kpis, awards, effort_reports, fa_recovery_shortfall, context, maxTokens }
//   Response: { ok, answer, degraded, createdAt }
//
// Env:
//   GROQ_API_KEY       — required for real AI output (falls back to a
//                         clearly-labeled degraded response otherwise, still 200)
//   TSM_COLLEGE_MODEL  — optional override, defaults to TSM_FINANCE_MODEL, then 'openai/gpt-oss-120b'

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'college', 'research-fa-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[college-research-fa-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_COLLEGE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const RESEARCH_FA_SYSTEM_PROMPT =
  'You are a sponsored-research compliance and financial-risk AI for a college research office. ' +
  'Expert in award burn-rate management, indirect cost (F&A) recovery, and effort reporting/certification ' +
  'compliance. Given structured award and effort-report data, quantify audit/disallowance exposure from ' +
  'over-burn awards, flag effort-certification compliance risk, and recommend the specific next action per ' +
  'at-risk award or report, prioritized by severity and dollar exposure. Reference award/report IDs. Be ' +
  'precise and operational. No preamble. For any deadline: use only a date or day-count explicitly present ' +
  'in the data provided — never calculate, estimate, or infer one. Only state an award or report as resolved ' +
  'or cleared if the data confirms it — anything shown as open, overdue, or flagged must be listed as ' +
  'still-needed, not treated as resolved.';

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

// Overburn exposure: computed server-side from actual_spend - planned_budget
// (only positive variance counts), scaled by a per-severity rate from the
// private rate card. Severity is trusted as given (same as Bursar's
// aging-band derivation being computed rather than trusted would be the
// stricter option — if callers can spoof `severity`, consider deriving it
// server-side from the variance % instead, the way agingBandFor() derives
// Bursar's band from days_past_due rather than trusting a caller field).
// Guards against a caller sending a non-array for a field that's normally
// an array (e.g. a malformed upload or upstream parser bug) — without this,
// (x || []).map(...)/.filter(...) still throws when x is truthy but not an
// array (a string, object, or number), crashing the request with an
// unhandled 500 instead of the graceful, always-200 behavior these routes
// intend.
function asArray(x) {
  return Array.isArray(x) ? x : [];
}

function overburnExposure(awards) {
  if (!RATE_CARD || !RATE_CARD.overburn_exposure_rate_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rates = RATE_CARD.overburn_exposure_rate_by_severity;
  const items = (awards || [])
    .map(a => {
      const variance = Math.max(0, (a.actual_spend || 0) - (a.planned_budget || 0));
      const rate = rates[a.severity] != null ? rates[a.severity] : 0;
      const exposure = Math.round(variance * rate);
      return {
        id: a.award_id, pi: a.pi, sponsor: a.sponsor, severity: a.severity,
        planned_budget: a.planned_budget || 0, actual_spend: a.actual_spend || 0,
        variance, exposure
      };
    })
    .filter(it => it.variance > 0)
    .sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function effortNoncomplianceExposure(effortReports) {
  if (!RATE_CARD || RATE_CARD.effort_noncompliance_cost_per_day_overdue == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.effort_noncompliance_cost_per_day_overdue;
  const items = (effortReports || [])
    .filter(r => (r.days_overdue || 0) > 0)
    .map(r => {
      const days = Math.round(r.days_overdue || 0);
      const exposure = Math.round(days * rate);
      return { id: r.report_id, pi: r.pi, award: r.award, days_overdue: days, exposure };
    })
    .sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 90, note: note || ' Modeled estimate — see rate card note for calibration guidance.' };
}

// POST /api/college/research-fa/financial-summary
router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'research-fa financial model unavailable' });
  }
  const { awards, effort_reports, fa_recovery_shortfall } = req.body || {};

  const overburn = overburnExposure(asArray(awards));
  const effort = effortNoncomplianceExposure(asArray(effort_reports));
  const shortfall = Math.round(fa_recovery_shortfall || 0);

  res.json({
    currency: overburn.currency || effort.currency || 'USD',
    overburn_exposure_total: overburn.total,
    overburn_exposure_items: overburn.items,
    effort_noncompliance_exposure_total: effort.total,
    effort_noncompliance_exposure_items: effort.items,
    fa_recovery_shortfall: shortfall,
    total_exposure: overburn.total + effort.total + shortfall,
    note: RATE_CARD.note || null,
    overburn_confidence: confidenceFor(
      !!RATE_CARD.overburn_exposure_rate_by_severity,
      ' Probabilistic disallowance-risk estimate based on budget variance, not a certain loss.'
    ),
    effort_confidence: confidenceFor(
      RATE_CARD.effort_noncompliance_cost_per_day_overdue != null,
      ' Modeled compliance-remediation cost — calibrate to your institution\'s actual audit-finding cost.'
    )
  });
});

// POST /api/college/research-fa/analysis
router.post('/analysis', async (req, res) => {
  const { kpis, awards, effort_reports, fa_recovery_shortfall, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, awards, effort_reports, fa_recovery_shortfall,
    counts: {
      awards: Array.isArray(awards) ? awards.length : undefined,
      effort_reports: Array.isArray(effort_reports) ? effort_reports.length : undefined
    }
  }, null, 2);
  const prompt = `Current Research / F&A snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-priority over-burn awards and overdue effort reports, quantify audit/disallowance risk, and recommend the single most important next action for each at-risk award or report. Reference award/report IDs.`;

  const { text, degraded, reason } = await callGroq(RESEARCH_FA_SYSTEM_PROMPT, prompt, maxTokens || 900);
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