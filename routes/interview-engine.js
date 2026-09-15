'use strict';
// Interview Engine API — sectors, plans, and interview sessions.
// Thin wrapper over server/interview-engine-service.js: every handler
// here just calls the engine and shapes the HTTP response, no business
// logic lives in this file. Same pattern as routes/staffing-engine.js.
//
// Scoring note: POST .../answers does NOT pass a grade function to
// recordAnswer() yet, so answers are stored as scored: false rather than
// fabricating a score. Wiring in the groqChat-backed grader (Phase 4) is
// a routes-layer change only — the engine's recordAnswer() already
// accepts a grade function, it's just not supplied here yet.
//
// Auth: intentionally not decided in this file — see server.js for how
// this gets mounted and whether/which auth guard wraps it. (Candidate-
// registry routes are unguarded today; staffing routes are gated behind
// requireStaffAuth. Interview sessions sit closer to candidate-registry
// in sensitivity — practice answers, not employer contacts/fee terms —
// but that's worth confirming before mounting, not assuming here.)

const express = require('express');
const router = express.Router();

const engine = require('../server/interview-engine-service');

// ---- Sectors ----------------------------------------------------

router.get('/api/interview/sectors', (req, res) => {
  try {
    const sectors = engine.listSectors();
    res.json({ sectors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/interview/sectors/:sectorId', (req, res) => {
  try {
    const sector = engine.getSector(req.params.sectorId);
    if (!sector) return res.status(404).json({ error: 'not found' });
    res.json({ sectorId: req.params.sectorId, sector });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Preview the interview plan a sector/role would produce, without
// creating a session. Useful for a "here's what you'd be asked" preview
// panel before the user commits to starting.
router.get('/api/interview/sectors/:sectorId/plan', (req, res) => {
  try {
    const { roleId } = req.query;
    const plan = engine.buildInterviewPlan(req.params.sectorId, { roleId });
    if (!plan) return res.status(404).json({ error: 'not found' });
    res.json({ plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Sessions -----------------------------------------------------

router.get('/api/interview/sessions', async (req, res) => {
  try {
    const { candidateId, sectorId, status } = req.query;
    const sessions = await engine.listSessions({ candidateId, sectorId, status });
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/interview/sessions/:id', async (req, res) => {
  try {
    const session = await engine.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Starts a new interview session for a candidate against a sector
// (optionally a specific role within it). 400s with a clear message if
// the sector doesn't exist yet or has no questions built for it —
// engine.createSession() already refuses rather than returning an empty
// session.
router.post('/api/interview/sessions', async (req, res) => {
  try {
    const { candidateId, sectorId, roleId } = req.body || {};
    if (!candidateId || !sectorId) {
      return res.status(400).json({ error: 'candidateId and sectorId are required' });
    }
    const session = await engine.createSession({ candidateId, sectorId, roleId });
    res.status(201).json({ session });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Records an answer to the session's current question and advances it.
// See file header — not scored yet, that's Phase 4.
router.post('/api/interview/sessions/:id/answers', async (req, res) => {
  try {
    const { questionId, answerText } = req.body || {};
    if (!questionId || !answerText) {
      return res.status(400).json({ error: 'questionId and answerText are required' });
    }
    const session = await engine.recordAnswer(req.params.id, { questionId, answerText });
    res.json({ session });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Readiness/gap numbers are derived from the session's own scored
// responses, so both return { readiness: null } / { gaps: null } rather
// than a 404 or an error when nothing's scored yet — that's a real,
// meaningful state (not "not found"), same as the engine functions
// themselves report it.
router.get('/api/interview/sessions/:id/readiness', async (req, res) => {
  try {
    const session = await engine.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json({ readiness: engine.computeReadiness(session) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/interview/sessions/:id/gaps', async (req, res) => {
  try {
    const session = await engine.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    res.json({ gaps: engine.detectGaps(session) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/interview/sessions/:id', async (req, res) => {
  try {
    const deleted = await engine.deleteSession(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Registry admin -------------------------------------------------

// Picks up edited/added sectors.json or questions.json without a
// process restart. Whoever is allowed to hit this can invalidate the
// in-memory registry cache for everyone — worth gating at the server.js
// mount point even if the rest of this router ends up unguarded.
router.post('/api/interview/registry/reload', (req, res) => {
  try {
    const registry = engine.reloadRegistry();
    res.json({
      ok: true,
      sectors: Object.keys(registry.sectors),
      questionCount: registry.questions.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;