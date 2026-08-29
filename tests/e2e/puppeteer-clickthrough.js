// tests/e2e/puppeteer-clickthrough.js
//
// Data-driven War Room -> Strategist -> Executive Portal click-through for
// every vertical that follows the standard fire/escalate/export pattern.
//
// Rebuilt 2026-08-29 after the working copy of this file (built live in a
// Codespace session against /workspaces/tsm-apps) was lost before being
// committed. The original run covered 7 verticals cleanly:
//   Healthcare, Construction, Legal, Insurance, Mortgage, Schools, HotelOps
// This rebuild reconstructs those 7 from the actual page source (not from
// memory) and adds the 4 verticals that were mapped out but never wired in:
//   FinOps, Real Estate, PM Copilot, Honeywell
//
// Deliberately NOT included (see notes at bottom of file):
//   BPO       - war room is document-intake-driven, needs seed data
//   Concierge - war room operates on live dispatched bookings, needs seed data
//
// Every selector below was read directly out of the corresponding .html
// file (onclick attribute or element id), not guessed. Two distinct click
// patterns exist across the suite and are handled by two step kinds:
//   - 'onclick'   -> targets [onclick="fnName()"], for pages that wire
//                    handlers inline in the markup (Healthcare, Construction,
//                    Legal, Insurance, FinOps, Real Estate, Honeywell)
//   - 'id'        -> targets #elementId directly, for pages that bind via
//                    addEventListener in a script block (Mortgage, Schools,
//                    HotelOps, PM Copilot)
// Mortgage/Schools/HotelOps strategist pages are passive relay receivers
// (they render whatever localStorage/sessionStorage relay key was written
// by the war room; there's no button to click), so their 'strategist' step
// is a wait-and-verify rather than a click, followed by a plain nav link
// over to the executive portal.

const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.TSM_BASE_URL || 'http://localhost:3000';
const HEADLESS = process.env.TSM_HEADLESS !== 'false';
const NAV_TIMEOUT = 20000;
const STEP_TIMEOUT = 15000;

// ── step helpers ─────────────────────────────────────────────────────────

async function gotoPage(page, urlPath) {
  const url = BASE_URL.replace(/\/$/, '') + urlPath;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  return url;
}

async function clickOnclick(page, fnName, timeout = STEP_TIMEOUT) {
  const sel = `[onclick^="${fnName}("]`;
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.click(sel);
}

async function clickId(page, id, timeout = STEP_TIMEOUT) {
  const sel = `#${id}`;
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.click(sel);
}

async function fillId(page, id, text, timeout = STEP_TIMEOUT) {
  const sel = `#${id}`;
  await page.waitForSelector(sel, { timeout });
  await page.evaluate((s, v) => {
    const el = document.querySelector(s);
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, sel, text);
}

async function waitForSelector(page, sel, timeout = STEP_TIMEOUT) {
  await page.waitForSelector(sel, { timeout, visible: true });
}

async function waitForEnabled(page, id, timeout = STEP_TIMEOUT) {
  await page.waitForFunction(
    (elId) => {
      const el = document.getElementById(elId);
      return el && !el.disabled;
    },
    { timeout },
    id
  );
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

const SAMPLE_TEXT =
  'TSM E2E SAMPLE DOCUMENT — synthetic test fixture, not a real record. ' +
  'Amount at risk: $184,220. Confidence: high. Generated for automated click-through only.';

// Run a step against a page. `kind` selects the interaction; every step
// kind is intentionally small and single-purpose rather than one giant
// generic dispatcher, so a failure names exactly which step type broke.
async function runStep(page, step) {
  switch (step.kind) {
    case 'goto':
      return gotoPage(page, step.path);
    case 'sleep':
      return sleep(step.ms);
    case 'clickOnclick':
      return clickOnclick(page, step.fn, step.timeout);
    case 'clickId':
      return clickId(page, step.id, step.timeout);
    case 'fillId':
      return fillId(page, step.id, step.text ?? SAMPLE_TEXT, step.timeout);
    case 'waitForSelector':
      return waitForSelector(page, step.selector, step.timeout);
    case 'waitForEnabled':
      return waitForEnabled(page, step.id, step.timeout);
    case 'waitForText':
      return page.waitForFunction(
        (needle) => document.body.innerText.toLowerCase().includes(needle.toLowerCase()),
        { timeout: step.timeout || STEP_TIMEOUT },
        step.text
      );
    case 'waitForTextGone':
      return page.waitForFunction(
        (needle) => !document.body.innerText.toLowerCase().includes(needle.toLowerCase()),
        { timeout: step.timeout || 30000 },
        step.text
      );
    default:
      throw new Error(`Unknown step kind: ${step.kind}`);
  }
}

// ── vertical configs ─────────────────────────────────────────────────────
// Each vertical is: name, then a flat ordered list of steps spanning
// War Room -> Strategist -> Executive Portal.

const VERTICALS = [
  // ── Previously verified (7/7 pass) — rebuilt from source ──────────────
  {
    name: 'Healthcare',
    steps: [
      { kind: 'goto', path: '/healthcare/hc-denial-war-room.html' },
      { kind: 'clickOnclick', fn: 'loadSample' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'fire-btn' },
      { kind: 'waitForEnabled', id: 'escalate-strategist-btn', timeout: 30000 },
      { kind: 'clickId', id: 'escalate-strategist-btn' },
      { kind: 'goto', path: '/healthcare/hc-main-strategist.html' },
      { kind: 'clickOnclick', fn: 'escalateToExecPortal', timeout: 20000 },
      { kind: 'goto', path: '/healthcare/executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'Construction',
    steps: [
      { kind: 'goto', path: '/war-rooms/construct-war/construction-war-room.html' },
      { kind: 'fillId', id: 'docPaste' },
      { kind: 'clickId', id: 'fireBtn' },
      { kind: 'waitForSelector', selector: '#escalateBar.visible', timeout: 30000 },
      { kind: 'clickOnclick', fn: 'escalateToStrategist' },
      { kind: 'goto', path: '/war-rooms/construct-war/construction-strategist.html' },
      { kind: 'clickOnclick', fn: 'escalateToExecutive', timeout: 20000 },
      { kind: 'goto', path: '/war-rooms/construct-war/construction-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'Legal',
    steps: [
      { kind: 'goto', path: '/war-rooms/legal-war/legal-war-room.html' },
      { kind: 'clickId', id: 'sbSample' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'fireBtn' },
      { kind: 'waitForSelector', selector: '#escalateBottom', timeout: 30000 },
      { kind: 'clickOnclick', fn: 'escalateToChief' },
      { kind: 'goto', path: '/war-rooms/legal-war/legal-main-strategist.html' },
      { kind: 'clickOnclick', fn: 'runSynthesis', timeout: 20000 },
      { kind: 'sleep', ms: 1500 },
      { kind: 'clickId', id: 'escalate-btn' },
      { kind: 'goto', path: '/war-rooms/legal-war/legal-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
      // Legal's Executive Portal also has a distinct authorizeAction(...)
      // flow separate from the generic export — not exercised by this
      // happy-path pass, tracked as a "shared tabs" follow-up (see bottom).
    ],
  },
  {
    name: 'Insurance',
    steps: [
      { kind: 'goto', path: '/war-rooms/insure-war/insurance-war-room.html' },
      { kind: 'fillId', id: 'docPaste' },
      { kind: 'clickId', id: 'fireBtn' },
      { kind: 'waitForSelector', selector: '#escalateBar.visible', timeout: 30000 },
      { kind: 'clickOnclick', fn: 'escalateToStrategist' },
      { kind: 'goto', path: '/war-rooms/insure-war/insurance-strategist.html' },
      { kind: 'clickOnclick', fn: 'runStrategist', timeout: 20000 },
      { kind: 'sleep', ms: 1500 },
      { kind: 'clickOnclick', fn: 'escalateToExec' },
      { kind: 'goto', path: '/war-rooms/insure-war/insurance-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'Mortgage',
    // Strategist page here is a passive relay receiver — no button to
    // click, it renders from whatever the war room wrote to the relay key.
    steps: [
      { kind: 'goto', path: '/war-rooms/mortgage/mortgage-war-room.html' },
      { kind: 'clickId', id: 'btnLoadSample' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'btnRunAnalysis' },
      { kind: 'waitForEnabled', id: 'btnRelay', timeout: 30000 },
      { kind: 'clickId', id: 'btnRelay' },
      { kind: 'goto', path: '/war-rooms/mortgage/mortgage-strategist.html' },
      { kind: 'waitForTextGone', text: 'Awaiting relay', timeout: 15000 },
      { kind: 'goto', path: '/war-rooms/mortgage/mortgage-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'Schools',
    steps: [
      { kind: 'goto', path: '/war-rooms/schools-command/schools-command.html' },
      { kind: 'clickId', id: 'btnLoadSampleDocs' },
      { kind: 'sleep', ms: 500 },
      // An analysis type must be selected first — runDocAnalysis() otherwise
      // hits `if(!selectedAnalysis){alert(...);return;}` and a native alert()
      // freezes the page's JS context, which hangs every subsequent
      // CDP call that needs page evaluation (not just this step's own
      // timeout). Selecting a type here is a correctness requirement, not
      // an optional extra step.
      { kind: 'clickOnclick', fn: 'selectAnalysis' },
      { kind: 'clickId', id: 'doc-analyze-btn' },
      { kind: 'sleep', ms: 2000 },
      { kind: 'goto', path: '/war-rooms/schools-command/schools-strategist.html' },
      { kind: 'waitForTextGone', text: 'Awaiting relay', timeout: 15000 },
      { kind: 'goto', path: '/war-rooms/schools-command/schools-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'HotelOps',
    steps: [
      { kind: 'goto', path: '/hotelops/hotelops-war-room.html' },
      { kind: 'clickId', id: 'btnLoadSample' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'btnAnalyze' },
      { kind: 'waitForEnabled', id: 'btnRelay', timeout: 30000 },
      { kind: 'clickId', id: 'btnRelay' },
      { kind: 'goto', path: '/hotelops/hotelops-strategist.html' },
      { kind: 'waitForTextGone', text: 'Awaiting relay', timeout: 15000 },
      { kind: 'goto', path: '/hotelops/hotelops-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },

  // ── Newly added ──────────────────────────────────────────────────────
  {
    name: 'FinOps',
    steps: [
      { kind: 'goto', path: '/finops-suite/finops-war/finops-war-room.html' },
      { kind: 'clickOnclick', fn: "loadSample" }, // AP Aging sample chip
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'fireBtn' },
      { kind: 'waitForSelector', selector: '#escalateBar.visible', timeout: 30000 },
      { kind: 'clickOnclick', fn: 'escalateToStrategist' },
      { kind: 'goto', path: '/finops-suite/finops-war/finops-main-strategist.html' },
      // default relay chip is already 'warroom' (active), so the relayed
      // war-room output is used with no extra chip click needed
      { kind: 'clickId', id: 'genBtn' },
      { kind: 'waitForTextGone', text: 'Select a relay source', timeout: 30000 },
      { kind: 'clickId', id: 'relayExecBtn' },
      { kind: 'goto', path: '/finops-suite/finops-war/finops-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'RealEstate',
    steps: [
      { kind: 'goto', path: '/war-rooms/re-war/re-war-room.html' },
      { kind: 'sleep', ms: 1200 }, // guided tour auto-starts ~800ms after load
      { kind: 'clickOnclick', fn: 'endTour', timeout: 5000 },
      { kind: 'clickOnclick', fn: 'quickFire' },
      { kind: 'sleep', ms: 2000 },
      { kind: 'clickOnclick', fn: 'escalateToStrategist' },
      { kind: 'goto', path: '/war-rooms/re-war/re-strategist.html' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'clickOnclick', fn: 'escalateToExec', timeout: 20000 },
      { kind: 'goto', path: '/war-rooms/re-war/re-exec-portal.html' },
      { kind: 'waitForSelector', selector: '[onclick="exportSession()"]' },
      { kind: 'clickOnclick', fn: 'exportSession' },
    ],
  },
  {
    name: 'PMCopilot',
    steps: [
      { kind: 'goto', path: '/war-rooms/pm-copilot/pm-command.html' },
      { kind: 'clickId', id: 'btnLoadSample' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'btnAnalyze' },
      { kind: 'waitForEnabled', id: 'btnRelay', timeout: 30000 },
      { kind: 'clickId', id: 'btnRelay' },
      { kind: 'goto', path: '/war-rooms/pm-copilot/pm-strategist.html' },
      { kind: 'waitForSelector', selector: 'a[href="pm-exec-portal.html"]' },
      { kind: 'goto', path: '/war-rooms/pm-copilot/pm-exec-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
  {
    name: 'Honeywell',
    steps: [
      { kind: 'goto', path: '/plant-incident.html' },
      { kind: 'clickId', id: 'sampleBtn' },
      { kind: 'sleep', ms: 500 },
      { kind: 'clickId', id: 'fireBtn' },
      { kind: 'waitForEnabled', id: 'escalateBtn', timeout: 30000 },
      { kind: 'clickId', id: 'escalateBtn' },
      { kind: 'goto', path: '/war-rooms/honeywell-strategist.html' },
      { kind: 'sleep', ms: 1500 },
      { kind: 'clickOnclick', fn: 'escalateExec', timeout: 20000 },
      { kind: 'goto', path: '/war-rooms/honeywell-executive-portal.html' },
      { kind: 'waitForSelector', selector: '#tsmk-delivery-btn' },
      { kind: 'clickId', id: 'tsmk-delivery-btn' },
    ],
  },
];

// ── runner ───────────────────────────────────────────────────────────────

async function runVertical(browser, vertical) {
  const page = await browser.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  const failures = [];
  // Defense in depth: a native alert()/confirm()/prompt() freezes the page's
  // JS execution context, which stalls every subsequent CDP call that needs
  // page evaluation (waitForSelector, click, etc.) — not just the step that
  // triggered it. That reads as a full hang with zero further output, well
  // past any individual step's own timeout. Auto-dismissing here means a
  // stray dialog surfaces as a normal step failure instead of an unbounded
  // hang, for any vertical, not just the ones already known to have one.
  page.on('dialog', (dialog) => {
    failures.push({
      stepIndex: -1,
      step: { kind: 'unexpectedDialog' },
      error: `Unexpected ${dialog.type()} dialog: ${dialog.message()}`,
    });
    dialog.dismiss().catch(() => {});
  });

  try {
    for (const [i, step] of vertical.steps.entries()) {
      try {
        await runStep(page, step);
      } catch (err) {
        failures.push({ stepIndex: i, step, error: err.message });
        // stop this vertical's chain on first failure — later steps assume
        // earlier ones succeeded (relay data, page navigation, etc.)
        break;
      }
    }
  } finally {
    await page.close();
  }

  return { name: vertical.name, pass: failures.length === 0, failures };
}

async function main() {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];
  for (const vertical of VERTICALS) {
    console.log(`→ ${vertical.name}`);
    const result = await runVertical(browser, vertical);
    results.push(result);
    if (result.pass) {
      console.log(`  ✓ ${vertical.name} PASS`);
    } else {
      console.log(`  ✗ ${vertical.name} FAIL at step ${result.failures[0].stepIndex}`);
      console.log(`    ${JSON.stringify(result.failures[0].step)}`);
      console.log(`    ${result.failures[0].error}`);
    }
  }

  await browser.close();

  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`[${r.pass ? 'PASS' : 'FAIL'}] ${r.name}`);
  }
  const passCount = results.filter((r) => r.pass).length;
  console.log(`${passCount}/${results.length} verticals completed the full click-through cleanly.`);

  process.exit(passCount === results.length ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { VERTICALS, runVertical };

// ── Known open scope (carried over from the original session) ────────────
//
// 1. "Other tabs" not covered by this happy-path suite:
//    - FinOps Strategist has a second tab (4-Engine Doc Analysis) with its
//      own fireBtn/fireAllEngines(), separate from the Strategist Report
//      flow exercised above.
//    - PM Copilot's Executive Portal stacks four separate generated panels
//      behind their own role-gated routes.
//    - Legal's Executive Portal has a named authorizeAction(...) distinct
//      from the generic exportClientPackage() flow exercised above.
//    Covering these needs new step kinds (tab-switch, role-gated route),
//    not just new VERTICALS entries.
//
// 2. Verticals not included here:
//    - BPO: war room is document-intake-driven; needs seed data (a sample
//      document) to exist before a click chain has anything real to click.
//    - Concierge: war room operates on live dispatched bookings (bookQuote,
//      simulateEvent, etc.), not a fire-and-escalate pattern; also needs
//      seed data (an active booking) first.
