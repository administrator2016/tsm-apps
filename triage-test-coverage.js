#!/usr/bin/env node
// triage-test-coverage.js
// Classifies every test/spec file in the repo as REAL (has data/logic assertions)
// vs DEMO-ONLY (screenshot/nav walkthrough, no business-logic checks).
// Usage: node triage-test-coverage.js [root-dir]

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || '.';

// Patterns that indicate a genuine assertion about data/logic correctness
const REAL_PATTERNS = [
  /\bexpect\(/,
  /\.toBe\(/,
  /\.toEqual\(/,
  /\.toMatchObject\(/,
  /\bassert\(/,
  /\bassert\.strictEqual\(/,
  /\bassert\.deepEqual\(/,
  /console\.log\(['"]OK:/,   // matches the style used in test-training-intelligence-quiz-honesty.js
];

// Patterns that suggest a file is demo/screenshot-only rather than logic-testing
const DEMO_PATTERNS = [
  /runStory\(/,
  /\.screenshot\(/,
  /page\.goto\(/,
  /no console errors/i,
  /nav(igation)? works/i,
];

// Vertical name is inferred from the file path segment before /tests/ or from filename prefix
function inferVertical(filePath) {
  const parts = filePath.split(path.sep);
  const demoIdx = parts.indexOf('demo');
  if (demoIdx > -1 && parts[demoIdx + 1]) {
    return parts[demoIdx + 1].replace(/-demo\.spec\.js$/, '').replace(/\.spec\.js$/, '');
  }
  const base = path.basename(filePath);
  const m = base.match(/^([a-z0-9-]+?)[-_](test|spec)/i);
  return m ? m[1] : 'unclassified';
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(spec|test)\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(root);
const results = {};

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const realHits = REAL_PATTERNS.filter(p => p.test(content)).length;
  const demoHits = DEMO_PATTERNS.filter(p => p.test(content)).length;

  // A file only counts as REAL if it has real assertions AND those assertions
  // outnumber/aren't purely incidental to demo-walkthrough code.
  let classification;
  if (realHits >= 2) {
    classification = 'REAL';
  } else if (realHits === 1 && demoHits === 0) {
    classification = 'REAL (weak — only 1 assertion pattern, verify manually)';
  } else if (demoHits > 0 && realHits === 0) {
    classification = 'DEMO-ONLY';
  } else {
    classification = 'UNCLEAR — needs manual read';
  }

  const vertical = inferVertical(file);
  results[vertical] = results[vertical] || [];
  results[vertical].push({ file: path.relative(root, file), classification, realHits, demoHits });
}

// Print grouped report
const verticals = Object.keys(results).sort();
for (const v of verticals) {
  console.log(`\n=== ${v} ===`);
  for (const r of results[v]) {
    console.log(`  [${r.classification}] ${r.file}  (real:${r.realHits} demo:${r.demoHits})`);
  }
}

// Summary
console.log('\n\n=== SUMMARY ===');
for (const v of verticals) {
  const files = results[v];
  const real = files.filter(f => f.classification.startsWith('REAL')).length;
  const demo = files.filter(f => f.classification === 'DEMO-ONLY').length;
  const unclear = files.length - real - demo;
  console.log(`${v}: ${files.length} files — ${real} real, ${demo} demo-only, ${unclear} unclear`);
}