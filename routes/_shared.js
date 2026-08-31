'use strict';
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// FILE PATHS
// ═══════════════════════════════════════════════════════════════════════════
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// TSM FIX (data isolation): these used to be single global files shared by
// every client — GCU's session and every other client's session read/wrote
// the exact same hc-node-state.json, hc-reports.json, hc-profiles.json.
// There was no clientId field anywhere in the schema, so "scoping" wasn't
// partial, it was absent. Each client now gets its own file, keyed by the
// clientId attached to req.tsmSession by requireAnyAuth/requireRole
// (middleware/require-auth.js). Pre-existing data (from before multi-tenancy
// existed) lives under the 'default' clientId so nothing is silently
// dropped — an admin session with no clientId reads/writes 'default' unless
// it explicitly requests another client's id (see resolveHcClientId below).
//
// Old constants (HC_NODE_STATE_FILE etc.) are kept as the literal 'default'
// path so any caller not yet updated still resolves to the same file it
// always did, rather than throwing.
function hcNodeStateFile(clientId) {
  return path.join(DATA_DIR, `hc-node-state.${clientId || 'default'}.json`);
}
function hcReportsFile(clientId) {
  return path.join(DATA_DIR, `hc-reports.${clientId || 'default'}.json`);
}
function hcProfilesFile(clientId) {
  return path.join(DATA_DIR, `hc-profiles.${clientId || 'default'}.json`);
}
function hcIntakeQueueFile(clientId) {
  return path.join(DATA_DIR, `hc-intake-queue.${clientId || 'default'}.json`);
}

const HC_NODE_STATE_FILE = hcNodeStateFile('default');
const HC_REPORTS_FILE    = hcReportsFile('default');
const HC_PROFILES_FILE   = hcProfilesFile('default');

// Resolve which client's data bucket a request should read/write.
// - client-role sessions ALWAYS use their own session clientId — the body/
//   query is never trusted for this, so one client can't address another
//   client's bucket by passing a different id.
// - admin/staff sessions default to 'default' (today's legacy single bucket)
//   but may pass ?clientId=... or body.clientId to work inside a specific
//   client's data, e.g. an admin preparing GCU's node state.
// Only [a-zA-Z0-9_-], 1-64 chars -- this string is interpolated directly
// into a filesystem path (hc-node-state.${clientId}.json), so it must
// never contain '/', '..', null bytes, or anything path-traversal-shaped.
// Rejects anything else and falls back to null rather than throwing, since
// resolveHcClientId is called from GET routes too and should not 500 on a
// malformed query param.
function sanitizeClientId(id) {
  const s = String(id || '').trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(s) ? s : null;
}

function resolveHcClientId(req) {
  const session = req.tsmSession || {};
  if (session.role === 'client') return session.clientId || 'default';
  const requested = (req.query && req.query.clientId) || (req.body && req.body.clientId);
  return sanitizeClientId(requested) || 'default';
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON I/O
// ═══════════════════════════════════════════════════════════════════════════
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[readJson] failed to read ${file}:`, e.message);
    return fallback;
  }
}

function writeJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`[writeJson] failed to write ${file}:`, e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GROQ (server-side only — key comes from env, never from client)
// ═══════════════════════════════════════════════════════════════════════════
const SP = {
  healthcare: `You are a healthcare revenue-cycle operations analyst. Base every statement strictly on the metrics provided in the user message. Never invent figures that were not given to you. If data is missing, say so instead of guessing.`,
  strategist: `You are a cross-office healthcare revenue-cycle strategist. Base every statement strictly on the metrics provided in the user message. Never invent figures that were not given to you. If data is missing, say so instead of guessing.`,
  construction: `You are a construction project cost/schedule/compliance analyst. Base every finding strictly on the document content provided in the user message. Never invent cost figures, risk levels, or findings that aren't supported by the actual content given. If the content is too thin to assess, say so plainly instead of guessing.`
};

// TSM FIX: any 429 from Groq (a normal, expected event under shared TPM
// quotas -- see the "RUN HC STRATEGIST ANALYSIS" rate-limit screenshot) was
// thrown straight through as-is: the raw Groq error text ("Rate limit
// reached for model `openai/gpt-oss-120b`... Please try again in
// 7.76...s") landed verbatim in the UI with no retry at all, even though
// Groq tells us almost exactly how long to wait. Added a small
// backoff-and-retry specifically for 429s, using Groq's own Retry-After
// header (falling back to parsing the "try again in Ns" text it embeds)
// capped to a sane wait so a single slow request can't hang the response
// indefinitely. Every other caller (construction.js, queries.js, hc.js,
// etc.) shares this same groqChat(), so they all get the same resilience
// for free. Non-429 failures are unaffected and still throw immediately.
const GROQ_MAX_RETRIES = 2;
const GROQ_MAX_WAIT_MS = 12000;

function parseGroqRetryAfterMs(res, errBody) {
  const header = res.headers?.get?.('retry-after');
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, GROQ_MAX_WAIT_MS);
  }
  const msg = errBody?.error?.message || '';
  const m = msg.match(/try again in ([\d.]+)s/i);
  if (m) {
    const secs = Number(m[1]);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, GROQ_MAX_WAIT_MS);
  }
  return 2000; // sensible default if Groq gives us no hint at all
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function groqChat(systemPrompt, userMessage, maxTokens = 1024) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY not configured on server');

  let lastErr = null;

  for (let attempt = 0; attempt <= GROQ_MAX_RETRIES; attempt++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (r.ok) {
      const data = await r.json();
      return data.choices?.[0]?.message?.content || '';
    }

    const data = await r.json().catch(() => ({}));

    if (r.status === 429 && attempt < GROQ_MAX_RETRIES) {
      const waitMs = parseGroqRetryAfterMs(r, data);
      console.warn(`[groqChat] 429 rate limit, retrying in ${waitMs}ms (attempt ${attempt + 1}/${GROQ_MAX_RETRIES})`);
      await sleep(waitMs);
      lastErr = new Error(data.error?.message || 'Groq rate limit');
      continue;
    }

    if (r.status === 429) {
      // Retries exhausted -- surface something a user can act on instead of
      // the raw quota/org-id blob Groq returns.
      console.error('[groqChat] rate limit persisted after retries:', data.error?.message);
      throw new Error('AI service is temporarily busy (rate limited). Please try again in a few seconds.');
    }

    throw new Error(data.error?.message || 'Groq request failed');
  }

  throw lastErr || new Error('Groq request failed');
}

// callGroq matches the (systemPrompt, userMessage) signature hc.js already calls.
async function callGroq(systemPrompt, userMessage, maxTokens = 1024) {
  return groqChat(systemPrompt, userMessage, maxTokens);
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE FILTERING
// ═══════════════════════════════════════════════════════════════════════════
function filterHCState(state = {}, system = '', location = '') {
  const out = {};
  for (const [nodeKey, node] of Object.entries(state || {})) {
    if (!node || typeof node !== 'object') continue;
    const nodeSystem = String(node.system || '').trim();
    const nodeLocation = String(node.location || '').trim();
    const systemOk = !system || nodeSystem === system;
    const locationOk = !location || location === 'All' || nodeLocation === location;
    if (systemOk && locationOk) out[nodeKey] = node;
  }
  return out;
}

// Recognize a lane from either a bare key ('billing') or an office-qualified
// key ('billing-scottsdale-shea'), since the node-state architecture doesn't
// enforce one convention (see write endpoint: state[nodeKey] = merged with
// an arbitrary nodeKey from the URL).
const KNOWN_LANES = ['operations', 'billing', 'insurance', 'compliance', 'medical'];

function laneFor(nodeKey = '') {
  const k = String(nodeKey || '').toLowerCase();
  for (const lane of KNOWN_LANES) {
    if (k === lane || k.startsWith(lane + '-') || k.startsWith(lane + '_')) {
      return lane;
    }
  }
  return k || 'unassigned';
}

function laneLabel(lane) {
  return lane ? lane.charAt(0).toUpperCase() + lane.slice(1) : 'Unassigned';
}

// ═══════════════════════════════════════════════════════════════════════════
// RCM MATH — honestly grounded, explicitly labeled assumptions
//
// Design constraint: the node schema has NO claim-volume field (no
// totalClaims / claimVolume anywhere). That means denialRate (a %) cannot
// be turned into a dollar figure without inventing a claim-count and a
// cost-per-claim — that's fabrication, so we don't do it.
//
// Instead:
//   - Dollar totals (revenueAtRisk, recoverable*) are built ONLY from fields
//     that are already dollar-denominated in the node data: arOver30,
//     pendingClaimsValue, auditExposure. Summed directly, no invented
//     conversion factor.
//   - AR aging collectability uses a commonly-cited RCM benchmarking curve.
//     This is an INDUSTRY PLANNING ESTIMATE, not this facility's measured
//     collection data. Labeled as such below and in every output.
//   - Auth-delay risk uses a graduated multiplier on pendingClaimsValue
//     based on authDelayHours thresholds — grounded in the well-established
//     directional relationship between prior-auth delay and claim
//     abandonment/denial risk. Labeled as a planning assumption, not a
//     precise published curve.
//   - denialRate, queueDepth, authBacklog, openFindings, chartDefects stay
//     ORDINAL-only inputs: they rank which lane is worst (for top[]
//     ordering) but are never converted into dollars.
// ═══════════════════════════════════════════════════════════════════════════

// Blended AR>30 collectability, PLANNING ESTIMATE (industry RCM benchmarking,
// not measured facility data): of dollars sitting in AR>30, roughly this
// fraction is realistically collectable in each window.
const AR_COLLECTABILITY = {
  within72h: 0.05,   // very little AR>30 clears in 72h regardless of age mix
  within30d: 0.35
};

// Graduated auth-delay multiplier applied to pendingClaimsValue.
// PLANNING ASSUMPTION: longer prior-auth delay -> lower near-term recovery
// odds and higher ultimate abandonment/denial risk. Thresholds and
// percentages are directional estimates, not a published/measured curve.
function authDelayRecoveryFactors(authDelayHours = 0) {
  const h = Number(authDelayHours) || 0;
  if (h < 24)  return { within72h: 0.70, within30d: 0.92 };
  if (h < 48)  return { within72h: 0.45, within30d: 0.80 };
  if (h < 72)  return { within72h: 0.20, within30d: 0.60 };
  return           { within72h: 0.08, within30d: 0.35 };
}

// Compliance exposure is treated as fully at-risk; recovery requires
// remediation work rather than fast collection, so near-term recoverable
// share is intentionally small. PLANNING ASSUMPTION.
const AUDIT_RECOVERY = { within72h: 0.02, within30d: 0.20 };

// Ordinal risk score — used ONLY to rank lanes for top[] ordering, never
// converted to a dollar amount.
function nodeRiskScore(nodeKey, node = {}) {
  const lane = laneFor(nodeKey);
  let score = 0;
  if (lane === 'billing') {
    score = (Number(node.denialRate) || 0) * 4 + (Number(node.claimLagDays) || 0) * 2;
  } else if (lane === 'insurance') {
    score = (Number(node.authDelayHours) || 0) * 1.5 + (Number(node.authBacklog) || 0) * 3;
  } else if (lane === 'operations') {
    score = (Number(node.queueDepth) || 0) * 2 + (Number(node.intakeBacklog) || 0) * 2
          + Math.max(0, 100 - (Number(node.staffingCoverage) || 100));
  } else if (lane === 'compliance') {
    score = (Number(node.openFindings) || 0) * 10 + (Number(node.auditExposure) || 0) / 5000;
  } else if (lane === 'medical') {
    score = (Number(node.chartDefects) || 0) * 5;
  } else {
    score = 1; // unknown lane, low ordinal weight
  }
  return score;
}

function aggregateLayer2(state = {}) {
  let revenueAtRisk = 0;
  let recoverable72h = 0;
  let recoverable30d = 0;

  const ranked = [];

  for (const [nodeKey, node] of Object.entries(state || {})) {
    if (!node || typeof node !== 'object') continue;
    const lane = laneFor(nodeKey);

    // --- Dollar-denominated fields only ---
    if (lane === 'billing' && node.arOver30 != null) {
      const ar = Number(node.arOver30) || 0;
      revenueAtRisk += ar;
      recoverable72h += ar * AR_COLLECTABILITY.within72h;
      recoverable30d += ar * AR_COLLECTABILITY.within30d;
    }

    if (lane === 'insurance' && node.pendingClaimsValue != null) {
      const pcv = Number(node.pendingClaimsValue) || 0;
      const f = authDelayRecoveryFactors(node.authDelayHours);
      revenueAtRisk += pcv;
      recoverable72h += pcv * f.within72h;
      recoverable30d += pcv * f.within30d;
    }

    if (lane === 'compliance' && node.auditExposure != null) {
      const ae = Number(node.auditExposure) || 0;
      revenueAtRisk += ae;
      recoverable72h += ae * AUDIT_RECOVERY.within72h;
      recoverable30d += ae * AUDIT_RECOVERY.within30d;
    }

    // --- Ordinal ranking (never converted to dollars) ---
    ranked.push({ nodeKey, lane, node, riskScore: nodeRiskScore(nodeKey, node) });
  }

  ranked.sort((a, b) => b.riskScore - a.riskScore);
  const top = ranked.slice(0, 5);

  return {
    revenueAtRisk: Math.round(revenueAtRisk),
    recoverable72h: Math.round(recoverable72h),
    recoverable30d: Math.round(recoverable30d),
    top,
    assumptions: {
      arCollectability: AR_COLLECTABILITY,
      authDelayModel: 'graduated multiplier on pendingClaimsValue by authDelayHours threshold',
      auditRecovery: AUDIT_RECOVERY,
      note: 'AR and auth-delay recovery percentages are industry-benchmark planning estimates, not measured collection data for this facility. denialRate/queueDepth/etc. are ordinal risk-ranking inputs only and are never converted to dollars.'
    }
  };
}

function bestNextActionsFor(top = []) {
  const actions = [];
  for (const t of top.slice(0, 3)) {
    if (t.lane === 'billing') actions.push('Clear highest-value AR>30 backlog and resubmit clean claims');
    else if (t.lane === 'insurance') actions.push('Escalate prior-auth blockers older than 24–48 hours');
    else if (t.lane === 'operations') actions.push('Rebalance intake/scheduling coverage for the next shift');
    else if (t.lane === 'compliance') actions.push('Remediate open audit findings by severity');
    else if (t.lane === 'medical') actions.push('Address chart documentation defects at the source');
  }
  return actions.length ? actions : ['No qualifying node pressure found — awaiting live telemetry'];
}

function buildLayer2Summary(state = {}, system = '', location = '') {
  const result = aggregateLayer2(state);
  const topEntry = result.top[0];
  const highestYieldLane = topEntry ? laneLabel(topEntry.lane) : 'Unassigned';

  // Flatten a representative node's metrics per lane for callers (strategist.js)
  // that read layer2.denialRate / layer2.authDelayHours / layer2.queueDepth directly.
  const billingNode = Object.entries(state).find(([k]) => laneFor(k) === 'billing')?.[1] || {};
  const insuranceNode = Object.entries(state).find(([k]) => laneFor(k) === 'insurance')?.[1] || {};
  const opsNode = Object.entries(state).find(([k]) => laneFor(k) === 'operations')?.[1] || {};

  return {
    system,
    location,
    revenueAtRisk: result.revenueAtRisk,
    recoverable72h: result.recoverable72h,
    recoverable30d: result.recoverable30d,
    cashAcceleration14d: Math.round(result.recoverable30d * 0.7),
    highestYieldLane,
    top: result.top,
    bestNextActions: bestNextActionsFor(result.top),
    denialRate: billingNode.denialRate ?? 0,
    claimLagDays: billingNode.claimLagDays ?? 0,
    authDelayHours: insuranceNode.authDelayHours ?? 0,
    authBacklog: insuranceNode.authBacklog ?? 0,
    queueDepth: opsNode.queueDepth ?? 0,
    assumptions: result.assumptions
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-OFFICE ROLLUP
// ═══════════════════════════════════════════════════════════════════════════
function buildSystemRollup(state = {}, system = '', topN = 3) {
  // Group nodes by officeName/location field on the node itself (not by key,
  // since key convention isn't guaranteed — see laneFor() comment above).
  const byOffice = {};
  for (const [nodeKey, node] of Object.entries(state || {})) {
    if (!node || typeof node !== 'object') continue;
    if (system && (node.system || '') !== system) continue;
    const officeName = node.officeName || node.location || 'Unknown';
    if (!byOffice[officeName]) byOffice[officeName] = {};
    byOffice[officeName][nodeKey] = node;
  }

  const offices = Object.entries(byOffice).map(([officeName, officeState]) => {
    const result = aggregateLayer2(officeState);
    const topEntry = result.top[0];
    return {
      officeName,
      location: officeName,
      highestYieldLane: topEntry ? laneLabel(topEntry.lane) : 'Unassigned',
      revenueAtRisk: result.revenueAtRisk,
      recoverable72h: result.recoverable72h,
      recoverable30d: result.recoverable30d
    };
  });

  offices.sort((a, b) => b.revenueAtRisk - a.revenueAtRisk);
  const topOffices = offices.slice(0, topN);

  const totalRevenueAtRisk = offices.reduce((s, o) => s + o.revenueAtRisk, 0);
  const totalRecoverable72h = offices.reduce((s, o) => s + o.recoverable72h, 0);
  const totalRecoverable30d = offices.reduce((s, o) => s + o.recoverable30d, 0);

  return {
    offices,
    topOffices,
    totalRevenueAtRisk,
    totalRecoverable72h,
    totalRecoverable30d,
    totalCashAcceleration14d: Math.round(totalRecoverable30d * 0.7)
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STRATEGIST SYSTEM POSTURE
// officePayloads: [{ office, state, layer2 }]  (layer2 already computed by caller)
// ═══════════════════════════════════════════════════════════════════════════
function buildStrategistSystemPosture(system = '', officePayloads = []) {
  const officeRanking = officePayloads.map(({ office, layer2 }) => {
    const revenueAtRisk = layer2?.revenueAtRisk || 0;
    let status = 'stable';
    if (revenueAtRisk >= 200000) status = 'high';
    else if (revenueAtRisk >= 100000) status = 'medium';

    return {
      office,
      status,
      revenueAtRisk,
      summary: `${office}: $${revenueAtRisk.toLocaleString()} at risk, ${layer2?.highestYieldLane || 'Unassigned'} is the highest-yield lane.`
    };
  }).sort((a, b) => b.revenueAtRisk - a.revenueAtRisk);

  const totalRevenueAtRisk = officeRanking.reduce((s, o) => s + o.revenueAtRisk, 0);
  const bestPerformingOffice = officeRanking.length
    ? officeRanking[officeRanking.length - 1].office
    : 'N/A';
  const worstPerformingOffice = officeRanking.length
    ? officeRanking[0].office
    : 'N/A';

  return {
    ok: true,
    officeRanking,
    systemPosture: {
      system,
      bestPerformingOffice,
      worstPerformingOffice,
      totalRevenueAtRisk
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIENCE BRIEF — raw, template-built narrative from REAL computed figures.
// This is the fallback used if Groq isn't available, and the "operational
// context" fed to Groq when it is. No hardcoded dollar figures anywhere.
// ═══════════════════════════════════════════════════════════════════════════
function buildAudienceBrief({ system = '', location = '', audience = 'om', format = 'brief', question = '', filtered = {}, result = {} }) {
  const revenueAtRisk = Number(result.revenueAtRisk || 0);
  const recoverable72h = Number(result.recoverable72h || 0);
  const recoverable30d = Number(result.recoverable30d || 0);
  const cashAcceleration14d = Number(result.cashAcceleration14d || Math.round(recoverable30d * 0.7));
  const highestYieldLane = result.highestYieldLane || 'Unassigned';
  const actions = bestNextActionsFor(result.top || []);

  const lines = [
    `${system || 'This system'}${location ? ' — ' + location : ''}: $${revenueAtRisk.toLocaleString()} in revenue at risk.`,
    `Recoverable in 72 hours: $${recoverable72h.toLocaleString()}. Recoverable in 30 days: $${recoverable30d.toLocaleString()}. Projected 14-day cash acceleration: $${cashAcceleration14d.toLocaleString()}.`,
    `Highest-yield lane: ${highestYieldLane}.`,
    `Recommended next actions: ${actions.join('; ')}.`
  ];

  if (question) lines.push(`Regarding "${question}": see the figures and actions above, drawn from current node telemetry.`);

  if (!Object.keys(filtered).length) {
    lines.unshift('No live node telemetry is currently reporting for this system/location — figures below are $0 until nodes report data.');
  }

  return lines.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// buildHCBrief — used by strategist.js dashboard route. Synchronous template
// brief (no Groq call) so it's safe to embed in a larger dashboard payload
// without an extra round-trip; /api/hc/brief remains the Groq-polished path.
// ═══════════════════════════════════════════════════════════════════════════
function buildHCBrief({ system = '', location = '', audience = 'om', format = 'brief', question = '' } = {}, state = {}) {
  const filtered = filterHCState(state, system, location);
  const result = aggregateLayer2(filtered);
  const topEntry = result.top[0];
  result.highestYieldLane = topEntry ? laneLabel(topEntry.lane) : 'Unassigned';
  result.cashAcceleration14d = Math.round(result.recoverable30d * 0.7);

  return buildAudienceBrief({ system, location, audience, format, question, filtered, result });
}

module.exports = {
  readJson,
  writeJson,
  HC_NODE_STATE_FILE,
  HC_REPORTS_FILE,
  HC_PROFILES_FILE,
  hcNodeStateFile,
  hcReportsFile,
  hcProfilesFile,
  hcIntakeQueueFile,
  resolveHcClientId,
  sanitizeClientId,
  groqChat,
  callGroq,
  SP,
  filterHCState,
  laneFor,
  aggregateLayer2,
  buildLayer2Summary,
  buildSystemRollup,
  buildStrategistSystemPosture,
  buildAudienceBrief,
  buildHCBrief
};