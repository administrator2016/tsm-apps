'use strict';

// E2E-style regression test for the FinOps War Room -> Strategist ->
// Executive Portal relay chain, added this session after confirming (via
// direct grep/inspection of the real HTML, not assumption) that this
// chain was already live-wired -- contradicting an older audit note that
// called the Executive Portal relay "demo-only." No test previously
// existed for this chain at all.
//
// This test does not spin up a browser; like
// test-hc-exec-portal-business-impact-delta.js, it exercises the same
// plain-JS logic the real pages run, hand-mirrored from the exact lines
// in the HTML (this logic lives inline in giant HTML files, not in a
// requirable module). Two things are verified, matching the two real
// findings from this session's investigation:
//
//   1. RELAY-KEY PRIORITY (finops-executive-portal.html's readRelay()):
//      the portal checks ["tsm_strategist_relay", "TSM_FINOPS_STRATEGIST_RELAY",
//      "tsm_war_relay_finops-suite"] in that order. tsm_strategist_relay
//      carries the full payload (wip/explain/structuredCase/outputContract);
//      TSM_FINOPS_STRATEGIST_RELAY is a leaner Sentinel-push key
//      (anomalies-only, written by the "SENTINEL PUSH" block). If the
//      priority were reversed, the portal would silently show less data
//      even when the rich relay is present -- this is the same class of
//      bug already found and fixed once on the Healthcare exec portal
//      per the code comment at finops-executive-portal.html:983-987.
//
//   2. EXPOSURE/RISKSCORE HONESTY FLAGS (finops-main-strategist.html's
//      generateReport()/relayToExecutive() writes to tsm_strategist_relay):
//      exposure/riskScore fall back to a hardcoded demo-scenario literal
//      ('$91,800-$112,200' / '70/100' -- the canned "ERA Batch" demo
//      content, confirmed via grep, not a fabricated stand-in for real
//      data) when the output-parsing regex finds nothing. Added this
//      session: exposureDefaulted/riskScoreDefaulted flags so a
//      consumer can tell a real extracted figure from the demo fallback
//      -- same honesty convention bpoSaveBncaReport() already uses for
//      confidenceDefaulted.

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK:', msg);
  }
}

// ── Part 1: relay-key read priority ──────────────────────────────────
// Mirrors finops-executive-portal.html's RELAY_KEYS array and readRelay()
// function exactly (both are pure -- no DOM needed to test this part).
const RELAY_KEYS = ['tsm_strategist_relay', 'TSM_FINOPS_STRATEGIST_RELAY', 'tsm_war_relay_finops-suite'];

function readRelayFrom(store) {
  for (let i = 0; i < RELAY_KEYS.length; i++) {
    const raw = store[RELAY_KEYS[i]];
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { return null; }
    }
  }
  return null;
}

// Simulate a real session: the strategist has run generateReport() (rich
// payload -> tsm_strategist_relay) AND its own SENTINEL PUSH block has
// also fired (anomalies-only -> TSM_FINOPS_STRATEGIST_RELAY), which
// happens on every real strategist run per that block's own comment.
const richPayload = {
  summary: 'Full strategist synthesis text',
  structuredCase: { financialExposure: 91800 },
  outputContract: { passed: true },
  exposure: '$91,800',
  riskScore: '82/100',
  exposureDefaulted: false,
  riskScoreDefaulted: false
};
const anomaliesOnlyPayload = {
  anomalies: [{ id: 'finops-strat-1', exposure: 91800, confidence: 82 }],
  generatedAt: new Date().toISOString()
};

const storeWithBoth = {
  tsm_strategist_relay: JSON.stringify(richPayload),
  TSM_FINOPS_STRATEGIST_RELAY: JSON.stringify(anomaliesOnlyPayload)
};

const wired = readRelayFrom(storeWithBoth);

assert(wired && wired.structuredCase && wired.structuredCase.financialExposure === 91800,
  'exec portal readRelay() prefers the rich tsm_strategist_relay payload when both keys are present - got structuredCase');
assert(wired && !('anomalies' in wired),
  'exec portal readRelay() does NOT fall through to the anomalies-only Sentinel payload when the rich relay exists');

// Regression guard: prove the priority ORDER is what makes this work --
// if the array were reversed (the bug class already fixed once for HC),
// the portal would silently show the leaner anomalies-only shape instead.
function readRelayWithReversedPriority(store) {
  const reversedKeys = RELAY_KEYS.slice().reverse();
  for (let i = 0; i < reversedKeys.length; i++) {
    const raw = store[reversedKeys[i]];
    if (raw) { try { return JSON.parse(raw); } catch (e) { return null; } }
  }
  return null;
}
const wiredWrong = readRelayWithReversedPriority(storeWithBoth);
assert(wiredWrong && 'anomalies' in wiredWrong && !('structuredCase' in wiredWrong),
  'regression guard: confirms reversed priority WOULD silently lose structuredCase/outputContract (this bug class is real)');

// ── Part 2: exposure/riskScore honesty flags ─────────────────────────
// Mirrors the exact fallback + flag logic added to generateReport() /
// relayToExecutive() in finops-main-strategist.html this session.
function buildRelayExposureFields(expMatch, riskMatch) {
  return {
    exposure: expMatch ? expMatch[1] : '$91,800–$112,200',
    riskScore: riskMatch ? riskMatch[1] : '70/100',
    exposureDefaulted: !expMatch,
    riskScoreDefaulted: !riskMatch
  };
}

// Case A: real document, regex extraction succeeds.
const realExtraction = buildRelayExposureFields(['', '$47,250'], ['', '58/100']);
assert(realExtraction.exposure === '$47,250' && realExtraction.exposureDefaulted === false,
  `real extraction is NOT flagged as defaulted - got exposure=${realExtraction.exposure}, exposureDefaulted=${realExtraction.exposureDefaulted}`);
assert(realExtraction.riskScore === '58/100' && realExtraction.riskScoreDefaulted === false,
  `real extraction is NOT flagged as defaulted - got riskScore=${realExtraction.riskScore}, riskScoreDefaulted=${realExtraction.riskScoreDefaulted}`);

// Case B: extraction fails (e.g. an unrecognized document format) -- the
// relay carries the ERA-batch demo numbers, now honestly flagged.
const failedExtraction = buildRelayExposureFields(null, null);
assert(failedExtraction.exposure === '$91,800–$112,200' && failedExtraction.exposureDefaulted === true,
  `failed extraction falls back to demo value AND is flagged - got exposure=${failedExtraction.exposure}, exposureDefaulted=${failedExtraction.exposureDefaulted}`);
assert(failedExtraction.riskScore === '70/100' && failedExtraction.riskScoreDefaulted === true,
  `failed extraction falls back to demo value AND is flagged - got riskScore=${failedExtraction.riskScore}, riskScoreDefaulted=${failedExtraction.riskScoreDefaulted}`);

// Regression guard: prove the OLD shape (no flags at all) made a real
// value and the demo fallback indistinguishable to any consumer.
function oldBuildRelayExposureFields(expMatch, riskMatch) {
  return {
    exposure: expMatch ? expMatch[1] : '$91,800–$112,200',
    riskScore: riskMatch ? riskMatch[1] : '70/100'
  };
}
const oldReal = oldBuildRelayExposureFields(['', '$47,250'], ['', '58/100']);
const oldFailed = oldBuildRelayExposureFields(null, null);
assert(!('exposureDefaulted' in oldReal) && !('exposureDefaulted' in oldFailed),
  'regression guard: confirms the pre-fix shape had no way to tell a real value from the demo fallback (gap was real)');

console.log('\n' + (process.exitCode ? 'TEST FAILED' : 'TEST PASSED'));
