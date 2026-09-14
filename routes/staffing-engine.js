'use strict';
// Staffing Engine API — employers, job orders, and the submit -> place
// pipeline. Sits alongside routes/candidate-registry.js: candidates come
// from the training/readiness registry, this module is what turns a
// ready candidate into an actual paid placement with a computed fee.
//
// Mount behind requireAnyAuth in server.js — unlike training candidates,
// employer contact info and fee terms are real business data.

const express = require('express');
const router = express.Router();

const engine = require('../server/staffing-engine-service');

// ---- Employers ----------------------------------------------------

router.get('/api/staffing/employers', async (req, res) => {
  try {
    const { status } = req.query;
    const employers = await engine.listEmployers({ status });
    res.json({ employers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/staffing/employers/:id', async (req, res) => {
  try {
    const employer = await engine.getEmployer(req.params.id);
    if (!employer) return res.status(404).json({ error: 'not found' });
    res.json({ employer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/staffing/employers', async (req, res) => {
  try {
    const employer = await engine.upsertEmployer(req.body || {});
    res.status(201).json({ employer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/api/staffing/employers/:id', async (req, res) => {
  try {
    const employer = await engine.upsertEmployer({ ...req.body, employerId: req.params.id });
    res.json({ employer });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api/staffing/employers/:id', async (req, res) => {
  try {
    const deleted = await engine.deleteEmployer(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Job orders -----------------------------------------------------

router.get('/api/staffing/job-orders', async (req, res) => {
  try {
    const { employerId, status } = req.query;
    const jobOrders = await engine.listJobOrders({ employerId, status });
    res.json({ jobOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/staffing/job-orders/:id', async (req, res) => {
  try {
    const jobOrder = await engine.getJobOrder(req.params.id);
    if (!jobOrder) return res.status(404).json({ error: 'not found' });
    res.json({ jobOrder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/staffing/job-orders', async (req, res) => {
  try {
    const jobOrder = await engine.upsertJobOrder(req.body || {});
    res.status(201).json({ jobOrder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/api/staffing/job-orders/:id', async (req, res) => {
  try {
    const jobOrder = await engine.upsertJobOrder({ ...req.body, jobOrderId: req.params.id });
    res.json({ jobOrder });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/staffing/job-orders/:id', async (req, res) => {
  try {
    const deleted = await engine.deleteJobOrder(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Placements (submit -> interview -> place) -----------------------

router.get('/api/staffing/placements', async (req, res) => {
  try {
    const { jobOrderId, candidateId, employerId, status } = req.query;
    const placements = await engine.listPlacements({ jobOrderId, candidateId, employerId, status });
    res.json({ placements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/staffing/placements/:id', async (req, res) => {
  try {
    const placement = await engine.getPlacement(req.params.id);
    if (!placement) return res.status(404).json({ error: 'not found' });
    res.json({ placement });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit a candidate against a job order — creates the placement record.
router.post('/api/staffing/placements', async (req, res) => {
  try {
    const { candidateId, jobOrderId, payRate, annualHours, meta } = req.body || {};
    if (!candidateId || !jobOrderId) {
      return res.status(400).json({ error: 'candidateId and jobOrderId are required' });
    }
    const placement = await engine.submitCandidate({ candidateId, jobOrderId, payRate, annualHours, meta });
    res.status(201).json({ placement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Advance a placement's status (submitted -> interviewing -> offered ->
// placed -> ended, or declined at any point). Fee is computed
// server-side the moment status becomes 'placed' — never accepted from
// the client.
router.put('/api/staffing/placements/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    const placement = await engine.updatePlacementStatus(req.params.id, status);
    res.json({ placement });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/api/staffing/placements/:id', async (req, res) => {
  try {
    const deleted = await engine.deletePlacement(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
