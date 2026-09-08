'use strict';
// Training Intelligence — certification blueprint tracking + gap-driven study
// roadmap. Honesty pattern: blueprint domain weights are never guessed by an
// LLM and never hardcoded as "official". They live in
// data/training-intelligence/providers/<id>.json with verified/sourceUrl/
// lastVerified fields, start out verified:false with null weights, and only
// flip to verified:true through the admin-gated PUT route below once someone
// has actually checked them against a real Now Learning source. Every read
// route echoes the verified flag back so the frontend can show the
// "unverified — confirm against your Now Learning account" banner and must
// never suppress it while verified is false.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const { requireRole } = require('../middleware/require-auth');

const PROVIDERS_DIR = path.join(__dirname, '..', 'data', 'training-intelligence', 'providers');
const ADMIN_ROLES = ['admin', 'manager'];

function providerPath(providerId) {
  // providerId comes straight from the URL; keep it to a safe slug so this
  // can never be turned into a path traversal read/write.
  if (!/^[a-z0-9-]+$/.test(providerId || '')) return null;
  return path.join(PROVIDERS_DIR, `${providerId}.json`);
}

function loadProvider(providerId) {
  const p = providerPath(providerId);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveProvider(providerId, data) {
  const p = providerPath(providerId);
  if (!p) throw new Error('invalid providerId');
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// GET /api/training-intelligence/providers
// List known blueprint configs (id/displayName/verified only — not the full
// domain payload, so the picker list is cheap).
router.get('/api/training-intelligence/providers', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(PROVIDERS_DIR).filter(f => f.endsWith('.json'));
  } catch {
    return res.json({ ok: true, providers: [] });
  }
  const providers = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROVIDERS_DIR, f), 'utf8'));
      return {
        providerId: data.providerId,
        displayName: data.displayName,
        verified: !!data.verified,
        lastVerified: data.lastVerified || null
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  res.json({ ok: true, providers });
});

// GET /api/training-intelligence/blueprint/:providerId
// Returns the blueprint config as-is, verified flag included. If verified is
// false, weight fields are null and the client is expected to render the
// unverified banner rather than compute anything off them.
router.get('/api/training-intelligence/blueprint/:providerId', (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  res.json({ ok: true, blueprint: data });
});

// PUT /api/training-intelligence/blueprint/:providerId
// Admin-only. This is the ONLY way domain weights or verified:true get set —
// no scraper, no LLM-guessed numbers. Body must include sourceUrl and mark
// verified explicitly; lastVerified is stamped server-side so it can't be
// backdated.
router.put('/api/training-intelligence/blueprint/:providerId', requireRole(ADMIN_ROLES), (req, res) => {
  const existing = loadProvider(req.params.providerId);
  if (!existing) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const { domains, sourceUrl, verified, note } = req.body || {};
  if (verified === true && !sourceUrl) {
    return res.status(400).json({ ok: false, error: 'sourceUrl is required to mark a blueprint verified' });
  }
  if (domains && !Array.isArray(domains)) {
    return res.status(400).json({ ok: false, error: 'domains must be an array' });
  }

  const updated = {
    ...existing,
    domains: domains || existing.domains,
    sourceUrl: sourceUrl !== undefined ? sourceUrl : existing.sourceUrl,
    verified: verified === true,
    verifiedBy: verified === true ? (req.tsmSession?.label || req.tsmSession?.staffId || 'admin') : null,
    lastVerified: verified === true ? new Date().toISOString() : null,
    note: note !== undefined ? note : existing.note
  };

  try {
    saveProvider(req.params.providerId, updated);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to save blueprint' });
  }
  res.json({ ok: true, blueprint: updated });
});

// GET /api/training-intelligence/roadmap/:providerId
// Gap-driven study roadmap generation off the blueprint config. When the
// blueprint isn't verified yet, this returns an evenly-weighted roadmap
// explicitly labeled as an estimate rather than pretending to prioritize by
// real exam weight.
router.get('/api/training-intelligence/roadmap/:providerId', (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const domains = Array.isArray(data.domains) ? data.domains : [];
  const n = domains.length || 1;

  const roadmap = domains.map(d => ({
    id: d.id,
    label: d.label,
    weight: data.verified ? d.weight : null,
    estimatedWeight: data.verified ? null : Math.round((100 / n) * 10) / 10,
    priority: data.verified && typeof d.weight === 'number' ? d.weight : null
  }));

  if (data.verified) {
    roadmap.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  res.json({
    ok: true,
    providerId: data.providerId,
    verified: !!data.verified,
    basis: data.verified ? 'blueprint-weight' : 'even-split-estimate',
    roadmap
  });
});

// GET /api/training-intelligence/teach/:providerId/:domainId
// Teach Me content layer — intentionally not built yet. Per the build order
// this is the third phase (after blueprint config + roadmap), and the
// auto-detect/any-URL provider generator is explicitly deferred further
// still since it's the piece most likely to fabricate confident domain
// weights for unverified providers. Returning an honest 501 here rather than
// a stubbed-out fake explanation.
router.get('/api/training-intelligence/teach/:providerId/:domainId', (_req, res) => {
  res.status(501).json({
    ok: false,
    error: 'Teach Me content generation is not implemented yet — next build phase after blueprint + roadmap.'
  });
});

module.exports = router;
