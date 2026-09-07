/**
 * Full-suite Playwright audit for TSM-Consultz
 *
 * Covers:
 *  - war-room-prep.html + honeywell-executive-portal / honeywell-strategist / index / tsm-wip-command-center
 *  - The 3 honeywell incident popups launched from war-room-prep.html (cyber, plant, supplier-shutdown)
 *  - The 10 /html/war-rooms/ demo suites (approval, bpo, catalog, cpq, crm, digital-twin,
 *    governance, integration-hub, mdm, o2c) — 3 pages each (war-room / strategist / executive-portal,
 *    or the single-file variant for digital-twin / integration-hub)
 *  - The music-command suite (19 pages)
 *
 * For each page:
 *   - Captures all console messages (flags errors/warnings)
 *   - Captures uncaught page errors
 *   - Captures failed network requests (404s, CORS, connection resets)
 *   - Takes a full-page screenshot
 *   - Attempts to click a bounded set of visible buttons / links / [onclick] elements
 *     (skips external links, mailto:, tel:, and anything matching a skip-list)
 *   - Handles popup windows (e.g. window.open(...) triggered by war-room-prep.html)
 *
 * Usage:
 *   npm install -D playwright   (if not already a dependency)
 *   node audit-suites.js [baseUrl]
 *
 * Default baseUrl: http://localhost:8080
 *
 * Output:
 *   ./audit-output/report.json       - full structured results
 *   ./audit-output/report.md         - human-readable summary
 *   ./audit-output/screenshots/*.png - one screenshot per page (and per popup)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:8080';
const OUT_DIR = path.join(__dirname, 'audit-output');
const SHOT_DIR = path.join(OUT_DIR, 'screenshots');

// Max number of clickable elements to try per page (keeps runtime bounded on
// pages with hundreds of buttons)
const MAX_CLICKS_PER_PAGE = 8;

// Skip clicking anything whose text/href/onclick matches these patterns
const CLICK_SKIP_PATTERNS = [
  /^https?:\/\//i,      // absolute external-looking links (still allow same-origin absolute, filtered below)
  /^mailto:/i,
  /^tel:/i,
  /logout/i,
  /delete/i,
  /reset\s*all/i,
  /clear\s*data/i,
];

const PAGES = [];

function addPage(section, urlPath) {
  PAGES.push({ section, urlPath });
}

// ---- war-room-prep + related ----
addPage('war-room-prep', '/html/war-rooms/war-room-prep.html');
addPage('war-room-prep', '/html/war-rooms/honeywell-executive-portal.html');
addPage('war-room-prep', '/html/war-rooms/honeywell-strategist.html');
addPage('war-room-prep', '/html/war-rooms/index.html');
addPage('war-room-prep', '/html/war-rooms/tsm-wip-command-center.html');

// ---- honeywell incident popups (also reachable directly) ----
addPage('honeywell-incidents', '/html/cyber-incident.html');
addPage('honeywell-incidents', '/html/plant-incident.html');
addPage('honeywell-incidents', '/html/supplier-shutdown.html');

// ---- 10 war-room demo suites ----
const STANDARD_SUITES = ['approval', 'bpo', 'catalog', 'cpq', 'crm', 'governance', 'mdm', 'o2c'];
for (const suite of STANDARD_SUITES) {
  addPage(`suite:${suite}`, `/html/war-rooms/${suite}/${suite}-war-room.html`);
  addPage(`suite:${suite}`, `/html/war-rooms/${suite}/${suite}-strategist.html`);
  addPage(`suite:${suite}`, `/html/war-rooms/${suite}/${suite}-executive-portal.html`);
}
// single-file-variant suites
addPage('suite:digital-twin', '/html/war-rooms/digital-twin/digital-twin.html');
addPage('suite:digital-twin', '/html/war-rooms/digital-twin/digital-twin-strategist.html');
addPage('suite:digital-twin', '/html/war-rooms/digital-twin/digital-twin-executive-portal.html');
addPage('suite:integration-hub', '/html/war-rooms/integration-hub/integration-hub.html');
addPage('suite:integration-hub', '/html/war-rooms/integration-hub/integration-hub-strategist.html');
addPage('suite:integration-hub', '/html/war-rooms/integration-hub/integration-hub-executive-portal.html');

// ---- music-command suite ----
const MUSIC_PAGES = [
  'how-to-guide.html',
  'producer-intel-panel.html',
  'app.html',
  'cadence-builder.html',
  'release/release-center.html',
  'release/marketing.html',
  'academy/music-theory.html',
  'academy/music-business.html',
  'academy/daw-academy.html',
  'playback-banger.html',
  'presentation-live.html',
  'index.html',
  'creation/song-builder.html',
  'creation/beat-workbench.html',
  'producer/recording-coach.html',
  'producer/mixing-coach.html',
  'producer/producer-ai.html',
  'producer/mastering-coach.html',
  'demo-conductor.html',
];
for (const p of MUSIC_PAGES) {
  addPage('music-command', `/html/war-rooms/music-war/${p}`);
}

function safeName(urlPath) {
  return urlPath.replace(/^\/+/, '').replace(/[\/.]/g, '_');
}

function shouldSkipClick(el) {
  const text = (el.text || '').trim();
  const href = el.href || '';
  const onclick = el.onclick || '';
  const combined = `${text} ${href} ${onclick}`;
  return CLICK_SKIP_PATTERNS.some((re) => re.test(combined));
}

async function auditPage(browser, { section, urlPath }) {
  const url = BASE_URL + urlPath;
  const context = await browser.newContext();
  const page = await context.newPage();

  const result = {
    section,
    urlPath,
    url,
    status: null,
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    clicked: [],
    popups: [],
    screenshot: null,
    loadTimeMs: null,
    ok: true,
  };

  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') result.consoleErrors.push(msg.text());
    else if (type === 'warning') result.consoleWarnings.push(msg.text());
  });

  page.on('pageerror', (err) => {
    result.pageErrors.push(String(err && err.message ? err.message : err));
  });

  page.on('requestfailed', (req) => {
    result.failedRequests.push({
      url: req.url(),
      method: req.method(),
      failure: req.failure() ? req.failure().errorText : 'unknown',
    });
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      result.failedRequests.push({
        url: res.url(),
        method: res.request().method(),
        failure: `HTTP ${res.status()}`,
      });
    }
  });

  // Capture popups (e.g. window.open from war-room-prep.html incident buttons)
  context.on('page', async (popup) => {
    try {
      await popup.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
      const popupUrl = popup.url();
      const shotName = `popup__${safeName(urlPath)}__${safeName(popupUrl.replace(BASE_URL, ''))}.png`;
      await popup.screenshot({ path: path.join(SHOT_DIR, shotName), fullPage: true }).catch(() => {});
      result.popups.push({ url: popupUrl, screenshot: shotName });
    } catch (e) {
      result.popups.push({ url: 'unknown', error: String(e) });
    }
  });

  const startTime = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    result.status = resp ? resp.status() : null;
    result.loadTimeMs = Date.now() - startTime;

    if (!resp || resp.status() >= 400) {
      result.ok = false;
    }

    // Give any deferred scripts/animations a moment to settle
    await page.waitForTimeout(500);

    // Full-page screenshot
    const shotName = `${safeName(urlPath)}.png`;
    await page.screenshot({ path: path.join(SHOT_DIR, shotName), fullPage: true }).catch(() => {});
    result.screenshot = shotName;

    // Gather candidate clickable elements
    const candidates = await page.$$eval(
      'button, a[href], [onclick]',
      (els) =>
        els.slice(0, 60).map((el, idx) => ({
          idx,
          tag: el.tagName,
          text: (el.textContent || '').trim().slice(0, 60),
          href: el.getAttribute('href') || '',
          onclick: el.getAttribute('onclick') || '',
        }))
    );

    let clickCount = 0;
    for (const el of candidates) {
      if (clickCount >= MAX_CLICKS_PER_PAGE) break;
      if (shouldSkipClick(el)) continue;
      // skip same-page anchors with no real handler and no href
      if (!el.href && !el.onclick && el.tag !== 'BUTTON') continue;

      try {
        const selector = `${el.tag.toLowerCase()}:nth-of-type(${el.idx + 1})`;
        // Prefer text-based locator to reduce mismatch risk
        const locator = el.text
          ? page.locator(`${el.tag.toLowerCase()}:has-text("${el.text.replace(/"/g, '')}")`).first()
          : page.locator(el.tag.toLowerCase()).nth(el.idx);

        const visible = await locator.isVisible().catch(() => false);
        if (!visible) continue;

        await locator.click({ timeout: 3000, trial: false }).catch((e) => {
          throw e;
        });
        await page.waitForTimeout(300);
        result.clicked.push({ text: el.text, ok: true });
        clickCount++;
      } catch (e) {
        result.clicked.push({ text: el.text, ok: false, error: String(e.message || e).slice(0, 200) });
      }
    }
  } catch (e) {
    result.ok = false;
    result.pageErrors.push(`NAVIGATION FAILED: ${String(e.message || e)}`);
  }

  if (result.consoleErrors.length || result.pageErrors.length || result.failedRequests.length) {
    result.ok = false;
  }

  await context.close();
  return result;
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  console.log(`Auditing ${PAGES.length} pages against ${BASE_URL} ...\n`);

  for (const p of PAGES) {
    process.stdout.write(`  [${p.section}] ${p.urlPath} ... `);
    const r = await auditPage(browser, p);
    results.push(r);
    console.log(r.ok ? 'OK' : 'ISSUES FOUND');
  }

  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));

  // Build markdown summary
  const lines = [];
  lines.push('# Audit Report');
  lines.push('');
  lines.push(`Base URL: ${BASE_URL}`);
  lines.push(`Pages audited: ${results.length}`);
  const failing = results.filter((r) => !r.ok);
  lines.push(`Pages with issues: ${failing.length}`);
  lines.push('');

  const bySection = {};
  for (const r of results) {
    bySection[r.section] = bySection[r.section] || [];
    bySection[r.section].push(r);
  }

  for (const [section, pages] of Object.entries(bySection)) {
    lines.push(`## ${section}`);
    lines.push('');
    for (const r of pages) {
      lines.push(`### ${r.urlPath}`);
      lines.push(`- Status: ${r.status ?? 'N/A'} | Load time: ${r.loadTimeMs ?? 'N/A'}ms | ${r.ok ? '✅ OK' : '❌ ISSUES'}`);
      if (r.consoleErrors.length) {
        lines.push(`- Console errors (${r.consoleErrors.length}):`);
        r.consoleErrors.forEach((e) => lines.push(`  - ${e}`));
      }
      if (r.pageErrors.length) {
        lines.push(`- Page errors (${r.pageErrors.length}):`);
        r.pageErrors.forEach((e) => lines.push(`  - ${e}`));
      }
      if (r.failedRequests.length) {
        lines.push(`- Failed requests (${r.failedRequests.length}):`);
        r.failedRequests.forEach((f) => lines.push(`  - [${f.failure}] ${f.method} ${f.url}`));
      }
      if (r.popups.length) {
        lines.push(`- Popups opened (${r.popups.length}):`);
        r.popups.forEach((p) => lines.push(`  - ${p.url} (screenshot: ${p.screenshot || 'n/a'})`));
      }
      const failedClicks = r.clicked.filter((c) => !c.ok);
      if (failedClicks.length) {
        lines.push(`- Failed click attempts (${failedClicks.length}):`);
        failedClicks.forEach((c) => lines.push(`  - "${c.text}": ${c.error}`));
      }
      lines.push(`- Screenshot: screenshots/${r.screenshot || 'n/a'}`);
      lines.push('');
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'report.md'), lines.join('\n'));

  console.log(`\nDone. ${failing.length}/${results.length} pages had issues.`);
  console.log(`See ${path.join(OUT_DIR, 'report.md')} for the full summary.`);
  console.log(`Raw data: ${path.join(OUT_DIR, 'report.json')}`);
  console.log(`Screenshots: ${SHOT_DIR}`);
}

main().catch((e) => {
  console.error('Fatal error running audit:', e);
  process.exit(1);
});