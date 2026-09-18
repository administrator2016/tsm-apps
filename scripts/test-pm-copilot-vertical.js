// scripts/test-pm-copilot-vertical.js
//
// Step 6 (cross-vertical release regression) coverage for PM-Copilot — one
// of the verticals in docs/audit/step6-cross-vertical-release-status.md
// with zero real logic testing.
//
// PM-Copilot has two separate inline (server.js) endpoints, each hit by a
// different finding rather than the usual matched pair:
//
//   1. POST /api/pm/analysis (SLA/vacancy/lease/vendor query analog,
//      called from html/war-rooms/pm-copilot/pm-command.html and
//      services/pm-engine.js) IS already gated by
//      requireRole(PM_INTERNAL_ROLES) -- confirmed unauthenticated calls
//      get a real 401. But it has the same missing-graceful-fallback bug
//      already found and fixed in Construction/NOC/HotelOps: a Groq
//      failure (including no GROQ_API_KEY) surfaces a raw 500 instead of
//      degrading gracefully.
//
//   2. POST /api/pm-strategist/bnca (called from
//      html/war-rooms/pm-copilot/pm-strategist.html) has NO auth guard at
//      all -- confirmed an unauthenticated call gets a normal 200, not a
//      401. Unlike the /query-style routes, it already degrades
//      gracefully on its own: it runs through the shared tsmAIJSON()
//      helper (server.js line 729), which returns the caller-supplied
//      `fallback` object internally whenever no Groq key is configured or
//      the call fails, rather than throwing. So this finding is
//      auth-only, not a fallback bug.
//
// Requires a real running server (TSM_BASE_URL, default
// http://localhost:3000) with TSM_SESSION_SECRET and TSM_ADMIN_PASSWORD
// set -- same convention as test-hotelops-vertical.js / test-noc-vertical.js.

const BASE_URL = process.env.TSM_BASE_URL || 'http://localhost:3000';

let sessionCookie = null;

async function login() {
  const password = process.env.TSM_ADMIN_PASSWORD;
  if (!password) {
    throw new Error('TSM_ADMIN_PASSWORD must be set in the environment to run this test.');
  }
  const res = await fetch(BASE_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    throw new Error(`Login failed (status ${res.status}): ${JSON.stringify(json)}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('Login succeeded but no Set-Cookie header was returned.');
  sessionCookie = setCookie.split(';')[0];
}

async function post(path, body, opts) {
  const authed = !opts || opts.authed !== false;
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authed && sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  await login();

  // --- Auth: /api/pm/analysis already correctly rejects unauthenticated
  // callers via requireRole(PM_INTERNAL_ROLES) -- confirm that stays true,
  // as a regression guard rather than a finding. ---
  {
    const { status } = await post('/api/pm/analysis', { kpis: {} }, { authed: false });
    check('/api/pm/analysis correctly rejects unauthenticated calls (401) -- already fine, regression guard', status === 401);
  }

  // --- Fallback: same bug class already found and fixed in
  // Construction/NOC/HotelOps -- confirm no GROQ_API_KEY (or any upstream
  // failure) now degrades gracefully instead of a raw 500. ---
  {
    const payload = {
      kpis: { occupied_units: 88, vacant_units: 12 },
      work_order_breaches: [{ id: 'WO-771', sla: 'breached', severity: 'CRITICAL' }],
      leases_expiring: [{ id: 'LSE-14', unit: '3B', daysToExpiry: 21 }],
      vendor_flags: [{ id: 'VEN-9', issue: 'insurance lapsed' }]
    };
    const { status, json } = await post('/api/pm/analysis', payload);
    if (status === 200 && json.fallback !== true) {
      check('functional: returns 200 ok:true with a real request payload', json.ok === true);
      check('functional: answer is non-empty prose, not an empty/placeholder string', typeof json.answer === 'string' && json.answer.trim().length > 20);
    } else {
      check('FIXED: no-key/upstream-failure case now degrades gracefully (200, fallback:true, degraded:true)', status === 200 && json.ok === true && json.fallback === true && json.degraded === true);
    }
  }

  // --- Auth: confirm the newly-added guard actually rejects an
  // unauthenticated caller (it had zero guard before the fix) ---
  {
    const { status, json } = await post('/api/pm-strategist/bnca', { portfolio: 'test' }, { authed: false });
    check('FIXED: unauthenticated /api/pm-strategist/bnca is rejected (401)', status === 401 && json.ok === false && json.error === 'Unauthorized');
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
