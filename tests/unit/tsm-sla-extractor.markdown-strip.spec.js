'use strict';
// tests/unit/tsm-sla-extractor.markdown-strip.spec.js
//
// Regression test for: TSMSLAExtractor.extractDeadline()/extractEvidenceList()
// (html/shared/tsm-sla-extractor.js) ran their field regexes directly
// against raw LLM engine text with zero markdown stripping -- the exact bug
// class already found and fixed in Healthcare's own (separately duplicated)
// extraction code (see tests/unit/hc-strip-md-table-pipes.spec.js), but
// never propagated here even though this file is the *shared* extractor
// for Legal (legal-main-strategist.html), Insurance
// (insurance-strategist.html), and FinOps (finops-main-strategist.html).
// A deadline/evidence header wrapped in bold ("**3. Deadline:**") broke
// the header regex and silently returned null/[] instead of the real
// value; an LLM answer formatted as a markdown table row rode straight
// through into extractDeadline's captured text.
//
// Loads the real, committed tsm-sla-extractor.js and exercises it with the
// actual regexes each real caller passes in, so this is a regression test
// against the shipped code and its real call sites, not a reimplementation.

const assert = require('assert');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TSMSLAExtractor = require(path.join(REPO_ROOT, 'html', 'shared', 'tsm-sla-extractor.js'));

function run() {
  // --- extractDeadline: Legal's actual regex, header wrapped in bold ---
  const legalDeadlineRegex = /3\.\s*Deadline:\s*([^\n]+)/i;
  const legalBoldText = '1. Documents Needed: contract\n2. Strategy: negotiate\n**3. Deadline:** 2026-09-15';
  assert.strictEqual(
    TSMSLAExtractor.extractDeadline(legalBoldText, legalDeadlineRegex),
    '2026-09-15',
    'a bold-wrapped "3. Deadline:" label must still be extracted'
  );
  console.log('[PASS] extractDeadline: bold-wrapped label (Legal\'s real regex) no longer breaks the match');

  // --- extractDeadline: FinOps' actual regex, answer as a table row ---
  const finopsRegex = /PRIORITY ACTIONS[\s\S]*?\n\s*1\.[^\n—]*—[^\n—]*—[^\n—]*—\s*([^\n]+)/i;
  const finopsTableText = 'PRIORITY ACTIONS\n1. Recover duplicate payment — $5,000 — AP Team — | Jun 30, 2026 |';
  assert.strictEqual(
    TSMSLAExtractor.extractDeadline(finopsTableText, finopsRegex),
    'Jun 30, 2026',
    'a table-row-wrapped deadline value must have its pipes stripped'
  );
  console.log('[PASS] extractDeadline: table-row-wrapped value (FinOps\' real regex) loses its pipe wrapper');

  // --- extractDeadline: NOT STATED must still short-circuit to null ---
  assert.strictEqual(
    TSMSLAExtractor.extractDeadline('**3. Deadline:** NOT STATED', legalDeadlineRegex),
    null,
    'a literal NOT STATED must still resolve to null, not the literal string'
  );
  console.log('[PASS] extractDeadline: NOT STATED still short-circuits to null through bold markup');

  // --- extractEvidenceList: Insurance's actual header, bold-wrapped ---
  const insuranceHeaderRegex = /30-DAY TARGETS:/i;
  const insuranceBoldText = [
    '**30-DAY TARGETS:**',
    '* File the appeal brief',
    '* Obtain expert witness statement',
    '2. Next section header'
  ].join('\n');
  assert.deepStrictEqual(
    TSMSLAExtractor.extractEvidenceList(insuranceBoldText, insuranceHeaderRegex),
    ['File the appeal brief', 'Obtain expert witness statement'],
    'evidence bullets must still be found when the section header itself is bold-wrapped'
  );
  console.log('[PASS] extractEvidenceList: bold-wrapped header (Insurance\'s real regex) no longer hides its bullets');

  // --- extractEvidenceList: a bullet whose content is itself bold ---
  const boldBulletText = [
    '1. Documents Needed:',
    '* **DOB verification** on file',
    '* Prior claim history'
  ].join('\n');
  assert.deepStrictEqual(
    TSMSLAExtractor.extractEvidenceList(boldBulletText, /1\.\s*Documents Needed:/i),
    ['DOB verification on file', 'Prior claim history'],
    'bold markup inside a bullet\'s own content must be stripped, and the bullet still found'
  );
  console.log('[PASS] extractEvidenceList: bold text inside a bullet is cleaned, bullet marker still recognized');

  // --- baseline: plain unformatted text is completely unaffected ---
  assert.strictEqual(
    TSMSLAExtractor.extractDeadline('3. Deadline: 2026-10-01', legalDeadlineRegex),
    '2026-10-01',
    'plain (non-markdown) text must keep working exactly as before'
  );
  assert.deepStrictEqual(
    TSMSLAExtractor.extractEvidenceList('1. Documents Needed:\n* Signed contract\n* Invoice copy', /1\.\s*Documents Needed:/i),
    ['Signed contract', 'Invoice copy'],
    'plain evidence lists must keep working exactly as before'
  );
  console.log('[PASS] plain, non-markdown input for both functions is unaffected');

  console.log('\n=== SUMMARY ===');
  console.log('TSMSLAExtractor.extractDeadline()/extractEvidenceList() now strip bold/');
  console.log('italic/heading/table-pipe markdown before running their field regexes,');
  console.log('closing the same extraction-breaking bug class already fixed in');
  console.log('Healthcare, across all three real shared-extractor consumers (Legal,');
  console.log('Insurance, FinOps) at once instead of needing three separate fixes.');
}

run();
