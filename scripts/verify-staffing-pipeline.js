#!/usr/bin/env node
// =====================================================================
// STAFFING PIPELINE VERIFICATION SCRIPT
// =====================================================================
// What this does: walks the ENTIRE real pipeline — training candidate,
// employer, job order, submit, advance through the pipeline, fee — the
// same sequence a real JRLA cohort will go through, but with clearly
// labeled test data so it's obvious in the registry what's real and
// what's this script.
//
// Why it exists: to let you (and anyone you're teaching this to) SEE
// each API call and its result before trusting the UI with a real
// cohort. Every step prints what it's doing and why, then what came
// back. Nothing here is magic — it's the exact same HTTP calls the
// Staffing Admin page and Career Training Platform make from the
// browser, just narrated.
//
// Auth: /api/staffing/* is gated behind requireStaffAuth (see server.js),
// so this script logs in first and carries the session cookie on every
// call. Provide ONE of:
//   VERIFY_AUTH_CODE=<manager/analyst access code>   (recommended — scoped,
//                                                      revocable independently
//                                                      of your admin password;
//                                                      create one via
//                                                      POST /api/admin/staff)
//   TSM_ADMIN_PASSWORD=<your admin password>          (works, but avoid if
//                                                      you can — this is your
//                                                      master credential)
//
// Usage:
//   BASE_URL=https://tsm-shell.fly.dev VERIFY_AUTH_CODE=xxxx node scripts/verify-staffing-pipeline.js
//   (BASE_URL defaults to https://tsm-shell.fly.dev if not set)
//
// Requires Node 18+ (built-in fetch). No packages to install.
//
// Cleanup: everything created here is deleted again at the end (see
// the CLEANUP section), so it's safe to run against production. Pass
// --keep on the command line if you want to leave the test records in
// place to click through in the Staffing Admin UI yourself.
// =====================================================================

const BASE_URL = process.env.BASE_URL || 'https://tsm-shell.fly.dev';
const KEEP = process.argv.includes('--keep');

const RUN_TAG = 'verify_' + Date.now();

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
  else { failed++; console.error(`  \x1b[31mFAIL\x1b[0m ${label}`); }
}
function step(n, title) {
  console.log(`\n\x1b[1m[${n}] ${title}\x1b[0m`);
}

// Session cookie captured by login(), attached to every request after.
let sessionCookie = '';

// Handles both Node 20+ (Headers#getSetCookie) and Node 18/19 (only
// Headers#get, which for a single Set-Cookie header still returns it whole).
function extractSessionCookie(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    const all = res.headers.getSetCookie();
    if (all.length) return all[0].split(';')[0];
  }
  const single = res.headers.get('set-cookie');
  return single ? single.split(';')[0] : null;
}

// Logs in once, before any /api/staffing/* calls. Uses VERIFY_AUTH_CODE
// (staff access code) if set, otherwise falls back to TSM_ADMIN_PASSWORD.
async function login() {
  const staffCode = process.env.VERIFY_AUTH_CODE;
  const adminPassword = process.env.TSM_ADMIN_PASSWORD;
  const credential = staffCode || adminPassword;

  if (!credential) {
    throw new Error(
      'No credential to authenticate with. Set VERIFY_AUTH_CODE (a manager/analyst ' +
      'access code — create one via POST /api/admin/staff) or TSM_ADMIN_PASSWORD ' +
      'in the environment before running this script.'
    );
  }

  const body = staffCode ? { accessCode: credential } : { password: credential };
  console.log(`  POST /api/auth/login  (credential hidden)`);
  const res = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.ok) {
    throw new Error(`Login failed: ${res.status} ${(data && data.error) || 'no error body'}`);
  }
  const cookie = extractSessionCookie(res);
  if (!cookie) {
    throw new Error('Login succeeded but no session cookie came back — cannot continue authenticated.');
  }
  sessionCookie = cookie;
  console.log(`  Logged in as role "${data.role}"${data.label ? ` (${data.label})` : ''}`);
}

// Thin wrapper so every call prints the method/URL it's making — this is
// the "teach others" part: someone reading the console output can see
// exactly which endpoint does what, without opening DevTools. Now also
// carries the session cookie from login() on every call.
async function api(method, path, body) {
  const url = BASE_URL + path;
  console.log(`  ${method} ${path}${body ? '  ' + JSON.stringify(body) : ''}`);
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${(data && data.error) || 'no error body'}`);
  }
  return data;
}

async function main() {
  console.log(`Target: ${BASE_URL}`);
  console.log(`Run tag: ${RUN_TAG} (everything created below is labeled with this so it's easy to spot/clean up)`);

  // -------------------------------------------------------------
  step(0, 'Authenticate (requireStaffAuth gates /api/staffing/*)');
  // -------------------------------------------------------------
  await login();

  // -------------------------------------------------------------
  step(1, 'Create a training candidate (mirrors what an exam sim does)');
  // -------------------------------------------------------------
  // In real use, this record gets created by ServiceNow/ITIL exam sim
  // or MLO exam prep when someone actually completes training. We
  // create it directly here so this script doesn't depend on a human
  // sitting through a 20-question exam first.
  const candidateResp = await api('POST', '/api/candidates', {
    name: `Verify Script Candidate (${RUN_TAG})`,
    role: 'ServiceNow / ITIL Support',
    status: 'in_training',
    source: 'verification-script',
    isSampleData: true, // never masquerades as a real cohort member
  });
  const candidateId = candidateResp.candidate.candidateId;
  check('candidate created with an id', /^cand_/.test(candidateId));

  step('1b', 'Record a training event so readiness score is real, not zero');
  await api('POST', `/api/candidates/${candidateId}/training-events`, {
    type: 'quiz', score: 92, weight: 1,
  });
  const candidateAfter = await api('GET', `/api/candidates/${candidateId}`);
  check('readiness score computed from the event', candidateAfter.candidate.readinessScore === 92);
  console.log(`  → This is exactly what the Career Training Platform reads to show readiness.`);

  // -------------------------------------------------------------
  step(2, 'Create an employer (Staffing Admin > Employers tab)');
  // -------------------------------------------------------------
  const employerResp = await api('POST', '/api/staffing/employers', {
    name: `Verify Script Employer (${RUN_TAG})`,
    sector: 'IT',
    status: 'active',
  });
  const employerId = employerResp.employer.employerId;
  check('employer created with an id', /^emp_/.test(employerId));

  // -------------------------------------------------------------
  step(3, 'Create a job order under that employer (Job Orders tab)');
  // -------------------------------------------------------------
  // feeType 'contingency' at 25% mirrors TSM's stated 20-30% band.
  const jobOrderResp = await api('POST', '/api/staffing/job-orders', {
    employerId,
    title: 'IT Support Technician',
    sector: 'IT',
    payRate: 22,
    feeType: 'contingency',
    feeValue: 25,
    openings: 1,
  });
  const jobOrderId = jobOrderResp.jobOrder.jobOrderId;
  check('job order created with an id', /^job_/.test(jobOrderId));
  check('job order starts open', jobOrderResp.jobOrder.status === 'open');

  // -------------------------------------------------------------
  step(4, 'Submit the candidate to the job order (Placements tab)');
  // -------------------------------------------------------------
  // This is the exact call the candidate picker in Staffing Admin
  // makes once you select a name and a job order and click Submit.
  const placementResp = await api('POST', '/api/staffing/placements', {
    candidateId,
    jobOrderId,
  });
  const placementId = placementResp.placement.placementId;
  check('placement created', /^plc_/.test(placementId));
  check('placement starts at status "submitted"', placementResp.placement.status === 'submitted');

  // -------------------------------------------------------------
  step(5, 'Walk the placement through the pipeline, one status at a time');
  // -------------------------------------------------------------
  // These are the "Advance →" buttons on the Placements card. The fee
  // is NOT sent by the client anywhere in this sequence — it only
  // appears once the server marks the placement 'placed', computed
  // from the job order's fee terms. That's intentional: nobody can
  // submit a fake fee number through this API.
  for (const status of ['interviewing', 'offered', 'placed']) {
    const r = await api('PUT', `/api/staffing/placements/${placementId}/status`, { status });
    check(`placement advanced to "${status}"`, r.placement.status === status);
  }

  const placedPlacement = await api('GET', `/api/staffing/placements/${placementId}`);
  const fee = placedPlacement.placement.computedFee;
  check('fee was computed server-side once placed', !!fee);
  if (fee) {
    console.log(`  → Computed fee: ${fee.type === 'contingency'
      ? `$${fee.amount.toLocaleString()} (${fee.percentage}% of $${fee.annualizedPay.toLocaleString()} annualized pay)`
      : `$${fee.hourlySpread}/hr spread`}`);
  }

  // -------------------------------------------------------------
  step(6, 'Confirm the job order auto-filled (1 opening, 1 placement)');
  // -------------------------------------------------------------
  const jobOrderAfter = await api('GET', `/api/staffing/job-orders/${jobOrderId}`);
  check('job order flipped to "filled"', jobOrderAfter.jobOrder.status === 'filled');

  // -------------------------------------------------------------
  // CLEANUP — leaves production exactly as it was found, unless --keep
  // -------------------------------------------------------------
  if (KEEP) {
    console.log(`\n\x1b[33mKeeping test records (--keep passed).\x1b[0m Look for "${RUN_TAG}" in the Staffing Admin UI and Career Training Platform.`);
  } else {
    step(7, 'Cleaning up everything this script created');
    await api('DELETE', `/api/staffing/placements/${placementId}`);
    await api('DELETE', `/api/staffing/job-orders/${jobOrderId}`);
    await api('DELETE', `/api/staffing/employers/${employerId}`);
    await api('DELETE', `/api/candidates/${candidateId}`);
    console.log('  Done — production is back to how it was before this run.');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\nScript stopped early:', err.message);
  process.exit(1);
});