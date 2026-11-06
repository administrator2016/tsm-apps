
const { externalLlmFetch } = require('../external-llm-policy');
/**
 * Twins Router
 * Mounts VMware and Network digital-twin endpoints under /api/twins.
 *
 * Usage in server.js:
 *   const twinsRouter = require('./server/enterprise-lab/twins-router');
 *   app.use('/api/twins', twinsRouter);
 */

'use strict';

const express = require('express');
const { VMwareTwin, FAULT_TYPES: VMWARE_FAULTS } = require('./vmware-twin');
const { NetworkTwin, FAULT_TYPES: NETWORK_FAULTS } = require('./network-twin');
const { DeviceTwin, FAULT_TYPES: DEVICE_FAULTS, CATEGORY_BY_TYPE: DEVICE_CATEGORY_BY_TYPE } = require('./device-twin');
const { ADTwin, FAULT_TYPES: AD_FAULTS } = require('./ad-twin');
const { M365Twin, FAULT_TYPES: M365_FAULTS } = require('./m365-twin');
const { KnowledgeCopilot } = require('./knowledge-copilot');
const { VendorOpsTwin, FAULT_TYPES: VENDOR_FAULTS } = require('./vendor-ops-twin');
const { ChaosEngine } = require('./chaos-engine');
const { SLAEngine } = require('./sla-engine');
const { AIScoringEngine } = require('./ai-scoring');
const { TechnicianMetrics } = require('./technician-performance-metrics');
const { HistoricalAnalytics } = require('./historical-analytics');
const { engine: incidentEngine } = require('./incident-engine');

const router = express.Router();

// Singleton twin instances shared across all requests (in-memory demo state).
const vmwareTwin = new VMwareTwin();
const networkTwin = new NetworkTwin();
const deviceTwin = new DeviceTwin();
const adTwin = new ADTwin();
const m365Twin = new M365Twin();
const knowledgeCopilot = new KnowledgeCopilot();
const vendorOpsTwin = new VendorOpsTwin();
const chaosEngine = new ChaosEngine({
  ad: { twin: adTwin, faultTypes: AD_FAULTS },
  m365: { twin: m365Twin, faultTypes: M365_FAULTS },
  network: { twin: networkTwin, faultTypes: NETWORK_FAULTS },
  device: { twin: deviceTwin, faultTypes: DEVICE_FAULTS },
  vendor: { twin: vendorOpsTwin, faultTypes: VENDOR_FAULTS },
  vmware: { twin: vmwareTwin, faultTypes: VMWARE_FAULTS },
});
const slaEngine = new SLAEngine(
  { ad: adTwin, m365: m365Twin, network: networkTwin, device: deviceTwin, vmware: vmwareTwin },
  vendorOpsTwin
);
const aiScoringEngine = new AIScoringEngine(slaEngine);
const technicianMetrics = new TechnicianMetrics();
const historicalAnalytics = new HistoricalAnalytics({
  slaEngine,
  chaosEngine,
  vendorOpsTwin,
  aiScoring: aiScoringEngine,
});
historicalAnalytics.start();

// ---- VMware twin ----

router.get('/vmware/state', (req, res) => {
  res.json(vmwareTwin.getState());
});

router.get('/vmware/fault-types', (req, res) => {
  res.json({ faultTypes: VMWARE_FAULTS });
});

router.post('/vmware/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = vmwareTwin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/vmware/reset', (req, res) => {
  res.json(vmwareTwin.reset());
});

// ---- Network twin ----

router.get('/network/state', (req, res) => {
  res.json(networkTwin.getState());
});

router.get('/network/fault-types', (req, res) => {
  res.json({ faultTypes: NETWORK_FAULTS });
});

router.post('/network/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = networkTwin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/network/reset', (req, res) => {
  res.json(networkTwin.reset());
});

// ---- Device twin ----

router.get('/device/state', (req, res) => {
  res.json(deviceTwin.getState());
});

router.get('/device/fault-types', (req, res) => {
  res.json({ faultTypes: DEVICE_FAULTS });
});

router.post('/device/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = deviceTwin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/device/reset', (req, res) => {
  res.json(deviceTwin.reset());
});

// ---- AD twin ----

router.get('/ad/state', (req, res) => {
  res.json(adTwin.getState());
});

router.get('/ad/fault-types', (req, res) => {
  res.json({ faultTypes: AD_FAULTS });
});

router.post('/ad/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = adTwin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/ad/reset', (req, res) => {
  res.json(adTwin.reset());
});

// ---- M365 twin ----

router.get('/m365/state', (req, res) => {
  res.json(m365Twin.getState());
});

router.get('/m365/fault-types', (req, res) => {
  res.json({ faultTypes: M365_FAULTS });
});

router.post('/m365/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = m365Twin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/m365/reset', (req, res) => {
  res.json(m365Twin.reset());
});

// ---- Knowledge Copilot ----

router.get('/knowledge/entries', (req, res) => {
  res.json(knowledgeCopilot.getState());
});

router.get('/knowledge/lookup/:twinType/:faultType', (req, res) => {
  const entry = knowledgeCopilot.lookup(req.params.twinType, req.params.faultType);
  if (!entry) return res.status(404).json({ error: 'No knowledge entry found' });
  res.json(entry);
});

router.post('/knowledge/entry', (req, res) => {
  const { twinType, faultType, entry } = req.body || {};
  try {
    const saved = knowledgeCopilot.upsertEntry(twinType, faultType, entry);
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/knowledge/reset', (req, res) => {
  res.json(knowledgeCopilot.reset());
});

// ---- Vendor Operations ----

router.get('/vendor/state', (req, res) => {
  res.json(vendorOpsTwin.getState());
});

router.get('/vendor/fault-types', (req, res) => {
  res.json({ faultTypes: VENDOR_FAULTS });
});

router.post('/vendor/ticket', (req, res) => {
  const { vendorId, subject, priority } = req.body || {};
  try {
    const ticket = vendorOpsTwin.openTicket(vendorId, subject, priority);
    res.json(ticket);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/vendor/fault', (req, res) => {
  const { type, targetId } = req.body || {};
  try {
    const state = vendorOpsTwin.applyFault(type, targetId);
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/vendor/reset', (req, res) => {
  res.json(vendorOpsTwin.reset());
});

// ---- Chaos Engine ----

router.get('/chaos/status', (req, res) => {
  res.json(chaosEngine.getStatus());
});

router.post('/chaos/start', (req, res) => {
  const { intervalMs } = req.body || {};
  res.json(chaosEngine.start(intervalMs));
});

router.post('/chaos/stop', (req, res) => {
  res.json(chaosEngine.stop());
});

// Maps a successful chaos-engine fault into a real Service Desk ticket
// (Mission Queue entry), so injected faults are visible in the same
// queue technicians and the L1 Copilot already work from — not just
// in /api/twins/*/state and /api/twins/sla/status.
const SERVICE_DESK_CATEGORY_BY_MODULE = {
  ad: 'Active Directory',
  network: 'Network',
  vmware: 'VMware',
  m365: 'Microsoft 365',
  // device resolved dynamically below (laptop/desktop/printer)
  // vendor intentionally excluded: vendorOpsTwin has its own ticket flow
};

function humanizeFaultType(type) {
  return (type || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function bridgeToServiceDesk(result) {
  if (!result.ok || result.module === 'vendor') return null;

  let category = SERVICE_DESK_CATEGORY_BY_MODULE[result.module];
  if (result.module === 'device') {
    const endpoint = deviceTwin.getState().endpoints.find((e) => e.id === result.targetId);
    category = endpoint ? DEVICE_CATEGORY_BY_TYPE[endpoint.type] : undefined;
  }
  if (!category) return null;

  return incidentEngine.createIncident({
    category,
    issue: `${humanizeFaultType(result.type)} (${result.targetId}) [Chaos Engine]`,
  });
}

router.post('/chaos/trigger', (req, res) => {
  const { module: moduleName } = req.body || {};
  try {
    const result = moduleName ? chaosEngine.triggerOnce(moduleName) : chaosEngine.triggerRandom();
    technicianMetrics.recordIncident(result);
    const mission = bridgeToServiceDesk(result);
    if (mission) result.missionId = mission.id;
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- SLA Intelligence ----

router.get('/sla/status', (req, res) => {
  res.json(slaEngine.evaluate());
});

router.get('/sla/summary', (req, res) => {
  res.json(slaEngine.summary());
});

// ---- AI Scoring ----

router.get('/scoring/status', (req, res) => {
  res.json(aiScoringEngine.score());
});

router.get('/scoring/summary', (req, res) => {
  res.json(aiScoringEngine.summary());
});

// ---- Technician Performance Metrics ----

router.get('/technicians/roster', (req, res) => {
  res.json(technicianMetrics.roster);
});

router.get('/technicians/metrics', (req, res) => {
  res.json(technicianMetrics.metrics());
});

router.get('/technicians/assignments', (req, res) => {
  res.json(technicianMetrics.listAssignments(req.query.techId));
});

router.post('/technicians/assignments/:id/resolve', (req, res) => {
  const a = technicianMetrics.resolve(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found' });
  res.json(a);
});

// ---- Historical Analytics ----

router.get('/analytics/snapshots', (req, res) => {
  res.json(historicalAnalytics.getSnapshots(req.query.limit));
});

router.get('/analytics/latest', (req, res) => {
  res.json(historicalAnalytics.latest());
});

router.post('/analytics/snapshot', (req, res) => {
  res.json(historicalAnalytics.snapshotNow());
});

router.post('/analytics/start', (req, res) => {
  const { intervalMs } = req.body || {};
  res.json(historicalAnalytics.start(intervalMs));
});

router.post('/analytics/stop', (req, res) => {
  res.json(historicalAnalytics.stop());
});

// ---- AI Query Widget ----
// End users describe a problem in free text; Groq picks the single
// best-matching documented scenario out of the real Knowledge Copilot
// catalog (never invents one) and we return its full step list.
// No keyword-match fallback by design — if the AI call fails, the
// widget reports that rather than silently guessing.

const AI_WIDGET_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

async function matchScenarioToQuery(query, entries) {
  const groqKey = process.env.GROQ_KEY || process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('No Groq API key configured');

  const catalog = entries
    .map((e) => `${e.twinType}:${e.faultType} — ${e.title}`)
    .join('\n');

  const system = [
    'You are a triage assistant for an IT Service Desk knowledge base.',
    "Given a user's free-text description of a problem, pick the single best-matching",
    'documented scenario from the catalog below. Always pick the closest match even if',
    'imperfect. Never invent a scenario key that is not in the catalog.',
    'Return JSON only, no markdown fences, in exactly this shape:',
    '{"key":"<twinType>:<faultType>","confidence":"high|medium|low","reasoning":"<one sentence>"}',
    '',
    'CATALOG:',
    catalog,
  ].join('\n');

  let lastErr;
  for (const model of AI_WIDGET_MODELS) {
    try {
      const r = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          temperature: 0.1,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: query },
          ],
        }),
      });
      if (!r.ok) {
        const errText = await r.text();
        lastErr = new Error(`Groq API error ${r.status}: ${errText}`);
        if ([429, 500, 502, 503].includes(r.status)) continue;
        throw lastErr;
      }
      const data = await r.json();
      const text = data?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      if (!parsed.key || typeof parsed.key !== 'string') {
        throw new Error('Malformed AI response: missing key');
      }
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('AI matching failed');
}

router.post('/knowledge/query', async (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'query is required' });
  }
  try {
    const entries = knowledgeCopilot.listEntries();
    const matched = await matchScenarioToQuery(query.trim(), entries);
    const [twinType, faultType] = matched.key.split(':');
    const full = knowledgeCopilot.lookup(twinType, faultType);
    if (!full) {
      return res.status(502).json({ error: `AI returned an unknown scenario key: ${matched.key}` });
    }
    res.json({
      query: query.trim(),
      twinType,
      faultType,
      title: full.title,
      steps: full.steps,
      confidence: matched.confidence || null,
      reasoning: matched.reasoning || null,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Applies a real fault to the named twin and records it against Technician
// Performance, without creating a second Service Desk ticket — callers that
// already created their own ticket (e.g. api.js's /incidents/generate) want
// the twin/SLA/analytics side effects only, not a duplicate mission entry.
function triggerModuleFault(moduleName) {
  const result = chaosEngine.triggerOnce(moduleName);
  technicianMetrics.recordIncident(result);
  return result;
}

module.exports = router;
module.exports.triggerModuleFault = triggerModuleFault;

