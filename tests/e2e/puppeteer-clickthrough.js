/**
 * Click-through E2E test — exercises the real War Room -> Strategist ->
 * Executive Portal chain for each vertical: fires engines, escalates,
 * runs the strategist, escalates again, and hits export — rather than
 * just checking that pages load (see puppeteer-suite-hub-crawl.js for
 * the link-crawl version).
 *
 * Covers 7 of the 13 chained verticals with real selectors pulled
 * directly from source (Healthcare, Construction, Legal, Insurance,
 * Mortgage, Schools, HotelOps) — a representative spread of both button
 * conventions used across the platform (inline onclick= vs id + JS
 * event-listener). The remaining 6 (FinOps, Real Estate, PM Copilot,
 * BPO, Concierge, Honeywell) aren't in VERTICALS below yet; each has
 * its own selector quirks documented in MASTER_VERTICAL_WALKTHROUGH.md
 * §3/6/9/10/12/13 — add a config entry the same shape as the ones here
 * once those are pulled from source the same way.
 *
 * Note on 'waitMs' after firing engines: in an environment with a real
 * GROQ_API_KEY, results render asynchronously (streamed), so a fixed
 * sleep is a race. Where the resulting selector is known (e.g. the
 * escalate button that gets injected into the DOM once the engine
 * results panel renders), prefer a 'waitFor' step with a generous
 * timeout over trusting the preceding 'click' step's waitMs.
 *
 * Usage:
 *   SUITE_LOGIN_PASS="..." node tests/e2e/puppeteer-clickthrough.js
 *   SUITE_LOGIN_PASS="..." SUITE_ONLY=healthcare node tests/e2e/puppeteer-clickthrough.js
 */
const puppeteer = require('puppeteer');

const BASE_URL = process.env.SUITE_BASE_URL || 'http://localhost:3000';
const LOGIN_PASS = process.env.SUITE_LOGIN_PASS;
const CHROME_PATH = process.env.CHROME_PATH || null;
const ONLY = process.env.SUITE_ONLY || null; // restrict to one vertical's `key` for debugging

// Each step is one of:
//   { type: 'click', selector, label, waitMs, requiredEnabled }
//   { type: 'clickOnclick', fn, label, waitMs }   -- clicks [onclick*="fn("]
//   { type: 'goto', path, label }
//   { type: 'waitEnabled', selector, label, timeoutMs }  -- poll until selector loses `disabled`
//   { type: 'waitFor', selector, label, timeoutMs }      -- poll until selector exists in DOM
//   { type: 'type', selector, text, label, waitMs }      -- click + type + fire input event
const VERTICALS = [
  {
    key: 'healthcare',
    name: 'Healthcare',
    warRoom: '/html/healthcare/hc-denial-war-room.html',
    strategist: '/html/healthcare/hc-main-strategist.html',
    exec: '/html/healthcare/executive-portal.html',
    warRoomSteps: [
      { type: 'type', selector: '#doc-text', text: 'Sample denial letter for click-through testing: CO-29 timely filing limit exceeded, PR-96 non-covered charge, CO-4 procedure/modifier inconsistent, CO-11 diagnosis inconsistent with procedure. Patient DOB 01/01/1980, claim amount $4,820.00, date of service 2026-07-15, provider NPI 1234567890. This synthetic text exceeds the 20-character minimum required to enable engine firing.', label: 'paste sample denial doc into #doc-text' },
      { type: 'waitEnabled', selector: '#fire-btn', label: 'wait for FIRE ALL 5 ENGINES to enable', timeoutMs: 15000 },
      { type: 'click', selector: '#fire-btn', label: 'FIRE ALL 5 ENGINES', waitMs: 1000 },
      // #escalate-strategist-btn is injected into the results panel only
      // after the 5-engine streamed analysis completes — wait for it
      // rather than trusting a fixed sleep after firing.
      { type: 'waitFor', selector: '#escalate-strategist-btn', label: 'wait for engine results panel + escalate button to render', timeoutMs: 45000 },
      { type: 'click', selector: '#escalate-strategist-btn', label: 'Escalate to Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      { type: 'click', selector: '#strat-run-btn', label: 'Run HC Strategist Analysis', waitMs: 1000 },
      { type: 'waitFor', selector: '[onclick*="escalateToExecPortal("]', label: 'wait for strategist analysis to complete', timeoutMs: 45000 },
      { type: 'clickOnclick', fn: 'escalateToExecPortal', label: 'Escalate to Exec Portal', waitMs: 1500 },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'construction',
    name: 'Construction',
    warRoom: '/html/war-rooms/construct-war/construction-war-room.html',
    strategist: '/html/war-rooms/construct-war/construction-strategist.html',
    exec: '/html/war-rooms/construct-war/construction-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#fireBtn', label: 'FIRE ALL 6 ENGINES', waitMs: 4000 },
      { type: 'clickOnclick', fn: 'escalateToStrategist', label: 'Escalate to Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      { type: 'clickOnclick', fn: 'escalateToExecutive', label: 'Escalate to Executive', waitMs: 1500 },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'legal',
    name: 'Legal',
    warRoom: '/html/war-rooms/legal-war/legal-war-room.html',
    strategist: '/html/war-rooms/legal-war/legal-main-strategist.html',
    exec: '/html/war-rooms/legal-war/legal-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#smp-complaint', label: 'Load sample: Employment Class Action', waitMs: 800 },
      { type: 'waitEnabled', selector: '#fireBtn', label: 'wait for FIRE ALL 6 ENGINES to enable', timeoutMs: 15000 },
      { type: 'click', selector: '#fireBtn', label: 'FIRE ALL 6 ENGINES', waitMs: 4000 },
      { type: 'clickOnclick', fn: 'escalateToChief', label: 'Escalate to Legal Chief Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      // legal-main-strategist.html's escalate is an <a href> with an onclick
      // handler (writeExecRelay), not a standalone action button — click by id.
      { type: 'click', selector: '#escalate-btn', label: 'Escalate (writes exec relay)', waitMs: 1500 },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'insurance',
    name: 'Insurance',
    warRoom: '/html/war-rooms/insure-war/insurance-war-room.html',
    strategist: '/html/war-rooms/insure-war/insurance-strategist.html',
    exec: '/html/war-rooms/insure-war/insurance-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#fireBtn', label: 'FIRE ALL 6 ENGINES', waitMs: 4000 },
      { type: 'clickOnclick', fn: 'escalateToStrategist', label: 'Escalate to Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      { type: 'click', selector: '#runBtn', label: 'Run Strategist Chain', waitMs: 4000 },
      { type: 'clickOnclick', fn: 'escalateToExec', label: 'Send to Executive Portal', waitMs: 1500 },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'mortgage',
    name: 'Mortgage',
    warRoom: '/html/war-rooms/mortgage/mortgage-war-room.html',
    strategist: '/html/war-rooms/mortgage/mortgage-strategist.html',
    exec: '/html/war-rooms/mortgage/mortgage-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#btnLoadSample', label: 'Load Sample Data', waitMs: 1000 },
      { type: 'click', selector: '#btnRunAnalysis', label: 'Run AI Analysis', waitMs: 4000 },
      { type: 'click', selector: '#btnRelay', label: 'Relay to Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      // Strategist -> Executive is a plain <a href>, no relay-write JS —
      // just navigate, per MASTER_VERTICAL_WALKTHROUGH.md §7.
      { type: 'goto', path: '/html/war-rooms/mortgage/mortgage-executive-portal.html', label: 'Navigate to Executive View' },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'schools',
    name: 'Schools',
    warRoom: '/html/war-rooms/schools-command/schools-command.html',
    strategist: '/html/war-rooms/schools-command/schools-strategist.html',
    exec: '/html/war-rooms/schools-command/schools-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#schBtnRunAnalysis', label: 'Run AI Analysis', waitMs: 4000 },
      { type: 'click', selector: '#tsm-chain-strat', label: 'Go to Strategist', waitMs: 1000 },
    ],
    strategistSteps: [
      { type: 'goto', path: '/html/war-rooms/schools-command/schools-executive-portal.html', label: 'Navigate to Executive View' },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
  {
    key: 'hotelops',
    name: 'HotelOps',
    warRoom: '/html/hotelops/hotelops-war-room.html',
    strategist: '/html/hotelops/hotelops-strategist.html',
    exec: '/html/hotelops/hotelops-executive-portal.html',
    warRoomSteps: [
      { type: 'click', selector: '#btnAnalyze', label: 'Run AI Analysis', waitMs: 4000 },
      { type: 'click', selector: '#btnRelay', label: 'Relay to Strategist', waitMs: 1500 },
    ],
    strategistSteps: [
      { type: 'goto', path: '/html/hotelops/hotelops-executive-portal.html', label: 'Navigate to Executive View' },
    ],
    execSteps: [
      { type: 'click', selector: '#tsmk-delivery-btn', label: 'Export Client Package', waitMs: 2000 },
    ],
  },
];

async function waitEnabled(page, selector, timeoutMs) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return el && !el.disabled;
    },
    { timeout: timeoutMs },
    selector,
  );
}

async function waitForSelector(page, selector, timeoutMs) {
  await page.waitForFunction(
    (sel) => !!document.querySelector(sel),
    { timeout: timeoutMs },
    selector,
  );
}

async function runStep(page, step, log) {
  switch (step.type) {
    case 'goto': {
      await page.goto(`${BASE_URL}${step.path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      log(`  [OK] ${step.label}`);
      return;
    }
    case 'waitEnabled': {
      await waitEnabled(page, step.selector, step.timeoutMs || 10000);
      log(`  [OK] ${step.label}`);
      return;
    }
    case 'waitFor': {
      await waitForSelector(page, step.selector, step.timeoutMs || 10000);
      log(`  [OK] ${step.label}`);
      return;
    }
    case 'click': {
      const exists = await page.$(step.selector);
      if (!exists) throw new Error(`selector not found: ${step.selector}`);
      await page.click(step.selector);
      log(`  [OK] clicked ${step.label} (${step.selector})`);
      if (step.waitMs) await new Promise((r) => setTimeout(r, step.waitMs));
      return;
    }
    case 'type': {
      const exists = await page.$(step.selector);
      if (!exists) throw new Error(`selector not found: ${step.selector}`);
      await page.click(step.selector);
      await page.type(step.selector, step.text, { delay: 0 });
      await page.evaluate((sel) => {
        document.querySelector(sel).dispatchEvent(new Event('input'));
      }, step.selector);
      log(`  [OK] ${step.label}`);
      if (step.waitMs) await new Promise((r) => setTimeout(r, step.waitMs));
      return;
    }
    case 'clickOnclick': {
      const handle = await page.evaluateHandle((fn) => {
        const els = Array.from(document.querySelectorAll(`[onclick*="${fn}("]`));
        return els[0] || null;
      }, step.fn);
      const el = handle.asElement();
      if (!el) throw new Error(`no element with onclick*="${step.fn}("`);
      await el.click();
      log(`  [OK] clicked ${step.label} (onclick*="${step.fn}(")`);
      if (step.waitMs) await new Promise((r) => setTimeout(r, step.waitMs));
      return;
    }
    default:
      throw new Error(`unknown step type: ${step.type}`);
  }
}

async function runVertical(browser, vertical, log) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/cdn-cgi/')) {
      failedRequests.push({ url: r.url(), status: r.status() });
    }
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const result = { key: vertical.key, name: vertical.name, ok: true, error: null, consoleErrors: [], failedRequests: [] };

  try {
    log(`\n=== ${vertical.name} ===`);
    log(` War Room: ${vertical.warRoom}`);
    await page.goto(`${BASE_URL}${vertical.warRoom}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    for (const step of vertical.warRoomSteps) await runStep(page, step, log);

    log(` Strategist: ${vertical.strategist}`);
    // Some war-room escalate actions navigate directly; if we're not already
    // on the strategist page, go there explicitly so the chain is deterministic.
    if (!page.url().includes(vertical.strategist.split('/').pop())) {
      await page.goto(`${BASE_URL}${vertical.strategist}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    for (const step of vertical.strategistSteps) await runStep(page, step, log);

    log(` Executive Portal: ${vertical.exec}`);
    if (!page.url().includes(vertical.exec.split('/').pop())) {
      await page.goto(`${BASE_URL}${vertical.exec}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    }
    for (const step of vertical.execSteps) await runStep(page, step, log);
  } catch (e) {
    result.ok = false;
    result.error = e.message;
    log(`  [FAIL] ${e.message}`);
  } finally {
    result.consoleErrors = consoleErrors;
    result.failedRequests = failedRequests;
    await page.close();
  }

  return result;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}),
  });

  try {
    const loginPage = await browser.newPage();
    if (LOGIN_PASS) {
      await loginPage.goto(`${BASE_URL}/html/login.html`, { waitUntil: 'domcontentloaded' });
      const loginResult = await loginPage.evaluate(async (pw) => {
        const r = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pw }),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, LOGIN_PASS);
      console.log('Login result:', JSON.stringify(loginResult));
      if (loginResult.status !== 200) {
        console.error('LOGIN FAILED — aborting (all subsequent pages would be unauthenticated).');
        process.exitCode = 1;
        return;
      }
    }
    // Cookie set by fetch() inside the page is already in the browser's
    // cookie jar for this domain — new pages/tabs share it automatically.
    await loginPage.close();

    const targets = ONLY ? VERTICALS.filter((v) => v.key === ONLY) : VERTICALS;
    if (targets.length === 0) {
      console.error(`No vertical matches SUITE_ONLY="${ONLY}". Valid keys: ${VERTICALS.map((v) => v.key).join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const results = [];
    for (const vertical of targets) {
      const result = await runVertical(browser, vertical, console.log);
      results.push(result);
    }

    console.log('\n\n=== SUMMARY ===');
    let failCount = 0;
    for (const r of results) {
      const hasIssues = !r.ok || r.consoleErrors.length > 0 || r.failedRequests.length > 0;
      if (hasIssues) failCount++;
      console.log(`[${hasIssues ? 'FAIL' : 'PASS'}] ${r.name}`);
      if (r.error) console.log(`    step error: ${r.error}`);
      r.failedRequests.forEach((f) => console.log(`    [${f.status}] ${f.url}`));
      r.consoleErrors.forEach((e) => console.log(`    console error: ${e}`));
    }
    console.log(`\n${results.length - failCount}/${results.length} verticals completed the full click-through cleanly.`);
    process.exitCode = failCount > 0 ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
