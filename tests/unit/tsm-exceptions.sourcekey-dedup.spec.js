'use strict';
// tests/unit/tsm-exceptions.sourcekey-dedup.spec.js
//
// Regression test for the exception-queue duplication bug: a war-room
// exec portal (e.g. hcFeedExceptions() in html/healthcare/executive-portal.html)
// re-derives the same set of exceptions from upstream data on every page
// load/render and relies on TSMExceptions.add()'s sourceKey dedup to avoid
// creating a fresh duplicate each time.
//
// add() used to dedupe via findOpenBySourceKey(), which only matched
// records with status === 'open'. Once a sourceKey's exception was
// resolved -- by clicking "Resolve" on the exception queue, or by
// TSMCaseManager.markExecuted() resolving the linked case's exceptions --
// the next re-feed found no OPEN match for that sourceKey and pushed a
// brand-new exception (and, via createFromException(), a brand-new case)
// for the exact same underlying claim. Every subsequent reload repeated
// this, producing a growing pile of duplicate rows all marked RESOLVED.
//
// Fix: add() now dedupes via findBySourceKey(), which matches a sourceKey
// regardless of status, so a resolved record is returned unchanged instead
// of being duplicated.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const Exceptions = require(path.join(REPO_ROOT, 'html', 'shared', 'tsm-exceptions.js'));

function run() {
  // --- baseline: sourceKey dedup still works for an open record ---
  const a = Exceptions.add({
    title: 'Claim AZ-BCBS-2026-88214',
    severity: 'high',
    sector: 'healthcare',
    sourceKey: 'claim-az-bcbs-2026-88214'
  });
  assert.strictEqual(a.status, 'open');

  const aAgain = Exceptions.add({
    title: 'Claim AZ-BCBS-2026-88214',
    severity: 'high',
    sector: 'healthcare',
    sourceKey: 'claim-az-bcbs-2026-88214'
  });
  assert.strictEqual(aAgain.exceptionId, a.exceptionId,
    're-feeding an OPEN sourceKey must return the same record, not a duplicate');
  console.log('[PASS] add() dedupes an open sourceKey against itself');

  // --- the actual bug: re-feeding after resolve must not duplicate ---
  Exceptions.resolve(a.exceptionId);
  const resolvedCount = Exceptions.getAll('healthcare')
    .filter(r => r.sourceKey === 'claim-az-bcbs-2026-88214').length;
  assert.strictEqual(resolvedCount, 1);

  const b = Exceptions.add({
    title: 'Claim AZ-BCBS-2026-88214',
    severity: 'high',
    sector: 'healthcare',
    sourceKey: 'claim-az-bcbs-2026-88214'
  });
  assert.strictEqual(b.exceptionId, a.exceptionId,
    're-feeding a RESOLVED sourceKey must return the existing record, not create a duplicate');
  assert.strictEqual(b.status, 'resolved',
    're-feeding a resolved sourceKey must not silently reopen it');

  const afterCount = Exceptions.getAll('healthcare')
    .filter(r => r.sourceKey === 'claim-az-bcbs-2026-88214').length;
  assert.strictEqual(afterCount, 1,
    'exactly one record should exist for this sourceKey after multiple re-feeds, resolved or not');
  console.log('[PASS] add() does not duplicate a resolved sourceKey on re-feed (regression for RESOLVED-row pile-up)');

  // --- simulate several more "reloads" for good measure ---
  for (let i = 0; i < 5; i++) {
    Exceptions.add({
      title: 'Claim AZ-BCBS-2026-88214',
      severity: 'high',
      sector: 'healthcare',
      sourceKey: 'claim-az-bcbs-2026-88214'
    });
  }
  const finalCount = Exceptions.getAll('healthcare')
    .filter(r => r.sourceKey === 'claim-az-bcbs-2026-88214').length;
  assert.strictEqual(finalCount, 1, 'repeated re-feeds must never grow the record count for one sourceKey');
  console.log('[PASS] repeated re-feeds after resolve stay stable at one record');

  // --- callers without a sourceKey keep today's always-create behavior ---
  const c1 = Exceptions.add({ title: 'No source key A', severity: 'med', sector: 'healthcare' });
  const c2 = Exceptions.add({ title: 'No source key B', severity: 'med', sector: 'healthcare' });
  assert.notStrictEqual(c1.exceptionId, c2.exceptionId);
  console.log('[PASS] add() without a sourceKey is unaffected and still always creates a new record');

  console.log('\n=== SUMMARY ===');
  console.log('TSMExceptions.add() dedupes on sourceKey regardless of open/resolved');
  console.log('status, so resolving an exception no longer causes it to reappear as');
  console.log('a fresh duplicate on the next feed/reload.');
}

run();
