#!/usr/bin/env node
// Runs every scenario in tests/l1-copilot/pilot-scenarios.json against a
// LIVE /api/l1-copilot/pilot/resolve endpoint and checks the response
// against each scenario's expectations.
//
// This is a black-box HTTP harness, not a unit test — it needs a real
// server running (npm start) with GROQ_API_KEY set, since pilot/resolve
// calls the LLM live. Demo-mode (L1_COPILOT_DEMO_MODE, default on) covers
// ServiceNow/Intune/cloud context so no other live creds are required for
// these DEMO-*/INC-DEMO-* scenarios specifically.
//
// Usage:
//   node run-pilot-scenarios.js [baseUrl]
//   (baseUrl defaults to http://localhost:3000)

const path = require('path');
const scenarios = require('./tests/l1-copilot/pilot-scenarios.json');

const baseUrl = process.argv[2] || 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures = [];

function check(scenarioId, label, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${scenarioId} — ${label}${detail ? `: ${detail}` : ''}`);
  }
}

async function runScenario(s) {
  const body = {
    incident: s.incident,
    asset: s.asset,
    device: s.device
  };
  if (s.cloudProvider) body.cloudProvider = s.cloudProvider;
  if (s.cloudInstance) body.cloudInstance = s.cloudInstance;

  let res, json;
  try {
    res = await fetch(`${baseUrl}/api/l1-copilot/pilot/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    json = await res.json();
  } catch (e) {
    check(s.id, 'request succeeded', false, e.message);
    return;
  }

  check(s.id, 'HTTP 200', res.status === 200, `got ${res.status}`);
  if (!json || json.ok !== true) {
    check(s.id, 'ok:true in response', false, json && json.error);
    return;
  }

  const decision = json.decision || json.analysis || json;
  const recommendedPath = decision.recommended_path;

  check(
    s.id,
    'recommended_path in expectedPaths',
    s.expectedPaths.includes(recommendedPath),
    `got "${recommendedPath}", expected one of [${s.expectedPaths.join(', ')}]`
  );

  if (s.requiredEvidence) {
    check(
      s.id,
      'evidence array present and non-empty',
      Array.isArray(decision.evidence) && decision.evidence.length > 0
    );
  }

  if (s.requireCompletedActionsArray) {
    check(
      s.id,
      'completed_actions is an array',
      Array.isArray(decision.completed_actions)
    );
  }

  console.log(`${s.id} (${s.name}): path=${recommendedPath} provenance=${JSON.stringify(json.provenance || {})}`);
}

(async () => {
  console.log(`Running ${scenarios.length} pilot scenarios against ${baseUrl}\n`);
  for (const s of scenarios) {
    await runScenario(s);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(' -', f);
    process.exitCode = 1;
  }
})();
