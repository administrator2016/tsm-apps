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

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE_URL = process.env.TSM_BASE_URL || 'http://localhost:3000';
const HEADLESS = process.env.TSM_HEADLESS !== 'false';
const NAV_TIMEOUT = 20000;
const STEP_TIMEOUT = 15000;
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
// TSM FIX: the app now sits behind a login gate (/html/login.html ->
// POST /api/auth/login), confirmed by tests/e2e/debug-hc.js. Every page
// in this suite was being loaded unauthenticated, which is why selectors
// that are unquestionably present in the raw HTML (verified via curl)
// were unfindable once a real browser session with JS actually ran on
// the page — auth-gated behavior curl never triggers and never shows.
// Deliberately NOT hardcoded: read from env so this file can be
// committed without baking a live credential into git history.
const AUTH_PASSWORD = process.env.TSM_AUTH_PASSWORD || '';

// ── step helpers ─────────────────────────────────────────────────────────

async function login(page) {
  if (!AUTH_PASSWORD) {
    console.log('  ⚠ TSM_AUTH_PASSWORD not set — skipping login, pages will 401/redirect');
    return;
  }
  await page.goto(BASE_URL.replace(/\/$/, '') + '/html/login.html', {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT,
  });
  const result = await page.evaluate(async (pw) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    return { status: res.status, ok: res.ok };
  }, AUTH_PASSWORD);
  if (!result.ok) {
    console.log(`  ⚠ login POST returned ${result.status} — proceeding anyway`);
  }
}

async function gotoPage(page, urlPath) {
  const url = BASE_URL.replace(/\/$/, '') + urlPath;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  return url;
}

async function clickOnclick(page, fnName, timeout = STEP_TIMEOUT) {
  const sel = `[onclick^="${fnName}("]`;
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`element disappeared before click: ${s}`);
    el.click();
  }, sel);
}

async function clickSelector(page, sel, timeout = STEP_TIMEOUT) {
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`element disappeared before click: ${s}`);
    el.click();
  }, sel);
}

async function clickId(page, id, timeout = STEP_TIMEOUT) {
  const sel = `#${id}`;
  await page.waitForSelector(sel, { timeout, visible: true });
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) throw new Error(`element disappeared before click: ${s}`);
    el.click();
  }, sel);
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
    case 'clickSelector':
      return clickSelector(page, step.selector, step.timeout);
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
      // TSM FIX: 'sbSample' is a passive status <span> in the status bar
      // (id="sbSample", no click handler) — it only ever displays "READY"
      // / "SAMPLE · X" text, it doesn't load anything. The real sample
      // loaders are the 4 buttons in the sidebar's "QUICK SAMPLES" row
      // (smp-complaint / smp-contract / smp-regulatory / smp-employment),
      // each calling loadSample('type') inline. Target that function
      // directly instead of a non-interactive element.
      { kind: 'clickOnclick', fn: 'loadSample' },
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
      { kind: 'clickSelector', selector: '.ntab[data-tab="grants"]' },
      { kind: 'sleep', ms: 300 },
      { kind: 'clickId', id: 'schBtnLoadSample' },
      { kind: 'sleep', ms: 1000 },
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
  // TSM FIX: all these pages share the same origin and several relay/
  // session keys are read/written globally (RELAY_REGISTRY in
  // tsm-auto-pipeline.js, TSM_AUTO_LAUNCH, per-vertical *_WAR_RELAY
  // keys). A prior vertical's run — especially a failed one that broke
  // mid-chain — can leave stale localStorage that changes how the NEXT
  // vertical's page behaves on load (e.g. auto-launching an analysis it
  // never asked for). A dedicated browser context per vertical gives
  // each one a genuinely isolated storage partition, with no risk of
  // wiping out a war room's OWN relay write to its own strategist page
  // later in the same chain (which page.evaluateOnNewDocument-based
  // manual clearing would do, since that hook fires before every
  // navigation, including the in-chain war-room -> strategist hop).
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);

  const consoleLogs = [];
  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  // DIAGNOSTIC: track in-flight requests so a navigation/step timeout tells
  // us exactly which URL never resolved, instead of just "20000ms exceeded".
  const pendingRequests = new Map();
  page.on('request', (req) => {
    pendingRequests.set(req.url(), { method: req.method(), start: Date.now() });
  });
  page.on('requestfinished', (req) => pendingRequests.delete(req.url()));
  page.on('requestfailed', (req) => pendingRequests.delete(req.url()));

  // Nearly every war room (Healthcare, Legal, Construction, Insurance,
  // FinOps, RealEstate, PM Copilot at minimum) auto-fires its own engine
  // pipeline ~800-900ms after page load unless
  // localStorage.tsm_auto_mode === 'off' — a demo/kiosk auto-play
  // feature. Left on, it races the test's own manual clickId/
  // clickOnclick steps and can navigate the page out from under them.
  // Safe to set on every navigation (idempotent, same key/value).
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('tsm_auto_mode', 'off'); } catch (e) {}
  });

  await login(page);

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
        let screenshotPath = null;
        try {
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
          screenshotPath = path.join(
            SCREENSHOT_DIR,
            `${vertical.name}-step${i}-${Date.now()}.png`
          );
          await page.screenshot({ path: screenshotPath, fullPage: true });
    const __debugInfo = await page.evaluate(() => ({
      bodyLen: document.body.innerHTML.length,
      sampleBtnCount: document.querySelectorAll('[onclick^="loadSample("]').length,
      sampleBtnHTML: document.querySelector('.sample-row')?.outerHTML || 'NOT FOUND',
      hasErrorBanner: !!document.querySelector('.error, .error-banner, [class*="error"]'),
    })).catch(e => ({ evalFailed: e.message }));
    console.log('    DOM check:', JSON.stringify(__debugInfo, null, 2));
    console.log('    Console/page errors:\\n' + (consoleLogs.join('\\n') || '(none)'));
        } catch (shotErr) {
          // screenshot capture is best-effort; don't let it mask the real failure
          screenshotPath = null;
        }
        if (pendingRequests.size) {
          console.log("    STILL PENDING at failure:");
          for (const [url, info] of pendingRequests.entries()) {
            console.log(`      ${info.method} ${url} (open ${Date.now() - info.start}ms)`);
          }
        } else {
          console.log("    (no pending requests at failure -- not a hung network call)");
        }
        failures.push({
          stepIndex: i,
          step,
          error: err.message,
          url: page.url(),
          screenshot: screenshotPath,
        });
        // stop this vertical's chain on first failure — later steps assume
        // earlier ones succeeded (relay data, page navigation, etc.)
        break;
      }
    }
  } finally {
    await page.close();
    await context.close();
  }

  return { name: vertical.name, pass: failures.length === 0, failures };
}

async function main() {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    defaultViewport: { width: 1440, height: 900 },
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
      const fail = result.failures[0];
      console.log(`  ✗ ${vertical.name} FAIL at step ${fail.stepIndex}`);
      console.log(`    ${JSON.stringify(fail.step)}`);
      console.log(`    ${fail.error}`);
      console.log(`    url: ${fail.url}`);
      if (fail.screenshot) console.log(`    screenshot: ${fail.screenshot}`);
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