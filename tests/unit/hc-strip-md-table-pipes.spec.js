'use strict';
// tests/unit/hc-strip-md-table-pipes.spec.js
//
// Regression test for: stripMd() (duplicated in
// html/healthcare/hc-denial-war-room.html's buildHCStructuredCase and
// html/healthcare/hc-main-strategist.html's wrGeneratePhysicianEMTemplate)
// stripped bold/italic/code/heading/bullet markdown but never touched
// markdown table pipes. When the LLM answered a field with a table row
// instead of a plain sentence -- e.g.
//   | CO-50 ("Unable to determine the medical necessity...") |
// -- the leading/trailing "|" rode straight through every regex extraction
// and out to the client-facing exception rationale
// (see tsm-client-package-*.json exports: rationale field literally
// contained the "| ... |" wrapper).
//
// Loads the real, committed function bodies out of the two HTML files in a
// sandboxed VM, so this exercises the actual shipped code rather than a
// reimplementation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..', '..');
const FILES = [
  path.join(REPO_ROOT, 'html', 'healthcare', 'hc-denial-war-room.html'),
  path.join(REPO_ROOT, 'html', 'healthcare', 'hc-main-strategist.html')
];

// Extracts a balanced `function name(...) { ... }` block starting at the
// first occurrence of `function <name>(` in src.
function extractFunction(src, name) {
  const startMarker = 'function ' + name + '(';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('could not find function ' + name + '() in source');
  const braceStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braces extracting ' + name + '()');
}

function loadStripMd(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const fnSrc = extractFunction(src, 'stripMd');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(fnSrc + '\nthis.stripMd = stripMd;', sandbox);
  return sandbox.stripMd;
}

function run() {
  FILES.forEach(function (filePath) {
    const label = path.relative(REPO_ROOT, filePath);
    const stripMd = loadStripMd(filePath);

    // --- the actual reported bug: a single-cell table-row answer ---
    const tableRow = '| CO\u201150 ("Unable to determine the medical necessity or appropriateness of the service(s) or procedure(s) provided"). The insurer cannot confirm that the billed services were medically necessary. |';
    const cleaned = stripMd(tableRow);
    assert.ok(!cleaned.trim().startsWith('|'), label + ': leading "|" must be stripped');
    assert.ok(!cleaned.trim().endsWith('|'), label + ': trailing "|" must be stripped');
    assert.ok(cleaned.includes('CO\u201150'), label + ': real content must survive stripping');
    console.log('[PASS] ' + label + ': single-cell table row loses its pipe wrapper, keeps content');

    // --- a real multi-column table (header + separator + data row) ---
    const table = [
      '| Denial Code | Reason |',
      '|---|---|',
      '| CO-50 | Medical necessity not established |'
    ].join('\n');
    const cleanedTable = stripMd(table);
    assert.ok(!cleanedTable.includes('|'), label + ': no pipe characters should remain after stripping a full table');
    assert.ok(!/^\s*[-: ]+$/m.test(cleanedTable.split('\n').filter(Boolean)[0] || ''),
      label + ': separator row must be removed, not just have its pipes stripped');
    assert.ok(cleanedTable.includes('CO-50') && cleanedTable.includes('Medical necessity not established'),
      label + ': data row content must survive, joined instead of concatenated');
    console.log('[PASS] ' + label + ': multi-column table separator row removed, data row content preserved');

    // --- plain sentences (the common case) must be completely unaffected ---
    const plain = 'The insurer denied the claim citing missing prior authorization.';
    assert.strictEqual(stripMd(plain), plain, label + ': plain sentence must pass through unchanged');
    console.log('[PASS] ' + label + ': plain non-markdown sentence is untouched');

    // --- existing markdown-emphasis stripping must still work (no regression) ---
    assert.strictEqual(stripMd('**Claim ID:** HC-DEN-2026-0417'), 'Claim ID: HC-DEN-2026-0417',
      label + ': bold-marker stripping must still work');
    console.log('[PASS] ' + label + ': pre-existing bold/heading/bullet stripping unaffected');
  });

  console.log('\n=== SUMMARY ===');
  console.log('stripMd() in both hc-denial-war-room.html and hc-main-strategist.html');
  console.log('now strips markdown table pipes (including separator rows) in addition');
  console.log('to emphasis/heading/bullet markup, so LLM answers formatted as table rows');
  console.log('no longer leak raw "| ... |" wrappers into client-facing rationale text.');
}

run();
