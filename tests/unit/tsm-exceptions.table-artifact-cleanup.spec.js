'use strict';
// tests/unit/tsm-exceptions.table-artifact-cleanup.spec.js
//
// Regression test for the one-time self-heal migration added to
// html/shared/tsm-exceptions.js: records saved to localStorage while the
// stripMd() table-pipe bug was live (see
// tests/unit/hc-strip-md-table-pipes.spec.js) have their `detail`/`title`
// fields cleaned in place the next time the store loads, instead of being
// stuck with a raw "| ... |" wrapper forever. Follows the same "self-heal
// on load" pattern already used in this file for the refusal-leak and
// generic-placeholder-record migrations, but rewrites the record instead
// of discarding it, since this data is real.
//
// Loads the real, committed tsm-exceptions.js in a sandboxed VM with a
// fake localStorage pre-seeded with an affected record, so this exercises
// the actual shipped migration rather than a reimplementation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ENGINE_PATH = path.join(REPO_ROOT, 'html', 'shared', 'tsm-exceptions.js');
const STORAGE_KEY = 'tsm_exceptions_v1';

function fakeLocalStorage(seed) {
  const data = { [STORAGE_KEY]: JSON.stringify(seed) };
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _dump: () => JSON.parse(data[STORAGE_KEY] || '[]')
  };
}

function loadEngine(seedRecords) {
  const src = fs.readFileSync(ENGINE_PATH, 'utf8');
  const storage = fakeLocalStorage(seedRecords);
  const sandbox = { window: { localStorage: storage }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { TSMExceptions: sandbox.window.TSMExceptions, storage };
}

function run() {
  // --- affected record: raw table-row wrapper baked into `detail` ---
  const affected = {
    exceptionId: 'exc_affected_1',
    title: 'Claim CLM-HC-7731',
    detail: '| CO\u201150 ("Unable to determine the medical necessity or appropriateness of the service(s) or procedure(s) provided"). The insurer cannot confirm that the billed services were medically necessary. |',
    severity: 'med',
    sector: 'healthcare',
    status: 'open',
    priority: 'P2'
  };
  // --- untouched control record: a normal claim with no table markup ---
  const clean = {
    exceptionId: 'exc_clean_1',
    title: 'Claim CLM-HC-9001',
    detail: 'Missing prior authorization for the billed procedure.',
    severity: 'low',
    sector: 'healthcare',
    status: 'open',
    priority: 'P3'
  };

  const { TSMExceptions, storage } = loadEngine([affected, clean]);
  const all = TSMExceptions.getAll('healthcare');
  const cleanedAffected = all.filter((r) => r.exceptionId === 'exc_affected_1')[0];
  const untouched = all.filter((r) => r.exceptionId === 'exc_clean_1')[0];

  assert.ok(cleanedAffected, 'affected record must survive the migration (cleaned, not purged)');
  assert.ok(!cleanedAffected.detail.trim().startsWith('|'), 'leading "|" must be stripped from detail on load');
  assert.ok(!cleanedAffected.detail.trim().endsWith('|'), 'trailing "|" must be stripped from detail on load');
  assert.ok(cleanedAffected.detail.includes('CO\u201150'), 'real content must survive the in-place cleanup');
  console.log('[PASS] affected record\'s detail is cleaned in place on load, not discarded');

  assert.strictEqual(untouched.detail, clean.detail, 'a record with no table markup must be left byte-for-byte unchanged');
  console.log('[PASS] unaffected records are left untouched by the migration');

  // --- the cleanup must persist, so it only ever runs once per record ---
  const persisted = storage._dump();
  const persistedAffected = persisted.filter((r) => r.exceptionId === 'exc_affected_1')[0];
  assert.ok(persistedAffected && !persistedAffected.detail.includes('|'),
    'cleaned record must be written back to localStorage, not just cleaned in memory');
  console.log('[PASS] cleanup is persisted back to localStorage');

  // --- re-loading an already-cleaned store must be a stable no-op ---
  const { TSMExceptions: reloaded } = loadEngine(persisted);
  const reloadedAffected = reloaded.getAll('healthcare').filter((r) => r.exceptionId === 'exc_affected_1')[0];
  assert.strictEqual(reloadedAffected.detail, cleanedAffected.detail, 're-loading an already-cleaned record must be idempotent');
  console.log('[PASS] migration is idempotent on repeated loads');

  console.log('\n=== SUMMARY ===');
  console.log('tsm-exceptions.js self-heals localStorage records saved while the');
  console.log('stripMd() table-pipe bug was live: raw "| ... |" wrappers in detail/');
  console.log('title are cleaned in place on the next load, real content preserved,');
  console.log('unaffected records and re-loads of already-cleaned data are no-ops.');
}

run();
