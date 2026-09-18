'use strict';
/*
 * TSMCaseManager.syncToServer diagnostics regression.
 *
 * A non-401/403 rejection from POST /api/bpo/cases/:caseId (e.g. the route's
 * 400 carrying the ledger error text) used to be swallowed, so it was only
 * visible in the browser Network tab. It must now be recorded (silently --
 * the mirror sync produces no console output) and readable through
 * TSMCaseManager.getSyncFailures(), while 401/403 keep their existing "stop syncing this page load" behavior
 * and a success stays silent. syncToServer must never throw into callers.
 *
 * Run: node scripts/test-case-manager-sync-diagnostics.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'html/shared/tsm-case-manager.js'), 'utf8')
  // drop the Node self-test block so only the browser IIFE is exercised
  .split(/\nif \(typeof require !== 'undefined' && require\.main === module\)/)[0];

let failures = 0;
const check = (c, m) => { if (c) console.log('OK:  ' + m); else { failures++; console.error('FAIL: ' + m); } };

function load(fakeFetch) {
  const warns = [];
  const store = {};
  const win = {
    fetch: fakeFetch,
    console: { warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } },
    Date, JSON, Math, Promise, Array, Object, String, Number, RegExp, Error, encodeURIComponent, setTimeout
  };
  win.window = win;
  vm.runInContext(SRC, vm.createContext(win));
  return { win, warns };
}
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  // 1. 400 with a JSON error body -> recorded with the server's message, silently
  let calls = 0;
  let { win, warns } = load(async () => { calls++; return res(400, JSON.stringify({ ok: false, error: 'ledger rejected case' })); });
  const c = win.TSMCaseManager.create({ title: 'x', sector: 'healthcare' });
  await tick();
  const f = win.TSMCaseManager.getSyncFailures();
  check(f.length === 1 && f[0].status === 400 && f[0].caseId === c.caseId, '400 is recorded with status and caseId');
  check(f[0] && f[0].error === 'ledger rejected case', "the server's error text is captured, not just the status");
  check(warns.length === 0, 'the mirror sync stays silent (no console output)');

  // 2. identical rejection again -> deduped (the log does not fill with repeats)
  win.TSMCaseManager.syncToServer(c);
  await tick();
  check(win.TSMCaseManager.getSyncFailures().length === 1, 'the same rejection is not logged twice');

  // 3. non-JSON body -> raw text still captured
  ({ win, warns } = load(async () => res(400, 'plain text failure')));
  win.TSMCaseManager.create({ title: 'y', sector: 'healthcare' });
  await tick();
  check((win.TSMCaseManager.getSyncFailures()[0] || {}).error === 'plain text failure', 'a non-JSON error body is captured as text');

  // 4. 401/403 -> silent, and further syncs stop (existing behavior preserved)
  calls = 0;
  ({ win, warns } = load(async () => { calls++; return res(403, JSON.stringify({ ok: false, error: 'forbidden' })); }));
  win.TSMCaseManager.create({ title: 'z', sector: 'healthcare' });
  await tick();
  win.TSMCaseManager.create({ title: 'z2', sector: 'healthcare' });
  await tick();
  check(win.TSMCaseManager.getSyncFailures().length === 0 && warns.length === 0, '403 stays silent (not treated as a sync failure)');
  check(calls === 1, '403 still stops further sync calls for the page load');

  // 5. success -> silent
  ({ win, warns } = load(async () => res(200, JSON.stringify({ ok: true }))));
  win.TSMCaseManager.create({ title: 'ok', sector: 'healthcare' });
  await tick();
  check(win.TSMCaseManager.getSyncFailures().length === 0 && warns.length === 0, 'a 200 records nothing and warns nothing');

  // 6. network failure / broken response never throws into the caller
  let threw = false;
  ({ win, warns } = load(async () => { throw new Error('offline'); }));
  try { win.TSMCaseManager.create({ title: 'net', sector: 'healthcare' }); await tick(); } catch (e) { threw = true; }
  check(!threw, 'a network failure never throws into create()');
  ({ win, warns } = load(async () => ({ ok: false, status: 400, text: async () => { throw new Error('boom'); } })));
  try { win.TSMCaseManager.create({ title: 'bad', sector: 'healthcare' }); await tick(); } catch (e) { threw = true; }
  check(!threw, 'an unreadable error body never throws into create()');

  console.log(failures ? '\nSYNC DIAGNOSTICS: ' + failures + ' FAILURE(S)' : '\nSYNC DIAGNOSTICS: PASS');
  process.exit(failures ? 1 : 0);
})();
