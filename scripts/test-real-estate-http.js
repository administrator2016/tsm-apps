// scripts/test-real-estate-http.js
//
// Step 6 (cross-vertical release regression) HTTP-layer coverage for Real
// Estate — one of the verticals in
// docs/audit/step6-cross-vertical-release-status.md with zero real
// server-level (auth + failure-mode) test coverage.
//
// scripts/test-real-estate-control-plane.js already exists and covers the
// underlying runRealEstateControlPlane() business logic directly (13/13
// passing, no HTTP/LLM dependency) -- that is NOT what this file adds.
// This file covers the HTTP route itself: POST
// /api/real-estate/control-plane in server.js.
//
// Unlike every other vertical audited so far (Construction, NOC, HotelOps,
// PM-Copilot), Real Estate does NOT have the recurring two-bug-class
// pattern, confirmed against a real running server:
//
//   1. Auth is already correct -- /api/real-estate/control-plane is
//      already mounted behind requireAnyAuth. Confirmed an unauthenticated
//      call is rejected with 401.
//
//   2. No AI-fallback bug class applies here at all -- this route wraps
//      runRealEstateControlPlane(), a pure deterministic function with no
//      Groq/LLM call in it. There is no "raw 500 on Groq failure" for it
//      to have.
//
//   3. FINDING: the route appears to be orphaned -- confirmed via grep
//      across the entire html/ tree that no page or service file calls
//      /api/real-estate/control-plane. Same shape as FinOps's previously
//      found orphaned /api/finops/report route. Flagged, not fixed --
//      wiring an orphaned route into the UI is a product decision, not a
//      bug fix.
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

  // --- Auth: confirm the existing guard actually rejects an
  // unauthenticated caller (regression guard -- this was already correct,
  // not a fix made here) ---
  {
    const { status, json } = await post('/api/real-estate/control-plane', { entities: [] }, { authed: false });
    check('/api/real-estate/control-plane correctly rejects unauthenticated calls (401) -- already fine, regression guard', status === 401 && json.ok === false && json.error === 'Unauthorized');
  }

  // --- Functional: real payload produces a real deterministic result via
  // the HTTP layer, not just the direct-function test in
  // test-real-estate-control-plane.js. No Groq/LLM involved, so no
  // fallback branch to test here -- this route either returns a real
  // result or a genuine 500 on a code-level bug. ---
  {
    const payload = {
      entities: [
        { id: 'property-901', type: 'property', name: 'HTTP Test Property' },
        { id: 'unit-901A', type: 'unit', propertyId: 'property-901', occupancy: 'vacant' }
      ]
    };
    const { status, json } = await post('/api/real-estate/control-plane', payload);
    check('functional: returns 200 ok:true via the real HTTP route', status === 200 && json.ok === true);
    check('functional: response carries the vertical/engine identifiers', json.vertical === 'real_estate' && json.engine === 'real-estate-control-plane');
    check('functional: result includes a real decision object (not empty/placeholder)', !!json.result && Array.isArray(json.result.decisions) && json.result.decisions.length > 0);
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
