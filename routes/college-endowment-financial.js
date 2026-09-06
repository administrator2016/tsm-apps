// routes/college-endowment-financial.js
//
// Server-side fund exposure computation AND AI fund-compliance analysis for
// the College Endowment (FASB) war room. Third College domain to get real
// backend wiring (Financial Aid, then Bursar) — same
// private-rate-card-server-side-only pattern as
// routes/college-finaid-financial.js and routes/college-bursar-financial.js,
// generalized to Endowment's two entity kinds (underwater_funds,
// restriction_flags).
//
// Two real dollar signals, both disclosed on the response so a CFO/board
// member can see exactly what's driving the number:
//   1. income_foregone_exposure   — deterministic-given-the-rate: for each
//                                    underwater fund (FASB ASU 2016-14
//                                    "corpus deficit" — market value below
//                                    historic dollar value), the annual
//                                    spending-policy distribution that must
//                                    be foregone (or funded from
//                                    unrestricted reserves) until the fund
//                                    is restored, i.e. corpus_deficit ×
//                                    annual_spending_rate. This is the
//                                    standard UPMIFA-era way institutions
//                                    quantify the annual cost of a fund
//                                    being underwater, not a one-time loss.
//   2. donor_restriction_exposure — banded-by-severity: potential
//                                    donor-relations/legal/compliance
//                                    exposure per open restriction flag.
//
// The rate card lives only in
// server/private-config/college/endowment-financial-model.json and is
// never sent to the client — only the *computed* dollar totals are.
//
// AI analysis endpoint modeled on the same structured-snapshot →
// domain-system-prompt → single-Groq-call pattern as the other two backed
// College domains, replacing college-endowment-command.html's existing
// client-side proxy-then-direct-key callEndowmentAI().
//
// Mount in server.js:
//   app.use('/api/college/endowment', requireAnyAuth, require('./routes/college-endowment-financial'));
//
// Endpoints:
//   POST /api/college/endowment/financial-summary
//   Body: {
//     kpis: { total_funds_tracked, underwater_funds, donor_restriction_flags_open },
//     underwater_funds: [{ fund_id, purpose, severity, corpus_deficit, trend }, ...],
//     restriction_flags: [{ flag_id, fund, issue, severity }, ...]
//   }
//   Response:
//   {
//     currency, income_foregone_exposure_total, income_foregone_exposure_items,
//     donor_restriction_exposure_total, donor_restriction_exposure_items,
//     total_corpus_deficit, total_exposure, note,
//     income_foregone_confidence, donor_restriction_confidence
//   }
//
//   POST /api/college/endowment/analysis
//   Body: { kpis, underwater_funds, restriction_flags, context, maxTokens }
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

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'college', 'endowment-financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[college-endowment-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

// ── AI ANALYSIS ──────────────────────────────────────────────────────────
const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = () => process.env.TSM_COLLEGE_MODEL || process.env.TSM_FINANCE_MODEL || 'openai/gpt-oss-120b';

const ENDOWMENT_SYSTEM_PROMPT =
  'You are a fund compliance and risk AI for a college endowment office. Expert in FASB ASU ' +
  '2016-14 underwater-fund reporting and donor-restricted fund compliance (UPMIFA). Given ' +
  'structured underwater-fund data, donor restriction flags, and computed dollar exposure, ' +
  'quantify compliance risk, flag the funds most at risk of breaching donor-restricted purpose ' +
  'or reporting obligations, and identify which underwater funds require board or ' +
  'investment-committee attention first — prioritized by corpus deficit trend and dollar ' +
  'exposure. Recommend the specific next action per at-risk fund or flag (spending policy ' +
  'adjustment, donor communication/reporting, investment committee review, legal review). ' +
  'Reference fund/flag IDs. Be precise and operational. No preamble. For any deadline: use ' +
  'only a date or day-count explicitly present in the data provided — never calculate, ' +
  'estimate, or infer one. Only state a fund or flag as resolved if the data confirms it — ' +
  'anything shown as underwater or open must be listed as still-needed, not treated as resolved.';

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

// Guards against a caller sending a non-array for a field that's normally
// an array (e.g. a malformed upload or upstream parser bug) — without this,
// (x || []).map(...) still throws when x is truthy but not an array
// (a string, object, or number), crashing the request with an unhandled
// 500 instead of the graceful, always-200 behavior these routes intend.
function asArray(x) {
  // Also drop null/undefined/non-object entries within an otherwise-valid
  // array (e.g. a blank row from a CSV/JSON upload parsed as null) —
  // mapping over those still throws "Cannot read properties of null"
  // even after the array-vs-non-array check above passes.
  return Array.isArray(x) ? x.filter(item => item != null && typeof item === 'object') : [];
}

function incomeForegoneExposure(funds) {
  if (!RATE_CARD || RATE_CARD.annual_spending_rate == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.annual_spending_rate;
  const items = (funds || []).map(f => {
    const deficit = Math.round(f.corpus_deficit || 0);
    const exposure = Math.round(deficit * rate);
    return { id: f.fund_id, purpose: f.purpose, corpus_deficit: deficit, trend: f.trend, exposure };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

// Severity bands are uppercase ('HIGH'/'MEDIUM'/'LOW') — normalize
// defensively, same lesson learned in the other two College route files:
// an unnormalized severity from an upstream feed silently prices real
// exposure at $0.
function rateForSeverity(bands, severity) {
  if (!severity) return null;
  if (bands[severity] != null) return bands[severity];
  const upper = String(severity).toUpperCase();
  return bands[upper] != null ? bands[upper] : null;
}

function donorRestrictionExposure(flags) {
  if (!RATE_CARD || !RATE_CARD.donor_restriction_exposure_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const bands = RATE_CARD.donor_restriction_exposure_by_severity;
  const items = (flags || []).map(fl => {
    const matched = rateForSeverity(bands, fl.severity);
    const rate = matched != null ? matched : 0;
    return { id: fl.flag_id, fund: fl.fund, issue: fl.issue, severity: fl.severity, exposure: rate };
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
  return { confidence: 90, note: '' };
}

// POST /api/college/endowment/financial-summary
router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'endowment financial model unavailable' });
  }
  const { underwater_funds, restriction_flags } = req.body || {};
  const funds = asArray(underwater_funds);
  const flags = asArray(restriction_flags);

  const incomeForegone = incomeForegoneExposure(funds);

  const bands = RATE_CARD.donor_restriction_exposure_by_severity || {};
  const seenSeverities = [...new Set(flags.map(fl => fl.severity).filter(Boolean))];
  const missingSeverities = seenSeverities.filter(s => rateForSeverity(bands, s) == null);
  const donorRestriction = donorRestrictionExposure(flags);

  const totalCorpusDeficit = funds.reduce((sum, f) => sum + (f.corpus_deficit || 0), 0);

  res.json({
    currency: incomeForegone.currency || donorRestriction.currency || 'USD',
    income_foregone_exposure_total: incomeForegone.total,
    income_foregone_exposure_items: incomeForegone.items,
    donor_restriction_exposure_total: donorRestriction.total,
    donor_restriction_exposure_items: donorRestriction.items,
    total_corpus_deficit: totalCorpusDeficit,
    total_exposure: incomeForegone.total + donorRestriction.total,
    note: RATE_CARD.note || null,
    income_foregone_confidence: confidenceFor(RATE_CARD.annual_spending_rate != null),
    donor_restriction_confidence: confidenceFor(
      !!RATE_CARD.donor_restriction_exposure_by_severity,
      missingSeverities.length ? ` Rate card has no entry for severity(s) ${missingSeverities.join(', ')} — those items priced at $0.` : null
    )
  });
});

// POST /api/college/endowment/analysis
router.post('/analysis', async (req, res) => {
  const { kpis, underwater_funds, restriction_flags, context, maxTokens } = req.body || {};
  const summary = JSON.stringify({
    kpis,
    underwater_funds,
    restriction_flags,
    counts: {
      underwater_funds: Array.isArray(underwater_funds) ? underwater_funds.length : undefined,
      restriction_flags: Array.isArray(restriction_flags) ? restriction_flags.length : undefined
    }
  }, null, 2);
  const prompt = `Current Endowment (FASB ASU 2016-14) fund compliance snapshot:\n${summary}\n\n` +
    (context ? `Additional context: ${context}\n\n` : '') +
    `Identify the highest-risk underwater funds and donor restriction flags requiring board or investment-committee attention, and recommend the single most important next action for each. Reference fund/flag IDs.`;

  const { text, degraded, reason } = await callGroq(ENDOWMENT_SYSTEM_PROMPT, prompt, maxTokens || 900);
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
