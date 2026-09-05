// routes/schools-financial.js
//
// Server-side financial exposure computation for the Schools war room.
// The rate card (funding_delay_cost_per_day, compliance_exposure_by_severity)
// used to ship inside the publicly-fetchable schools-model.json, which meant
// anyone could read TSM's proprietary pricing model straight out of the
// browser's Network tab. It now lives only in
// server/private-config/schools/financial-model.json and is never sent to
// the client — only the *computed* dollar totals are.
//
// The math here is intentionally identical to what
// html/war-rooms/schools-command/services/schools-engine.js used to do
// client-side (getFundingDelayExposure / getComplianceExposure /
// getFinancialSummary) — this route is that logic moved server-side, not a
// reinvention of it.
//
// Mount in server.js:
//   app.use('/api/schools', require('./routes/schools-financial'));
//
// Endpoint:
//   POST /api/schools/financial-summary
//   Body: {
//     kpis: { active_award_value, ... },        // from engine.computeKpis()
//     grant_breaches: [{ id, grantee, stage, hours_over, record }, ...],  // from engine.getSlaBreaches('grant_files')
//     exceptions: [{ exception_id, grant_id, type, severity, stage }, ...] // open compliance exceptions
//   }
//   Response: same shape the old client-side getFinancialSummary() returned.

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireAnyAuth } = require('../middleware/require-auth');

// GCU PILOT FIX 2026-08-26: financial-summary returns computed grant/funding
// dollar exposure with no auth check. Gate behind a valid tsm_session cookie,
// same pattern as BPO's routes. Sample mode is unaffected — it computes
// client-side and never calls this endpoint.
router.use(requireAnyAuth);

const RATE_CARD_PATH = path.join(__dirname, '..', 'server', 'private-config', 'schools', 'financial-model.json');

let RATE_CARD = null;
try {
  RATE_CARD = JSON.parse(fs.readFileSync(RATE_CARD_PATH, 'utf8'));
} catch (err) {
  console.error('[schools-financial] Failed to load rate card at', RATE_CARD_PATH, err.message);
  RATE_CARD = null;
}

function fundingDelayExposure(breaches) {
  if (!RATE_CARD || RATE_CARD.funding_delay_cost_per_day == null) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rate = RATE_CARD.funding_delay_cost_per_day;
  const items = (breaches || []).map(b => {
    const days = Math.max(1, Math.round(((b.hours_over || 0) / 24) * 10) / 10);
    const exposure = Math.round(days * rate);
    return {
      id: b.id,
      grantee: b.record && b.record.grantee,
      stage: b.stage,
      hours_over: b.hours_over,
      days_over: days,
      exposure
    };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

// Rate card keys are uppercase ('HIGH'/'MEDIUM'/'LOW'), but nothing upstream
// guarantees callers send severity in that case -- schools-engine.js posts
// whatever loadRecords() was given, with no normalization, so a future CSV
// import or SIS integration sending lowercase/mixed-case severity would
// silently price real compliance exposure at $0 without this. Sample data
// happens to already be uppercase, which is why this went unnoticed.
function rateForSeverity(rates, severity) {
  if (!severity) return null;
  if (rates[severity] != null) return rates[severity];
  const upper = String(severity).toUpperCase();
  return rates[upper] != null ? rates[upper] : null;
}

function complianceExposure(exceptions) {
  const open = (exceptions || []).filter(e => e.stage !== 'remediated');
  if (!RATE_CARD || !RATE_CARD.compliance_exposure_by_severity) {
    return { total: 0, currency: RATE_CARD ? RATE_CARD.currency : 'USD', items: [] };
  }
  const rates = RATE_CARD.compliance_exposure_by_severity;
  const items = open.map(e => {
    const matched = rateForSeverity(rates, e.severity);
    const rate = matched != null ? matched : 0;
    return { id: e.exception_id, grant_id: e.grant_id, type: e.type, severity: e.severity, exposure: rate };
  }).sort((a, b) => b.exposure - a.exposure);
  return { total: items.reduce((s, it) => s + it.exposure, 0), currency: RATE_CARD.currency || 'USD', items };
}

function fundingDelayConfidence() {
  if (!RATE_CARD || RATE_CARD.funding_delay_cost_per_day == null) {
    return { confidence: 30, note: ' Rate card is missing funding_delay_cost_per_day, so exposure defaulted to $0 — treat as unverified.' };
  }
  return { confidence: 95, note: '' };
}

function complianceConfidence(exceptions) {
  if (!RATE_CARD || !RATE_CARD.compliance_exposure_by_severity) {
    return { confidence: 30, note: ' Rate card is missing compliance_exposure_by_severity, so exposure defaulted to $0 — treat as unverified.' };
  }
  const rates = RATE_CARD.compliance_exposure_by_severity;
  const severities = [...new Set((exceptions || []).map(e => e.severity).filter(Boolean))];
  const missing = severities.filter(s => rateForSeverity(rates, s) == null);
  if (missing.length) {
    return { confidence: 65, note: ` Rate card has no entry for severity level(s) ${missing.join(', ')} — those items priced at $0.` };
  }
  return { confidence: 95, note: '' };
}

// POST /api/schools/financial-summary
// Also returns funding_delay_confidence / compliance_confidence so the
// client's Sentinel-relay confidence notes don't need the rate card either.
router.post('/financial-summary', (req, res) => {
  if (!RATE_CARD) {
    return res.status(500).json({ error: 'financial model unavailable' });
  }
  const { kpis, grant_breaches, exceptions } = req.body || {};

  const delay = fundingDelayExposure(grant_breaches);
  const compliance = complianceExposure(exceptions);

  res.json({
    currency: delay.currency || compliance.currency || 'USD',
    funding_delay_exposure_total: delay.total,
    funding_delay_exposure_items: delay.items,
    compliance_exposure_total: compliance.total,
    compliance_exposure_items: compliance.items,
    active_award_value: (kpis && kpis.active_award_value) || 0,
    total_exposure: delay.total + compliance.total,
    note: RATE_CARD.note || null,
    funding_delay_confidence: fundingDelayConfidence(),
    compliance_confidence: complianceConfidence(exceptions)
  });
});

module.exports = router;
