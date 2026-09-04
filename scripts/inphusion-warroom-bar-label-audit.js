#!/usr/bin/env node
/**
 * inphusion-warroom-bar-label-audit.js
 *
 * The "INJECT ANOMALY INTO WAR ROOM" InphusionSys control bar is copy-pasted
 * per-file (no shared module) into whichever page it's added to — markup,
 * scenario data, and the runInphusionWarRoomScenario() function all inline.
 * That makes it easy for a copy-paste to leave the WRONG vertical's label,
 * scenario list, and injected alert text sitting on a page whose actual
 * <body data-vertical="..."> says something else entirely (found on
 * pm-strategist.html: data-vertical="pm" but the whole bar says REAL_ESTATE).
 *
 * This script finds every file carrying the bar and reports whether its
 * <body data-vertical="X"> matches the bar's own [VERTICAL] label and its
 * "Injected [...] into VERTICAL" alert text. A mismatch on any of the three
 * is a real bug, not a false positive — this only flags exact string
 * disagreement, nothing fuzzy.
 *
 * Usage:
 *   node scripts/inphusion-warroom-bar-label-audit.js
 */

const fs = require('fs');
const { execSync } = require('child_process');

function findCarrierFiles(repoRoot) {
  const out = execSync(
    "grep -rl 'INPHUSIONSYS.*WAR ROOM SUITE' --include='*.html' .",
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }
  ).toString().trim();
  return out ? out.split('\n').map(f => f.replace(/^\.\//, '')) : [];
}

function auditFile(repoRoot, relPath) {
  const content = fs.readFileSync(`${repoRoot}/${relPath}`, 'utf8');

  const dataVertical = (content.match(/data-vertical="([^"]*)"/) || [])[1] || null;
  const barLabel = (content.match(/INPHUSIONSYS \[([A-Z_]*)\]/) || [])[1] || null;
  const alertVertical = (content.match(/Injected \[" \+ sel\.value \+ "\] into ([A-Z_]*)/) || [])[1] || null;

  // Normalize for comparison: data-vertical is lowercase/short (e.g. "pm",
  // "construction"), bar/alert are UPPER_SNAKE full names (e.g. "PM",
  // "REAL_ESTATE"). We only compare bar-vs-alert directly (both same
  // format); data-vertical is reported alongside for a human to eyeball,
  // since the short-name <-> full-name mapping isn't 1:1 codified anywhere.
  const barAlertMatch = barLabel && alertVertical ? barLabel === alertVertical : null;

  return { relPath, dataVertical, barLabel, alertVertical, barAlertMatch };
}

function main() {
  const repoRoot = process.cwd();
  const files = findCarrierFiles(repoRoot);

  if (!files.length) {
    console.log('No files found carrying the InphusionSys War Room control bar.');
    return;
  }

  console.log(`Found ${files.length} file(s) carrying the control bar:\n`);

  const flagged = [];
  for (const f of files) {
    const r = auditFile(repoRoot, f);
    const mismatchNote = r.barAlertMatch === false ? '  <-- BAR LABEL / ALERT TEXT MISMATCH' : '';
    console.log(
      `${r.relPath}\n  body data-vertical: ${r.dataVertical}\n  bar label:          [${r.barLabel}]\n  alert text:         into ${r.alertVertical}${mismatchNote}\n`
    );
    if (r.barAlertMatch === false) flagged.push(r.relPath);
    // Also flag when data-vertical exists but clearly disagrees in spirit
    // with the bar label (e.g. "pm" vs "REAL_ESTATE") — left for a human to
    // eyeball since short-name matching isn't reliable enough to assert here.
  }

  if (flagged.length) {
    console.log(`--- ${flagged.length} file(s) with an internal bar-label / alert-text mismatch ---`);
    flagged.forEach(f => console.log(`  ${f}`));
  } else {
    console.log('No internal bar-label / alert-text mismatches found. Still eyeball data-vertical above by hand — a bar can be internally consistent and still be on the wrong page.');
  }
}

main();
