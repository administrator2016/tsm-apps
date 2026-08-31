'use strict';
const express = require('express');
const router  = express.Router();
const fs = require('fs');
const {
  readJson, writeJson,
  hcNodeStateFile, hcReportsFile, hcProfilesFile, hcIntakeQueueFile, resolveHcClientId,
  aggregateLayer2, buildSystemRollup,
  groqChat, callGroq, SP
} = require('./_shared');
const { requireAnyAuth } = require('../middleware/require-auth');

// GCU PILOT FIX 2026-08-26: every /api/hc/* route below handled PHI with no
// auth check at all. Gate the whole router behind a valid tsm_session cookie
// (same signed-cookie check BPO's routes already use). Sample-mode pages
// don't hit these endpoints — they read local sample data client-side — so
// this only blocks unauthenticated access to live data.
router.use('/api/hc', requireAnyAuth);

// Canonical 11 HC nodes (mirrors NODES/NODE_KEYS in hc-academy poc-html and
// the preferredOrder list used elsewhere in this file).
const HC_NODE_KEYS = ['operations','medical','pharmacy','insurance','financial','legal','vendors','compliance','billing','taxprep','grants'];

// TSM FIX: this used to be a hardcoded stub in server.js
// (`nodes_online: 11, executive_escalations: 3` no matter what) that never
// read HC_NODE_STATE_FILE at all. Moved here and wired to real state so the
// numbers reflect what's actually been escalated.
router.get('/api/hc/strategist-rollup', (req, res) => {
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
  const nodesOnline = HC_NODE_KEYS.filter(k => state[k]).length;
  const executiveEscalations = HC_NODE_KEYS.filter(k => state[k] && String(state[k].status || '').toLowerCase() === 'critical').length;
  res.json({
    ok: true,
    controller: 'HC STRATEGIST',
    status: nodesOnline > 0 ? 'ROLLUP ACTIVE' : 'AWAITING FIRST ESCALATION',
    nodes_online: nodesOnline,
    executive_escalations: executiveEscalations,
    bnca: nodesOnline > 0 ? 'Enterprise healthcare synthesis complete' : 'No node-level findings escalated yet',
    mesh: true,
    timestamp: new Date().toISOString()
  });
});

router.get('/api/hc/reports', (req, res) => {
  const reports = readJson(hcReportsFile(resolveHcClientId(req)), []);
  res.json({ ok: true, count: reports.length, reports });
});

router.post('/api/hc/reports', (req, res) => {
  const reports = readJson(hcReportsFile(resolveHcClientId(req)), []);
  const now = new Date().toISOString();
  const report = {
    id: `rpt_${Date.now()}`,
    title: req.body.title || 'Untitled Report',
    company: req.body.company || 'General Healthcare',
    query: req.body.query || '',
    summary: req.body.summary || '',
    nodeResults: req.body.nodeResults || {},
    createdAt: now,
    updatedAt: now
  };
  reports.unshift(report);
  writeJson(hcReportsFile(resolveHcClientId(req)), reports.slice(0, 300));
  res.json({ ok: true, report });
});

router.delete('/api/hc/reports/:id', (req, res) => {
  const reports = readJson(hcReportsFile(resolveHcClientId(req)), []);
  const next = reports.filter(r => r.id !== req.params.id);
  writeJson(hcReportsFile(resolveHcClientId(req)), next);
  res.json({ ok: true });
});

router.get('/api/hc/nodes', (req, res) => {
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
  res.json({ ok: true, state, generatedAt: new Date().toISOString() });
});

router.post('/api/hc/nodes/:nodeKey', (req, res) => {
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
  const prior = state[req.params.nodeKey] || {};
  const merged = {
    ...prior,
    ...req.body,
    nodeKey: req.params.nodeKey,
    updatedAt: new Date().toISOString()
  };

  // ── ANOMALY HISTORY (append-only, never overwritten) ─────────────────────
  // Prior to this, every relay push replaced `findings` wholesale — so an
  // 'anomaly-resolved' push destroyed the record that an anomaly was ever
  // detected in the first place, and there was no durable open/resolved
  // status a dashboard or exec portal could actually query. This preserves
  // prior.anomalyHistory (spread already carried it forward above) and only
  // appends; it never truncates or rewrites past entries.
  const trigger = req.body.relayTrigger;
  if (trigger === 'anomaly-detected' || trigger === 'anomaly-resolved') {
    const history = Array.isArray(prior.anomalyHistory) ? prior.anomalyHistory.slice() : [];
    history.push({
      trigger,
      status: trigger === 'anomaly-resolved' ? 'resolved' : 'detected',
      note: req.body.findings || null,
      at: merged.updatedAt
    });
    merged.anomalyHistory = history;
    // anomalyStatus reflects only the most recent anomaly event — it is
    // deliberately separate from `status` (ONLINE/CRITICAL telemetry field,
    // already in use elsewhere) to avoid colliding with existing consumers.
    merged.anomalyStatus = trigger === 'anomaly-resolved' ? 'resolved' : 'open';
    merged.anomalyResolvedAt = trigger === 'anomaly-resolved' ? merged.updatedAt : (prior.anomalyResolvedAt || null);
  }

  // ── ANOMALIES LIST (id-keyed merge, not overwrite) ────────────────────────
  // The HC Academy PoC (html/healthcare/hc-academy/poc-html/index.html) posts
  // a structured { id, text, resolved } array per node on escalation. Same
  // overwrite bug as findings used to have: without this, re-escalating the
  // same node after new findings appear would silently erase every
  // previously-tracked item instead of updating/adding to them.
  if (Array.isArray(req.body.anomalies)) {
    const priorAnomalies = Array.isArray(prior.anomalies) ? prior.anomalies : [];
    const byId = new Map(priorAnomalies.map(a => [a.id, a]));
    req.body.anomalies.forEach(a => { if (a && a.id) byId.set(a.id, a); });
    merged.anomalies = Array.from(byId.values());
  }

  // Generate live BNCA from actual node telemetry
  const n = merged;
  merged.bnca = `TOP ISSUE
${n.findings || 'Cross-lane operational drag is the primary issue.'}

WHY IT MATTERS
Live telemetry received for ${n.system || 'this system'} · ${n.location || 'all locations'}.

METRICS
Queue Depth: ${n.queueDepth ?? 'N/A'} · Intake Backlog: ${n.intakeBacklog ?? 'N/A'} · Staffing: ${n.staffingCoverage ?? 'N/A'}%
Denial Rate: ${n.denialRate ?? 'N/A'}% · Claim Lag: ${n.claimLagDays ?? 'N/A'} days · AR >30: ${n.arOver30 ?? 'N/A'}
Auth Backlog: ${n.authBacklog ?? 'N/A'} · Auth Delay: ${n.authDelayHours ?? 'N/A'}h · Pending Claims: ${n.pendingClaimsValue ?? 'N/A'}

BEST NEXT COURSE OF ACTION
1. Clear highest-value backlog first
2. Escalate auth and documentation blockers older than 24-72 hours
3. Align intake, billing, and scheduling handoffs for the next shift

OWNER LANES
Operations · Billing · Insurance

CONFIDENCE
92%`;

  state[req.params.nodeKey] = merged;
  writeJson(hcNodeStateFile(resolveHcClientId(req)), state);
  res.json({ ok: true, node: state[req.params.nodeKey] });
});

// ── HC OFFICE MANAGER NEURAL INTAKE ─────────────────────────────────────────
// Replaces the advisory-routing layer removed in c234599d, which was pure
// browser-bridge + standalone module with zero server wiring (confirmed via
// grep at the time, hence the clean removal). This version is wired into the
// same requireAnyAuth-gated router and the same hcIntakeQueueFile per-client
// storage pattern as node state/reports/profiles above — no standalone file.
//
// An intake event is a ROUTING SUGGESTION only. It never writes into a
// node's findings/bnca (that stays each node page's own relayToStrategist()
// job) and its status never implies the target node accepted or processed
// anything — 'suggested' -> 'routed' just means an office manager opened
// that node from here, 'dismissed' means they rejected the suggestion.
const { classifyIntake } = require('../server/healthcare/hc-neural-intake');
const { validateIntakeEvent } = require('../server/healthcare/hc-node-contract');

router.get('/api/hc/intake', (req, res) => {
  const queue = readJson(hcIntakeQueueFile(resolveHcClientId(req)), []);
  res.json({ ok: true, count: queue.length, queue });
});

router.post('/api/hc/intake', (req, res) => {
  const { ok, errors, description } = validateIntakeEvent(req.body);
  if (!ok) return res.status(400).json({ ok: false, errors });

  const classification = classifyIntake(description);
  const event = {
    id: `intk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    description,
    ...classification,
    status: 'suggested',
    createdAt: new Date().toISOString(),
    routedAt: null,
  };

  const queue = readJson(hcIntakeQueueFile(resolveHcClientId(req)), []);
  queue.unshift(event);
  writeJson(hcIntakeQueueFile(resolveHcClientId(req)), queue.slice(0, 500));

  res.json({ ok: true, event });
});

// Office manager confirms routing (opens the suggested node) or dismisses
// the suggestion. This is the only mutation allowed post-creation — the
// classification itself is never edited after the fact, so the record of
// what was actually suggested stays intact even if the office manager
// disagreed with it.
router.post('/api/hc/intake/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['routed', 'dismissed'].includes(status)) {
    return res.status(400).json({ ok: false, error: "status must be 'routed' or 'dismissed'" });
  }
  const clientId = resolveHcClientId(req);
  const queue = readJson(hcIntakeQueueFile(clientId), []);
  const event = queue.find(e => e.id === req.params.id);
  if (!event) return res.status(404).json({ ok: false, error: 'intake event not found' });

  event.status = status;
  if (status === 'routed') event.routedAt = new Date().toISOString();
  writeJson(hcIntakeQueueFile(clientId), queue);

  res.json({ ok: true, event });
});

// Real open-vs-resolved anomaly counts across all 11 nodes, sourced from
// anomalyHistory/anomalyStatus (see POST /api/hc/nodes/:nodeKey above) —
// not fabricated, not estimated. Nodes with no anomaly activity yet are
// simply absent from `nodes` rather than padded with zeros.
router.get('/api/hc/anomalies/summary', (req, res) => {
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
  const nodes = {};
  let open = 0, resolved = 0;
  HC_NODE_KEYS.forEach(key => {
    const n = state[key];
    if (!n || !Array.isArray(n.anomalyHistory) || !n.anomalyHistory.length) return;
    nodes[key] = {
      anomalyStatus: n.anomalyStatus || 'open',
      events: n.anomalyHistory.length,
      resolvedAt: n.anomalyResolvedAt || null
    };
    if (n.anomalyStatus === 'resolved') resolved++; else open++;
  });
  res.json({ ok: true, open, resolved, nodes, generatedAt: new Date().toISOString() });
});

router.get('/api/hc/profiles', (req, res) => {
  res.json({ ok: true, profiles: readJson(hcProfilesFile(resolveHcClientId(req)), []) });
});

router.get('/api/hc/nodes/filter', (req, res) => {
  const { system = '', location = '' } = req.query;
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
  const filtered = Object.fromEntries(
    Object.entries(state).filter(([_, v]) => {
      return (!system || v.system === system) &&
             (!location || location === 'All' || v.location === location);
    })
  );
  res.json({ ok: true, state: filtered });
});

router.post('/api/hc/bnca', (req, res) => {
  const { system = '', location = '' } = req.body || {};
  const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});

  const nodes = Object.values(state).filter(v =>
    (!system || v.system === system) &&
    (!location || location === 'All' || v.location === location)
  );

  const top = nodes.find(v => v.findings)?.findings || 'Operational drag across nodes';

  res.json({
    ok: true,
    bnca: {
      system,
      location,
      topIssue: top,
      whyItMatters: 'Revenue + throughput pressure',
      bestNextCourseOfAction: [
        'Clear high-value backlog',
        'Escalate auth delays',
        'Rebalance intake + billing'
      ],
      ownerLanes: ['Operations', 'Billing', 'Insurance'],
      confidence: '88%'
    }
  });
});

router.post('/api/hc/layer2', (req, res) => {
  try {
    const { system = '', location = '' } = req.body || {};
    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});

    const filtered = Object.fromEntries(
      Object.entries(state).filter(([_, n]) =>
        (!system || (n.system || '') === system) &&
        (!location || location === 'All' || (n.location || '') === location)
      )
    );

    const result = aggregateLayer2(filtered);
    const top = result.top;

    const rootCauseLines = top.map(t => {
      if (t.nodeKey === 'operations') {
        return `- Operations: queue ${t.node.queueDepth ?? 'N/A'}, backlog ${t.node.intakeBacklog ?? 'N/A'}, staffing ${t.node.staffingCoverage ?? 'N/A'}%`;
      }
      if (t.nodeKey === 'billing') {
        return `- Billing: denial ${t.node.denialRate ?? 'N/A'}%, lag ${t.node.claimLagDays ?? 'N/A'}d`;
      }
      if (t.nodeKey === 'insurance') {
        return `- Insurance: auth backlog ${t.node.authBacklog ?? 'N/A'}, delay ${t.node.authDelayHours ?? 'N/A'}h`;
      }
      if (t.nodeKey === 'compliance') {
        return `- Compliance: open findings ${t.node.openFindings ?? 'N/A'}, exposure $${t.node.auditExposure ?? 'N/A'}`;
      }
      if (t.nodeKey === 'medical') {
        return `- Medical: chart defects ${t.node.chartDefects ?? 'N/A'}`;
      }
      return `- ${t.nodeKey}: active pressure`;
    }).join('\n');

    const topIssue = top.length
      ? `${top.map(t => t.nodeKey).join(' + ')} are compounding into reimbursement and throughput drag.`
      : 'No qualifying node pressure found.';

    const highestYieldLane = top[0]?.nodeKey
      ? top[0].nodeKey.charAt(0).toUpperCase() + top[0].nodeKey.slice(1)
      : 'Unassigned';

    const cashAcceleration14d = Math.round(result.recoverable30d * 0.7);

    const output = `TOP ISSUE
${topIssue}

SYSTEM
${system || 'General Healthcare'}

LOCATION
${location || 'All'}

REVENUE AT RISK
$${result.revenueAtRisk.toLocaleString()}

RECOVERABLE VALUE
72 HOURS: $${result.recoverable72h.toLocaleString()}
30 DAYS: $${result.recoverable30d.toLocaleString()}

PROJECTED CASH ACCELERATION
14 DAYS: $${cashAcceleration14d.toLocaleString()}

HIGHEST-YIELD LANE
${highestYieldLane}

ROOT CAUSE
${rootCauseLines || '- No live node telemetry'}

BEST NEXT COURSE OF ACTION
1. Clear the highest-value backlog first
2. Escalate auth and documentation blockers older than 24–72 hours
3. Align intake, billing, and scheduling handoffs for the next shift

OWNER LANES
Operations · Billing · Insurance · Compliance

CONFIDENCE
91%`;

    res.json({
      ok: true,
      output,
      revenueAtRisk: result.revenueAtRisk,
      recoverable72h: result.recoverable72h,
      recoverable30d: result.recoverable30d,
      cashAcceleration14d,
      highestYieldLane,
      top: result.top
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/hc/rollup', (req, res) => {
  try {
    const { system = '', top_n = 3 } = req.body || {};
    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
    const rollup = buildSystemRollup(state, system, Number(top_n || 3));

    res.json({
      ok: true,
      system,
      ...rollup
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/hc/brief', async (req, res) => {
  try {
    const {
      system = '',
      location = '',
      audience = 'om',
      format = 'brief',
      question = ''
    } = req.body || {};

    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
    const filtered = Object.fromEntries(
      Object.entries(state).filter(([_, n]) =>
        (!system || (n.system || '') === system) &&
        (!location || location === 'All' || (n.location || '') === location)
      )
    );

    const result = aggregateLayer2(filtered);

    const highestYieldLane =
      result.top?.[0]?.nodeKey
        ? result.top[0].nodeKey.charAt(0).toUpperCase() + result.top[0].nodeKey.slice(1)
        : 'Unassigned';

    result.highestYieldLane = highestYieldLane;
    result.cashAcceleration14d = result.cashAcceleration14d || Math.round((result.recoverable30d || 0) * 0.7);

    const rawBrief = buildAudienceBrief({
      system, location, audience, format, question, filtered, result
    });

    const audienceLabel = { om: 'Office Manager', director: 'Director', cfo: 'CFO', ceo: 'CEO' }[audience] || 'leadership';
    const formatLabel = { brief: 'executive brief', email: 'professional email', status_update: 'status update', talking_points: 'bullet-point talking points' }[format] || 'brief';

    const topNode = result.top?.[0]?.node || {};
    const topNodeDetail = [
      topNode.authBacklog != null ? `auth backlog ${topNode.authBacklog}` : null,
      topNode.authDelayHours != null ? `avg auth delay ${topNode.authDelayHours}h` : null,
      topNode.denialRate != null ? `denial rate ${topNode.denialRate}%` : null
    ].filter(Boolean).join(', ');

    const systemPrompt = `You are a senior healthcare revenue cycle strategist writing on behalf of the Revenue Cycle team at ${system || 'the health system'} ${location || ''}.

You will be given the ACTUAL computed figures for this office/system, derived from live node telemetry. Use ONLY those figures — do not invent, round dramatically, or substitute different numbers. If a figure is missing or zero, say so plainly rather than making one up.

RULES:
1. Open with a specific dollar figure or action — never with 'I am writing to' or 'I wanted to reach out'
2. Never use placeholder names like [CFO Name] or [Your Name] — omit the salutation and sign off as 'Revenue Cycle${location ? ' · ' + location : ''}'
3. Never fabricate context like 'following our previous discussion'
4. Every sentence ties to a dollar figure, a lane, or a named action with an owner
5. Output must be copy-paste ready — no brackets, no blanks, no instructions to the reader
6. Only name a specific payer if it appears in the data provided

Audience: ${audienceLabel}
Format: ${formatLabel} — ${format === 'email' ? 'include Subject: line, then the email body, then sign off as Revenue Cycle' + (location ? ' · ' + location : '') : format === 'talking_points' ? 'tight bullets, dollar figure on every line' : format === 'status_update' ? 'structured paragraphs, metrics up front' : 'two paragraphs max, action and dollar impact only'}`;

    const userMessage = `ACTUAL FIGURES — computed from live node data, use only these:
- Revenue at risk: $${Number(result.revenueAtRisk || 0).toLocaleString()}
- Recoverable in 72 hours: $${Number(result.recoverable72h || 0).toLocaleString()}
- Recoverable in 30 days: $${Number(result.recoverable30d || 0).toLocaleString()}
- 14-day cash acceleration: $${Number(result.cashAcceleration14d || 0).toLocaleString()}
- Highest-yield lane: ${highestYieldLane}
${topNodeDetail ? '- Top lane detail: ' + topNodeDetail : ''}

Operational context (narrative only):
${rawBrief}

${question ? 'The reader specifically asked: ' + question : ''}

Write the ${formatLabel} for the ${audienceLabel} now. Sharp, specific, sendable. Only use the figures above — do not introduce other numbers.`;

    let brief = rawBrief; // fallback if Groq fails
    try {
      const groqResult = await callGroq(systemPrompt, userMessage);
      if (groqResult) brief = groqResult;
    } catch(groqErr) {
      console.error('Groq brief failed, using template fallback:', groqErr.message);
    }

    res.json({
      ok: true,
      brief,
      audience,
      format,
      system,
      location,
      revenueAtRisk: result.revenueAtRisk || 0,
      recoverable72h: result.recoverable72h || 0,
      recoverable30d: result.recoverable30d || 0,
      cashAcceleration14d: result.cashAcceleration14d || 0,
      highestYieldLane
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/hc/query', async (req,res)=>{
  try{
    const {query='',system='',location='',nodeKey='',message='',maxTokens} = req.body||{};

    // Full-context strategist analysis path. hc-strategist/index.html and
    // hc-main-strategist.html (the "RUN HC STRATEGIST ANALYSIS" button) post
    // a rich HC-mesh context in `system` plus a detailed BRIEF/JSON prompt in
    // `message`, and read the answer back from `data.output`. That never
    // matched anything below: this handler only ever read query/nodeKey and
    // returned `content`, never `output`, so the strategist's `if(data.output)`
    // check always failed and threw "AI returned an empty response. Try
    // again." even on a healthy server. Route it to a real Groq call instead.
    if (message) {
      const systemPrompt = system ? SP.strategist + '\n\n' + system : SP.strategist;
      const answer = await callGroq(systemPrompt, message, maxTokens || 1024);
      return res.json({ ok: true, output: answer, content: answer, answer, reply: answer });
    }

    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
    // Groq persona analysis for specific node
    if(nodeKey && state[nodeKey]) {
      const n = state[nodeKey];
      const sp = `You are the ${nodeKey.toUpperCase()} specialist for HonorHealth Scottsdale - Shea. Use the actual metrics. Be specific and actionable. Max 8 lines.`;
      const um = `QUERY: ${query||'Provide BNCA analysis'}\nDATA: ${JSON.stringify({findings:n.findings,...n})}`;
      const gr = await callGroq(sp, um);
      return res.json({ok:true, content: gr || n.bnca || n.findings || 'No data'});
    }

    const nodes = Object.values(state).filter(n=>
      (!system || n.system===system) &&
      (!location || location==='All' || n.location===location)
    );

    if(nodes.length===0){
      return res.json({
        ok:true,
        content:`TOP ISSUE
No live node data available.

WHY IT MATTERS
The strategist is scoped correctly, but no matching node has reported data yet.

BEST NEXT COURSE OF ACTION
1. Post live node telemetry for the selected system/location
2. Re-run BNCA after node sync
3. Validate filtered node coverage

OWNER LANES
Operations · Billing · Insurance

CONFIDENCE
65%`
      });
    }

    const preferredOrder = ['operations','billing','insurance','compliance','medical','financial','pharmacy','legal','grants','vendors','taxprep'];

    nodes.sort((a,b)=>{
      const ai = preferredOrder.indexOf((a.nodeKey||'').toLowerCase());
      const bi = preferredOrder.indexOf((b.nodeKey||'').toLowerCase());
      const av = ai === -1 ? 999 : ai;
      const bv = bi === -1 ? 999 : bi;
      return av - bv;
    });

    const n = nodes[0];

    const queueDepth = n.queueDepth ?? 'N/A';
    const intakeBacklog = n.intakeBacklog ?? 'N/A';
    const staffingCoverage = n.staffingCoverage ?? 'N/A';
    const noShowRate = n.noShowRate ?? 'N/A';
    const bnca = n.bnca || 'Re-sequence intake coverage, clear aged queues, and rebalance shift coverage.';

    const output = `TOP ISSUE
${n.findings || 'Cross-lane operational drag is the primary issue.'}

SYSTEM
${n.system || system || 'General Healthcare'}

LOCATION
${n.location || location || 'All'}

WHY IT MATTERS
Queue depth ${queueDepth}, intake backlog ${intakeBacklog}, staffing ${staffingCoverage}%, and no-show rate ${noShowRate} are constraining throughput and delaying clean handoffs.

BEST NEXT COURSE OF ACTION
1. Re-sequence intake coverage immediately
2. Clear queues older than 24 hours
3. Rebalance scheduling blocks for the next shift

OWNER LANES
Operations · Front Desk · Scheduling

NODE BNCA
${bnca}

FOLLOW-UP WINDOW
24–72 hours

CONFIDENCE
92%`;

    return res.json({ok:true,content:output});

  }catch(e){
    return res.status(500).json({ok:false,error:e.message});
  }
});

// TSM FIX: this router.post('/api/hc/query', ...) handler was previously
// missing its closing `});` right after the catch block above. Everything
// between here and a stray `});` ~190 lines down — four helper functions
// (filterHCState, normalizeOfficeState, officeRiskModel, summarizeOfficeDriver,
// none of which are called anywhere else in this file or exported) plus five
// router.use(...) static mounts — was being parsed as dead code inside this
// handler's unreachable tail (every branch above already returns). None of
// it ever ran. The static mounts duplicate what server.js already serves
// for the same html/ directory, and this file never `require('path')`, so
// naively closing the brace where it was written would crash on boot the
// moment this route fired. Removed as dead/orphaned rather than reconnected.

router.post('/api/hc/rollup/brief', (req, res) => {
  try {
    const { system = '', audience = 'cfo', format = 'email', top_n = 3 } = req.body || {};
    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
    const rollup = buildSystemRollup(state, system, Number(top_n || 3));
    const top = rollup.topOffices?.[0] || null;

    const brief = `Subject: ${system || 'Healthcare'} System Revenue Risk Update

Team,

Across ${system || 'the system'}, we are currently tracking $${Number(rollup.totalRevenueAtRisk || 0).toLocaleString()} in revenue at risk.

Primary exposure is concentrated at ${top?.officeName || 'N/A'}${top?.location ? ` (${top.location})` : ''}, with ${top?.highestYieldLane || 'Unassigned'} identified as the highest-yield recovery lane.

We expect:
• $${Number(rollup.totalRecoverable72h || 0).toLocaleString()} recoverable within 72 hours
• $${Number(rollup.totalCashAcceleration14d || 0).toLocaleString()} in 14-day cash acceleration

Root drivers include cross-lane pressure in billing, insurance, and operations.

Immediate actions underway:
1. Clear high-value backlog
2. Escalate auth delays >48h
3. Align intake, billing, and scheduling

We will continue monitoring and provide updates as recovery progresses.

— Operations Intelligence`;

    res.json({
      ok: true,
      system,
      audience,
      format,
      brief,
      ...rollup
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/api/hc/alerts', (req, res) => {
  try {
    const { system = '' } = req.body || {};
    const state = readJson(hcNodeStateFile(resolveHcClientId(req)), {});
    const alerts = [];

    Object.entries(state || {}).forEach(([nodeKey, n]) => {
      if (system && (n.system || '') !== system) return;

      if (n.denialRate != null && Number(n.denialRate) > 10) {
        alerts.push({
          type: 'DENIAL_SPIKE',
          severity: 'HIGH',
          nodeKey,
          location: n.location || 'Unknown',
          officeName: n.officeName || '',
          message: `${n.location || 'Unknown'}: denial rate ${n.denialRate}%`
        });
      }

      if (n.authDelayHours != null && Number(n.authDelayHours) > 48) {
        alerts.push({
          type: 'AUTH_DELAY',
          severity: 'HIGH',
          nodeKey,
          location: n.location || 'Unknown',
          officeName: n.officeName || '',
          message: `${n.location || 'Unknown'}: auth delay ${n.authDelayHours}h`
        });
      }

      if (n.queueDepth != null && Number(n.queueDepth) > 25) {
        alerts.push({
          type: 'QUEUE_PRESSURE',
          severity: 'MEDIUM',
          nodeKey,
          location: n.location || 'Unknown',
          officeName: n.officeName || '',
          message: `${n.location || 'Unknown'}: queue depth ${n.queueDepth}`
        });
      }

      if (n.revenueAtRisk != null && Number(n.revenueAtRisk) > 250000) {
        alerts.push({
          type: 'REVENUE_RISK',
          severity: 'HIGH',
          nodeKey,
          location: n.location || 'Unknown',
          officeName: n.officeName || '',
          message: `${n.location || 'Unknown'}: revenue at risk $${Number(n.revenueAtRisk).toLocaleString()}`
        });
      }
    });

    res.json({
      ok: true,
      system,
      count: alerts.length,
      alerts
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// TSM FIX 2026-08-18: removed a second, dead router.post('/api/hc/query', ...)
// handler that was previously here. Express matches routes in registration
// order and the earlier /api/hc/query handler (above, nodeKey-grounded)
// always returns a response on every branch, so this one never actually
// ran — but its presence recreated the exact shadowing hazard the
// 2026-08-16 fix in server.js was written to eliminate. Removed rather than
// reconnected since the earlier handler already covers this route.

module.exports = router;