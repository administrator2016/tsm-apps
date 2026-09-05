// routes/college-finaid-financial.js
//
// Server-side financial exposure computation AND AI compliance analysis for
// the College Financial Aid (Title IV) war room.
//
// Endpoint 1 — POST /financial-summary: modeled directly on
// routes/schools-financial.js: same private-rate-card-server-side-only
// pattern, same items/total/confidence response shape, so the client engine
// and any downstream relay/strategist code that already knows how to render
// a Schools-style financial summary can render this one unchanged.
// The rate card lives only in server/private-config/college/financial-model.json
// and is never sent to the client — only the *computed* dollar totals are.
//
// Endpoint 2 — POST /analysis: modeled on server.js's /api/schools/analysis
// (structured snapshot → domain system prompt → single Groq call), not on
// schools-command.html's broken client-side callAI() — see the comment
// above FINAID_SYSTEM_PROMPT below for why that path was skipped.
//
// Mount in server.js:
//   app.use('/api/college/finaid', requireAnyAuth, require('./routes/college-finaid-financial'));
//
// Endpoints:
//   POST /api/college/finaid/financial-summary
//   Body: {
//     kpis: { active_pell_disbursed, ... },
//     r2t4_breaches: [{ id, student_ref, days_late, record }, ...],
//     verification_backlog: [{ id, student_ref, days_open, record }, ...],
//     cohort_default_flags: [{ id, band, program, record }, ...]
//   }
//   Response:
//   {
//     currency, r2t4_exposure_total, r2t4_exposure_items,
//     verification_exposure_total, verification_exposure_items,
//     cohort_default_exposure_total, cohort_default_exposure_items,
//     active_pell_disbursed, total_exposure, note,
//     r2t4_confidence, verification_confidence, cohort_default_confidence
//   }
//
//   POST /api/college/finaid/analysis
//   Body: { kpis, r2t4_breaches, verification_backlog, cohort_default_flags, context, maxTokens }
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

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'college', 'financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[college-finaid-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

// ── AI ANALYSIS ──────────────────────────────────────────────────────────
// Self-contained Groq call (same shape as routes/finance-chat.js's callGroq)
// rather than importing server.js's groqChat/SP — route files in this repo
// don't reach back into the server.js monolith. Modeled on the real,
// working /api/schools/analysis handler in server.js: structured JSON
// snapshot → domain system prompt → single Groq call. NOT modeled on
// schools-command.html's client-side callAI(), which posts a
// {messages,model,max_tokens} body that /api/chat's actual contract
// ({message, conversationHistory}) rejects with a 400 — that path silently
// degrades to a canned placeholder on every real call, so it isn't a
// pattern worth carrying forward.
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_COLLEGE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const FINAID_SYSTEM_PROMPT =
  'You are a Title IV Financial Aid compliance AI for a college Bursar/Financial Aid office. ' +
  'Expert in R2T4 (Return to Title IV Funds, 45-day federal deadline), verification (FAFSA/IRS ' +
  'data-match conflicts, Pell disbursement holds), and cohort default rate (CDR) monitoring. ' +
  'Given structured case data, KPIs, and SLA breaches, identify the highest-risk R2T4 and ' +
  'verification cases, quantify federal compliance exposure, and recommend the specific next ' +
  'action per at-risk case, prioritized by days-late/days-open and dollar exposure. Reference ' +
  'case/flag IDs. Be precise and operational. No preamble. For any deadline: use only a date or ' +
  'day-count explicitly present in the data provided — never calculate, estimate, or infer one. ' +
  'Only state a case as resolved or cleared if the data confirms it — anything shown as open, ' +
  'pending, or flagged must be listed as still-needed, not treated as resolved.';

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

function r2t4Exposure(breaches) {
  if (!RATE_CARD || RATE_CARD.r2t4_late_return_penalty_per_day == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.r2t4_late_return_penalty_per_day;
  const items = (breaches || []).map(b => {
    const days = Math.max(1, Math.round(b.days_late || 0));
    const exposure = Math.round(days * rate);
    return {
      id: b.id,
      student_ref: b.record && b.record.student_ref,
      days_late: days,
      exposure
    };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function verificationExposure(backlog) {
  if (!RATE_CARD || RATE_CARD.verification_backlog_cost_per_day == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.verification_backlog_cost_per_day;
  const items = (backlog || []).map(v => {
    const days = Math.max(1, Math.round(v.days_open || 0));
    const exposure = Math.round(days * rate);
    return {
      id: v.id,
      student_ref: v.record && v.record.student_ref,
      days_open: days,
      exposure
    };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

// Cohort-default bands are uppercase ('SANCTION'/'WARNING'/'WATCH') in the
// rate card. Normalize defensively — same lesson learned in
// schools-financial.js's rateForSeverity(), where an unnormalized case from
// an upstream feed silently priced real exposure at $0.
function rateForBand(bands, band) {
  if (!band) return null;
  if (bands[band] != null) return bands[band];
  const upper = String(band).toUpperCase();
  return bands[upper] != null ? bands[upper] : null;
}

function cohortDefaultExposure(flags) {
  if (!RATE_CARD || !RATE_CARD.cohort_default_exposure_by_band) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.cohort_default_exposure_by_band;
  const items = (flags || []).map(f => {
    const matched = rateForBand(bands, f.band);
    const rate = matched != null ? matched : 0;
    return { id: f.id, program: f.program, band: f.band, exposure: rate };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function confidenceFor(rateCardKeyPresent, missingLabelsNote) {
  if (!rateCardKeyPresent) {
    return { confidence: 30, note: ' Rate card is missing this key, so exposure defaulted to $0 — treat as unverified.' };
  }
  if (missingLabelsNote) {
    return { confidence: 65, note: missingLabelsNote };
  }
  return { confidence: 95, note: '' };
}

// POST /api/college/finaid/financial-summary
router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'financial model unavailable' });
  }
  const { kpis, r2t4_breaches, verification_backlog, cohort_default_flags } = req.body || {};

  const r2t4 = r2t4Exposure(r2t4_breaches);
  const verification = verificationExposure(verification_backlog);

  const bands = RATE_CARD.cohort_default_exposure_by_band || {};
  const seenBands = [...new Set((cohort_default_flags || []).map(f => f.band).filter(Boolean))];
  const missingBands = seenBands.filter(b => rateForBand(bands, b) == null);
  const cohortDefault = cohortDefaultExposure(cohort_default_flags);

  res.json({
    currency: r2t4.currency || verification.currency || cohortDefault.currency || 'USD',
    r2t4_exposure_total: r2t4.total,
    r2t4_exposure_items: r2t4.items,
    verification_exposure_total: verification.total,
    verification_exposure_items: verification.items,
    cohort_default_exposure_total: cohortDefault.total,
    cohort_default_exposure_items: cohortDefault.items,
    active_pell_disbursed: (kpis && kpis.active_pell_disbursed) || 0,
    total_exposure: r2t4.total + verification.total + cohortDefault.total,
    note: RATE_CARD.note || null,
    r2t4_confidence: confidenceFor(RATE_CARD.r2t4_late_return_penalty_per_day != null),
    verification_confidence: confidenceFor(RATE_CARD.verification_backlog_cost_per_day != null),
    cohort_default_confidence: confidenceFor(
      !!RATE_CARD.cohort_default_exposure_by_band,
      missingBands.length ? ` Rate card has no entry for band(s) ${missingBands.join(', ')} — those items priced at $0.` : null
    )
  });
});

// POST /api/college/finaid/analysis
// Body: { kpis, r2t4_breaches, verification_backlog, cohort_default_flags, context, maxTokens }
// Response: { ok, answer, degraded, createdAt }
// Always 200 — a degraded upstream returns a graceful placeholder answer
// (same resilience pattern as routes/finance-chat.js's /api/chat) rather
// than a 500, since the case data above it on screen is still valid even
// when the AI call itself fails.
router.post('/analysis', async (req, res) => {
  const { kpis, r2t4_breaches, verification_backlog, cohort_default_flags, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    r2t4_breaches,
    verification_backlog,
    cohort_default_flags,
    counts: {
      r2t4_breaches: Array.isArray(r2t4_breaches) ? r2t4_breaches.length : undefined,
      verification_backlog: Array.isArray(verification_backlog) ? verification_backlog.length : undefined,
      cohort_default_flags: Array.isArray(cohort_default_flags) ? cohort_default_flags.length : undefined
    }
  }, null, 2);
  const prompt = `Current Financial Aid (Title IV) compliance snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk R2T4 and verification cases, the cohort default flags requiring escalation, and the single most important next action for each at-risk case. Reference case/flag IDs.`;

  const { text, degraded, reason } = await callGroq(FINAID_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
