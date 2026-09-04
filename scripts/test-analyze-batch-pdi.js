#!/usr/bin/env node
// Smoke test for the L1 Copilot POST /api/l1-copilot/analyze/batch route.
//
// Unlike the other two PDI test scripts (which call the ServiceNow adapter
// module directly), this one hits a RUNNING server over HTTP, because
// analysis goes through the LLM call (groqChat) that only server.js wires
// up — there's no standalone "adapter" module for that side to require
// directly.
//
// Start the server first (in another terminal):
//   node server.js
// then run this script against it. If SERVICENOW_INTEGRATION_ENABLED=true
// and SERVICENOW_INSTANCE_URL/credentials are set as real env vars on that
// running server, each ticket below that includes an `incident` number will
// also pull real CMDB context — but this script works fine against demo/no
// ServiceNow config too, since analysis is best-effort on that lookup.
//
// USAGE:
//   BASE_URL=http://localhost:8080 node scripts/test-analyze-batch-pdi.js
//
// Optional:
//   BATCH_COUNT=5   (how many synthetic tickets to send; default 5, capped at 100 server-side)

'use strict';

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/+$/, '');
const BATCH_COUNT = parseInt(process.env.BATCH_COUNT || '5', 10);

// A mix of ordinary and hard-outage-signal descriptions, so the response
// exercises the severity guardrail too, not just plain success/failure.
const SAMPLE_DESCRIPTIONS = [
  'User reports their monitor flickers intermittently, especially in the afternoon.',
  'Laptop will not boot after the latest Windows update — user is fully blocked.',
  'Requesting a password reset for a shared department mailbox.',
  'Printer on the 3rd floor is out of toner, replacement requested.',
  'Production application is completely unavailable for the whole finance team.'
];

function buildTickets(count) {
  const tickets = [];
  for (let i = 0; i < count; i++) {
    const desc = SAMPLE_DESCRIPTIONS[i % SAMPLE_DESCRIPTIONS.length];
    tickets.push({
      incident: `TESTINC${1000 + i}`,
      priority: '3 - Medium',
      requester: `Test User ${i + 1}`,
      department: 'IT',
      description: `[analyze-batch PDI test] ${desc}`
    });
  }
  // One deliberately broken record — missing the required `description` —
  // to confirm the batch route reports a per-record failure instead of
  // 500ing the whole call.
  tickets.push({ incident: 'TESTINC-BROKEN', priority: '3 - Medium' });
  return tickets;
}

async function main() {
  console.log(`Target server: ${BASE_URL}`);
  console.log(`Sending ${BATCH_COUNT} tickets (+1 deliberately broken) to /api/l1-copilot/analyze/batch...`);

  const tickets = buildTickets(BATCH_COUNT);

  let res, body;
  try {
    res = await fetch(`${BASE_URL}/api/l1-copilot/analyze/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickets })
    });
    const text = await res.text();
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    console.error(`Request to ${BASE_URL} failed — is the server running? (${e.message})`);
    process.exit(1);
  }

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${body.error || '(no error message)'}`);
    process.exit(1);
  }

  console.log(`\nResult: ${body.succeeded}/${body.total} succeeded, ${body.failed} failed`);
  body.results.forEach(r => {
    if (r.success) {
      const sev = r.analysis.severity;
      const guard = r.analysis.severity_guardrail && r.analysis.severity_guardrail.applied ? ' [guardrail raised to High]' : '';
      console.log(`  OK   #${r.index}  ${r.incident}  severity=${sev}${guard}  cmdbSourced=${r.cmdbSourced}`);
    } else {
      console.log(`  FAIL #${r.index}  ${r.incident}  ${r.error}`);
    }
  });

  const expectedFailures = 1;
  if (body.failed !== expectedFailures) {
    console.warn(`\nExpected exactly ${expectedFailures} failure (the deliberately-broken record) but got ${body.failed}. Investigate before trusting this run as a clean validation.`);
    process.exit(1);
  }

  console.log('\nExactly the deliberately-broken record failed — batch analyze + partial-failure handling both confirmed working end-to-end.');
  process.exit(0);
}

main();
