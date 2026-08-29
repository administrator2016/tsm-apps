#!/usr/bin/env node
'use strict';

/**
 * BPO client-selector wiring smoke test (2026-08-29)
 *
 * Exercises the actual gap fixed by 0001-fix-bpo-wire-client-selector /
 * e794da04: confirms clientId now flows end-to-end through the same
 * server-side path the war room's storeWarRoomRelay() uses, and that it
 * stays sticky through a follow-up call that omits it (the exec-portal's
 * markExecuted() shape).
 *
 * Does NOT touch the browser/UI layer -- that still needs a real manual
 * pass (open bpo-war-room.html, confirm the CLIENT dropdown actually
 * renders and a real extraction run carries the selection through). This
 * only proves the API contract underneath it is correct.
 *
 * Usage:
 *   BASE_URL=https://your-app.example.com \
 *   TSM_CREDENTIAL=<admin password OR staff/manager access code> \
 *   node scripts/test-bpo-client-wiring-smoke.js
 *
 * BASE_URL defaults to http://localhost:3000 if omitted.
 * Exits non-zero on any failed check, so it's usable as a CI/pre-push gate.
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const CREDENTIAL = process.env.TSM_CREDENTIAL;

let cookie = null;
let failures = 0;

function log(ok, label, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`${mark}  ${label}${detail ? '  -- ' + detail : ''}`);
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}

async function main() {
  if (!CREDENTIAL) {
    console.error('Set TSM_CREDENTIAL to an admin password or a manager/analyst access code.');
    process.exit(2);
  }

  console.log(`Target: ${BASE_URL}\n`);

  // ── 1. Auth ──
  const login = await req('POST', '/api/auth/login', { password: CREDENTIAL, accessCode: CREDENTIAL });
  log(login.status === 200 && login.json && login.json.ok, 'login',
    login.status === 200 ? `role=${login.json && login.json.role}` : `HTTP ${login.status}`);
  if (login.status !== 200) {
    console.log('\nCannot continue without a session.');
    process.exit(1);
  }
  const role = login.json.role;
  if (!['admin', 'manager', 'analyst'].includes(role)) {
    log(false, 'role check', `logged in as '${role}', but BPO_INTERNAL_ROLES requires admin/manager/analyst`);
    process.exit(1);
  }

  // ── 2. Client directory (the new route) ──
  const dir = await req('GET', '/api/bpo/client-directory');
  log(dir.status === 200 && dir.json && dir.json.ok && Array.isArray(dir.json.clients),
    'GET /api/bpo/client-directory', dir.status === 200 ? `${(dir.json.clients || []).length} client(s)` : `HTTP ${dir.status}`);

  let testClientId = dir.json && dir.json.clients && dir.json.clients[0] && dir.json.clients[0].id;
  if (!testClientId) {
    console.log('\nNo active BPO clients exist to test against -- create one first (POST /api/admin/... or the BPO client management UI), then re-run.');
    process.exit(1);
  }
  console.log(`Using client: ${testClientId}\n`);

  // ── 3. Create a work item WITH clientId (simulates storeWarRoomRelay's
  //    fetch to /api/bpo/work-items/:caseId with the selector's value) ──
  const caseId = 'SMOKE-' + Date.now();
  const create = await req('POST', `/api/bpo/work-items/${encodeURIComponent(caseId)}`, {
    vertical: 'bpo',
    stage: 'war-room',
    status: 'open',
    clientId: testClientId,
    payload: { note: 'smoke test' }
  });
  log(create.status === 200 && create.json && create.json.ok, 'create work item with clientId', `HTTP ${create.status}`);

  const created = create.json && create.json.workItem;
  log(created && created.clientId === testClientId, 'clientId persisted on create',
    created ? `got clientId=${created.clientId}` : 'no workItem in response');

  // ── 4. Update the SAME work item without clientId (simulates the
  //    exec-portal's markExecuted(), which never sends clientId) --
  //    this is exactly the call that used to silently null it out ──
  const update = await req('POST', `/api/bpo/work-items/${encodeURIComponent(caseId)}`, {
    vertical: 'bpo',
    stage: 'executed',
    status: 'closed'
  });
  log(update.status === 200 && update.json && update.json.ok, 'update work item omitting clientId', `HTTP ${update.status}`);

  const updated = update.json && update.json.workItem;
  log(updated && updated.clientId === testClientId, 'clientId still sticky after update',
    updated ? `got clientId=${updated.clientId}, expected ${testClientId}` : 'no workItem in response');

  // ── 5. Re-fetch independently to rule out the POST response caching
  //    a stale in-memory value ──
  const refetch = await req('GET', `/api/bpo/work-items/${encodeURIComponent(caseId)}`);
  const refetched = refetch.json && (refetch.json.workItem || refetch.json.item);
  log(refetched && refetched.clientId === testClientId, 'clientId correct on independent re-fetch',
    refetched ? `got clientId=${refetched.clientId}` : `HTTP ${refetch.status}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  console.log('\nStill needs a manual browser pass: open bpo-war-room.html, confirm the');
  console.log('CLIENT dropdown actually renders these clients, and run one real');
  console.log('extraction end to end to confirm the UI wiring (not just the API) works.');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
