#!/usr/bin/env node
/**
 * relay-write-trigger-audit.js
 *
 * For each vertical's war-room file, finds every call site of its
 * relay-write function(s) and reports which enclosing JS function each
 * call sits inside, classifying it as:
 *
 *   AUTO   - enclosing function name does NOT look like an escalate/route
 *            click handler (i.e. the relay write happens on its own,
 *            typically right after "all engines complete")
 *   GATED  - enclosing function name DOES look like an escalate/route
 *            click handler (i.e. the relay write only happens when the
 *            user clicks Escalate/Route)
 *   TOPLEVEL - call site isn't inside any named function
 *
 * This is a heuristic (brace-depth function-stack tracker), not a real
 * JS parser. It's meant to surface call sites fast for a human to check,
 * not to be trusted blindly — always eyeball the flagged lines.
 *
 * Usage:
 *   node scripts/relay-write-trigger-audit.js
 */

const fs = require('fs');
const path = require('path');

// vertical name -> { file, relayFnNames: [regex-safe names to search for] }
const TARGETS = {
  FinOps:       { file: 'html/finops-suite/finops-war/finops-war-room.html', fns: ['storeRelay'] },
  Insurance:    { file: 'html/war-rooms/insure-war/insurance-war-room.html', fns: ['storeRelay'] },
  Construction: { file: 'html/war-rooms/construct-war/construction-war-room.html', fns: ['storeSession'] },
  Legal:        { file: 'html/war-rooms/legal-war/legal-war-room.html', fns: ['storeSession'] },
  BPO:          { file: 'html/war-rooms/bpo-war/bpo-war-room.html', fns: ['storeWarRoomRelay'] },
  'Real Estate':{ file: 'html/war-rooms/re-war/re-war-room.html', fns: ['tsmWriteRelay'] , alsoInline: ["localStorage.setItem('TSM_RE_WAR_RELAY'"] },
  Healthcare:   { file: 'html/healthcare/hc-denial-war-room.html', fns: ['syncStructuredCaseToEngine'] },
  'PM Copilot': { file: 'html/war-rooms/pm-copilot/pm-command.html', fns: ['relayToStrategist'] },
  NOC:          { file: 'html/l1-copilot/noc/noc-war-room.html', fns: ['relayToStrategist'] },
};

const ESCALATE_NAME_RE = /escalate|routeToStrategist|routeTo(Chief|Strategist)/i;

function classifyFile(repoRoot, name, cfg) {
  const filePath = path.join(repoRoot, cfg.file);
  if (!fs.existsSync(filePath)) {
    return { name, file: cfg.file, error: 'FILE NOT FOUND' };
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');

  // Track a simple stack of enclosing `function name(...) {` scopes by
  // counting braces. Good enough for these files' style (no minified JS).
  const stack = []; // { fnName, depth }
  let depth = 0;
  const callSites = [];

  const fnDeclRe = /function\s+([A-Za-z0-9_$]+)\s*\(/;

  lines.forEach((line, idx) => {
    const declMatch = line.match(fnDeclRe);
    if (declMatch) {
      stack.push({ fnName: declMatch[1], depth });
    }

    // Does this line call one of our target relay-write functions?
    const patterns = [...cfg.fns.map(f => `${f}(`), ...(cfg.alsoInline || [])];
    for (const p of patterns) {
      if (line.includes(p) && !declMatch) {
        const enclosing = stack.length ? stack[stack.length - 1].fnName : null;
        let cls = 'TOPLEVEL';
        if (enclosing) {
          cls = ESCALATE_NAME_RE.test(enclosing) ? 'GATED (inside escalate/route handler)' : 'AUTO (not inside an escalate/route handler)';
        }
        callSites.push({ lineNo: idx + 1, enclosing, cls, text: line.trim().slice(0, 120) });
      }
    }

    // crude brace depth tracking
    for (const ch of line) {
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      }
    }
  });

  return { name, file: cfg.file, callSites };
}

function main() {
  const repoRoot = process.cwd();
  const results = Object.entries(TARGETS).map(([name, cfg]) => classifyFile(repoRoot, name, cfg));

  for (const r of results) {
    console.log(`\n=== ${r.name} (${r.file}) ===`);
    if (r.error) {
      console.log(`  ${r.error}`);
      continue;
    }
    if (!r.callSites.length) {
      console.log('  No call sites found for the configured function name(s) — check TARGETS config, function may be named differently.');
      continue;
    }
    for (const c of r.callSites) {
      console.log(`  L${c.lineNo} [${c.cls}] in ${c.enclosing || '(top level)'}: ${c.text}`);
    }
  }

  console.log('\n--- Heuristic notes ---');
  console.log('This script only recognizes plain `function name(...) {` declarations,');
  console.log('not arrow functions or methods assigned to object properties. If a');
  console.log('vertical shows "No call sites found", check manually — it likely uses');
  console.log('a different declaration style, not that the relay is never written.');
}

main();
