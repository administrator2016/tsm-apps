#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   test-crcr-question-bank.js
   Verifies the CRCR/HFMA changes shipped in 553de549 by loading the
   REAL shipped files (not reimplemented) and checking:
     1. Both crcr-question-bank.js copies are byte-identical
     2. CRCR_QUESTION_BANK / CRCR_UNITS / CRCR_EXAM_SPEC shape is sane
     3. Every question has valid opts/ans/unit
     4. No leftover AAHAM references in tracked (non-backup) files
     5. crc-hc-exam.html / crc-hc-practice.html / crcr-study-mode.html
        all <script src> the shared bank
   Run from repo root: node test-crcr-question-bank.js
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = process.cwd();
let pass = 0, fail = 0;
const failures = [];

function check(label, cond) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function readFile(rel) {
  const p = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

console.log('============================================================');
console.log('CRCR QUESTION BANK — VERIFICATION');
console.log('============================================================\n');

console.log('[1] File identity');
const bankA = readFile('html/finops-suite/crcr-question-bank.js');
const bankB = readFile('html/healthcare/hc-academy/crcr-question-bank.js');

check('finops-suite/crcr-question-bank.js exists', !!bankA);
check('hc-academy/crcr-question-bank.js exists', !!bankB);
if (bankA && bankB) {
  check('the two shipped copies are byte-identical', bankA === bankB);
}

console.log('\n[2] Loading real file into sandbox (no reimplementation)');
let sandbox = {};
let BANK, UNITS, SPEC;
if (bankA) {
  try {
    vm.createContext(sandbox);
    vm.runInContext(bankA, sandbox, { filename: 'crcr-question-bank.js' });
    check('file executes without throwing', true);
    BANK = vm.runInContext(
      'typeof CRCR_QUESTION_BANK !== "undefined" ? CRCR_QUESTION_BANK : undefined',
      sandbox
    );
    UNITS = vm.runInContext(
      'typeof CRCR_UNITS !== "undefined" ? CRCR_UNITS : undefined',
      sandbox
    );
    SPEC = vm.runInContext(
      'typeof CRCR_EXAM_SPEC !== "undefined" ? CRCR_EXAM_SPEC : undefined',
      sandbox
    );
  } catch (e) {
    check(`file executes without throwing (error: ${e.message})`, false);
  }
}

check('CRCR_QUESTION_BANK is a non-empty array', Array.isArray(BANK) && BANK.length > 0);
check('CRCR_UNITS is defined with unit1..unit4', UNITS && ['unit1','unit2','unit3','unit4'].every(k => k in UNITS));
check('CRCR_EXAM_SPEC is defined', !!SPEC);
if (SPEC) {
  check('CRCR_EXAM_SPEC.questions === 75 (real HFMA exam length)', SPEC.questions === 75);
  check('CRCR_EXAM_SPEC.minutes === 90 (real HFMA exam length)', SPEC.minutes === 90);
  check('CRCR_EXAM_SPEC.passPct === 70 (real HFMA passing score)', SPEC.passPct === 70);
}

if (BANK) {
  console.log(`\n  Question count: ${BANK.length}`);
}

console.log('\n[3] Per-question integrity');
if (BANK) {
  let shapeOk = true;
  let unitOk = true;
  let ansOk = true;
  let dupCount = 0;
  const seen = new Set();

  BANK.forEach((item) => {
    if (typeof item.q !== 'string' || !item.q.trim()) shapeOk = false;
    if (!Array.isArray(item.opts) || item.opts.length < 2) shapeOk = false;
    if (typeof item.ans !== 'number' || item.ans < 0 || item.ans >= (item.opts || []).length) ansOk = false;
    if (!UNITS || !(item.unit in UNITS)) unitOk = false;

    const key = item.q.trim().toLowerCase();
    if (seen.has(key)) dupCount++;
    seen.add(key);
  });

  check('every question has a non-empty q + >=2 opts', shapeOk);
  check('every question.ans is a valid index into its opts', ansOk);
  check('every question.unit maps to a real CRCR_UNITS key', unitOk);
  check('no duplicate question text within the bank', dupCount === 0);
  if (dupCount > 0) console.log(`    (found ${dupCount} duplicate question(s))`);
}

console.log('\n[4] AAHAM → HFMA rebrand completeness');
const filesToScan = [
  'html/demo/presentations/career-demo-presentation.html',
  'html/demo/presentations/career-training-presentation.html',
  'html/demo/presentations/data/career-training.json',
  'html/demo/tsm-demo-console.html',
  'html/finops-suite/crcr-study-mode.html',
  'html/healthcare/hc-academy/crc-hc-exam.html',
  'html/healthcare/hc-academy/crc-hc-practice.html',
  'html/tsm-career-training-platform.html'
];

filesToScan.forEach(rel => {
  const content = readFile(rel);
  if (content === null) {
    check(`${rel} exists`, false);
    return;
  }
  check(`${rel} has no AAHAM references`, !content.includes('AAHAM'));
});

console.log('\n[5] Consumer pages load the shared bank');
const consumers = [
  'html/finops-suite/crcr-study-mode.html',
  'html/healthcare/hc-academy/crc-hc-exam.html',
  'html/healthcare/hc-academy/crc-hc-practice.html'
];

consumers.forEach(rel => {
  const content = readFile(rel);
  if (content === null) {
    check(`${rel} exists`, false);
    return;
  }
  check(`${rel} <script src>s crcr-question-bank.js`, /<script\s+src=["']crcr-question-bank\.js["']/.test(content));
});

console.log('\n============================================================');
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('============================================================');

if (fail > 0) {
  console.log('\nFailed checks:');
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
} else {
  process.exit(0);
}
