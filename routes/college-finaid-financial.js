// routes/college-finaid-financial.js
//
// Server-side financial exposure computation for the College Financial Aid
// (Title IV) war room. Modeled directly on routes/schools-financial.js:
// same private-rate-card-server-side-only pattern, same
// items/total/confidence response shape, so the client engine and any
// downstream relay/strategist code that already knows how to render a
// Schools-style financial summary can render this one unchanged.
//
// The rate card lives only in server/private-config/college/financial-model.json
// and is never sent to the client — only the *computed* dollar totals are.
//
// Mount in server.js:
//   app.use('/api/college/finaid', requireAnyAuth, require('./routes/college-finaid-financial'));
//
// Endpoint:
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

module.exports = router;
