// routes/rcm-requirements.js
//
// Task Data Requirements Registry — the small structured spec (per cadence
// phase) that tells an EU exactly what data a phase needs from its owning
// module, and lets them self-report it until that module exposes a real
// API. This is deliberately NOT a database of "real" numbers — every value
// stored here is honestly labeled source: 'self-reported' so the Assistant,
// Executive tab, and exported reports never present it as verified.
//
// When a module (compliance.html, finops-operations.html, etc.) eventually
// gets a real read endpoint, the validation step is: fetch the real value,
// compare it to what's stored here, and surface a mismatch — that's the
// actual "intelligence" gain. Nothing below invents that comparison yet.
//
// Mount in server.js:
//   app.use('/api/rcm', require('./routes/rcm-requirements'));
//
// Endpoints:
//   GET    /api/rcm/requirements         — full registry spec
//   GET    /api/rcm/self-reported        — all self-reported values on file
//   POST   /api/rcm/self-reported        — upsert one field's value
//   DELETE /api/rcm/self-reported/:key/:fieldId — clear one field

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// ── AUTH: shared-secret gate for mutating endpoints ──────────────────────
// Shared with server.js and routes/rcm-relay.js via middleware/require-api-key.js.
const { requireAuth } = require('../middleware/require-auth');

const REGISTRY_PATH = path.join(__dirname, '..', 'config', 'rcm', 'task-requirements.json');

let REGISTRY = {};
try {
  REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
} catch (err) {
  console.error('[rcm-requirements] Failed to load registry at', REGISTRY_PATH, err.message);
  REGISTRY = {};
}

// ── In-memory self-reported store ───────────────────────────────────────────
// Swap for a real store when ready (same convention as routes/rcm-relay.js).
// Shape: { "daily-2": { "openFlagCount": { value, reportedAt, source: 'self-reported' } } }
const selfReported = {};

// ── GET /api/rcm/requirements ───────────────────────────────────────────────
// TSM FIX: no auth guard, same gap class as routes/rcm-relay.js's GET routes.
// Lower stakes here (a schema spec, no customer data) but same pattern, and
// this router's own write endpoints already correctly use requireAuth.
router.get('/requirements', requireAuth, (req, res) => {
  const { _readme, ...phases } = REGISTRY;
  res.json({ phases });
});

// ── GET /api/rcm/self-reported ──────────────────────────────────────────────
// TSM FIX: same auth gap as GET /requirements above — this one does expose
// EU-entered field values, so worth closing even though they're self-reported.
router.get('/self-reported', requireAuth, (req, res) => {
  res.json({ data: selfReported });
});

// ── POST /api/rcm/self-reported ─────────────────────────────────────────────
// Body: { key: "daily-2", fieldId: "openFlagCount", value: "3" }
router.post('/self-reported', requireAuth, express.json({ limit: '100kb' }), (req, res) => {
  const { key, fieldId, value } = req.body || {};
  if (!key || !fieldId || value === undefined) {
    return res.status(400).json({ error: { message: 'Body must include key, fieldId, and value.' } });
  }
  if (!REGISTRY[key] || !(REGISTRY[key].requiredFields || []).some(f => f.id === fieldId)) {
    return res.status(400).json({ error: { message: `Unknown key/fieldId: ${key}/${fieldId}` } });
  }

  if (!selfReported[key]) selfReported[key] = {};
  selfReported[key][fieldId] = {
    value: String(value).slice(0, 2000),
    reportedAt: new Date().toISOString(),
    source: 'self-reported'
  };

  res.json({ ok: true, key, fieldId, entry: selfReported[key][fieldId] });
});

// ── DELETE /api/rcm/self-reported/:key/:fieldId ─────────────────────────────
router.delete('/self-reported/:key/:fieldId', requireAuth, (req, res) => {
  const { key, fieldId } = req.params;
  if (selfReported[key] && selfReported[key][fieldId]) {
    delete selfReported[key][fieldId];
  }
  res.json({ ok: true });
});

module.exports = router;
