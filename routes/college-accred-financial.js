// routes/college-accred-financial.js
//
// Server-side READINESS RISK SCORING (not dollar exposure — see note below)
// and AI compliance analysis for the College Accreditation war room.
//
// Deliberately does not compute a dollar exposure total. The original
// college-accred-command.html sample-data comment already establishes this:
// "No dollar exposure math here (accreditation risk isn't a financial-
// penalty domain the way R2T4/verification/cohort-default are)." This route
// keeps that intent rather than inventing a fabricated dollar figure just to
// match the shape of the other four college domains. Instead it computes a
// server-side points-based readiness risk score from a private rate card —
// same "private rate card → real computation → real Groq analysis, 0
// client-side keys" pattern as Bursar/Endowment/Research-F&A, just scored
// in points instead of currency.
//
// Mount in server.js:
//   app.use('/api/college/accred', requireAnyAuth, require('./routes/college-accred-financial'));
//
// Endpoints:
//   POST /api/college/accred/readiness-summary
//   Body: {
//     kpis,
//     findings: [{ finding_id, standard, severity, days_open, owner }, ...],
//     standards_at_risk: [{ standard_id, description, severity }, ...],
//     days_to_site_visit
//   }
//   Response:
//   {
//     findings_risk_total, findings_risk_items,
//     standards_risk_total, standards_risk_items,
//     site_visit_proximity_bonus, days_to_site_visit,
//     total_readiness_risk_score, note,
//     findings_confidence, standards_confidence
//   }
//
//   POST /api/college/accred/analysis
//   Body: { kpis, findings, standards_at_risk, days_to_site_visit, context, maxTokens }
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

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'college', 'accred-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[college-accred-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_COLLEGE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const ACCRED_SYSTEM_PROMPT =
  'You are an accreditation compliance and risk AI for a college accreditation office. Given open ' +
  'findings, standards at risk, and days remaining to the next site visit, quantify readiness risk, ' +
  'flag which findings or standards are most likely to escalate to a formal sanction (warning, ' +
  'probation, show-cause) if unresolved before the site visit, and recommend the single most ' +
  'important next action per at-risk item, prioritized by severity and days-open relative to the ' +
  'site-visit deadline. Reference finding/standard IDs. Be precise and operational. No preamble. For ' +
  'any deadline: use only a date or day-count explicitly present in the data provided — never ' +
  'calculate, estimate, or infer one. Only state a finding or standard as resolved or cleared if the ' +
  'data confirms it — anything shown as open or at-risk must be listed as still-needed, not treated ' +
  'as resolved.';

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

function findingsRisk(findings) {
  if (!RATE_CARD || !RATE_CARD.finding_severity_points) {
    return { total: 0, items: [] };
  }
  const points = RATE_CARD.finding_severity_points;
  const perDayPastDue = RATE_CARD.finding_days_open_multiplier_per_day_past_45 || 0;
  const items = (findings || []).map(f => {
    const base = points[f.severity] != null ? points[f.severity] : 0;
    const daysOpen = Math.round(f.days_open || 0);
    const overdueDays = Math.max(0, daysOpen - 45);
    const overdueBonus = Math.round(overdueDays * perDayPastDue);
    const score = base + overdueBonus;
    return {
      id: f.finding_id, standard: f.standard, severity: f.severity,
      days_open: daysOpen, owner: f.owner, score
    };
  }).sort((a, b) => b.score - a.score);
  return { total: items.reduce((s, it) => s + it.score, 0), items };
}

function standardsRisk(standards) {
  if (!RATE_CARD || !RATE_CARD.standard_severity_points) {
    return { total: 0, items: [] };
  }
  const points = RATE_CARD.standard_severity_points;
  const items = (standards || []).map(s => {
    const score = points[s.severity] != null ? points[s.severity] : 0;
    return { id: s.standard_id, description: s.description, severity: s.severity, score };
  }).sort((a, b) => b.score - a.score);
  return { total: items.reduce((s, it) => s + it.score, 0), items };
}

function siteVisitProximityBonus(daysToSiteVisit) {
  if (!RATE_CARD || RATE_CARD.site_visit_proximity_bonus_days_threshold == null) return 0;
  const days = Number(daysToSiteVisit);
  if (!Number.isFinite(days)) return 0;
  return days <= RATE_CARD.site_visit_proximity_bonus_days_threshold
    ? (RATE_CARD.site_visit_proximity_bonus_points || 0)
    : 0;
}

function confidenceFor(rateCardKeyPresent, note) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so this component defaulted to 0 points — treat as unverified.' };
  }
  return { confidence: 90, note: note || ' Modeled points-based estimate — see rate card note for calibration guidance.' };
}

// POST /api/college/accred/readiness-summary
router.post('/readiness-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'accreditation readiness model unavailable' });
  }
  const { findings, standards_at_risk, days_to_site_visit } = req.body || {};

  const findingsScore = findingsRisk(findings);
  const standardsScore = standardsRisk(standards_at_risk);
  const proximityBonus = siteVisitProximityBonus(days_to_site_visit);

  res.json({
    findings_risk_total: findingsScore.total,
    findings_risk_items: findingsScore.items,
    standards_risk_total: standardsScore.total,
    standards_risk_items: standardsScore.items,
    site_visit_proximity_bonus: proximityBonus,
    days_to_site_visit: days_to_site_visit != null ? Number(days_to_site_visit) : null,
    total_readiness_risk_score: findingsScore.total + standardsScore.total + proximityBonus,
    note: RATE_CARD.note || null,
    findings_confidence: confidenceFor(!!RATE_CARD.finding_severity_points),
    standards_confidence: confidenceFor(!!RATE_CARD.standard_severity_points)
  });
});

// POST /api/college/accred/analysis
router.post('/analysis', async (req, res) => {
  const { kpis, findings, standards_at_risk, days_to_site_visit, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis, findings, standards_at_risk, days_to_site_visit,
    counts: {
      findings: Array.isArray(findings) ? findings.length : undefined,
      standards_at_risk: Array.isArray(standards_at_risk) ? standards_at_risk.length : undefined
    }
  }, null, 2);
  const prompt = `Current Accreditation snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-priority open findings and at-risk standards ahead of the next site visit, quantify readiness risk, and recommend the single most important next action for each item. Reference finding/standard IDs.`;

  const { text, degraded, reason } = await callGroq(ACCRED_SYSTEM_PROMPT, prompt, maxTokens || 900);
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