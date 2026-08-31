// tests/e2e/demo/l1-platform-demo.spec.js
//
// Screenshot-driven walkthrough of the L1 Ticket Copilot demo narrative,
// covering the three real standalone pages in html/l1-copilot/:
// Enterprise Command Center, L1 Ticket Copilot, and VMware Copilot.
// Written as a direct Playwright spec rather than a demo-engine.js JSON
// story because the Ticket Copilot -> VMware Copilot hop opens a NEW TAB
// (window.open from #btnOpenVmwModule) — demo-engine's runStory() drives
// a single `page` and has no concept of following a popup, so that
// transition needs real code.
//
// NOTE: topology.html is intentionally NOT a stop here. It's not a real
// standalone page — it's a source snippet (<section> + <style> + <script>)
// meant to be pasted into another page's layout, and it's already
// embedded in enterprise-command-center.html (see the "twin-panels"
// section, id="vmware-panel"). The file returns HTTP 200 but has no
// <html>/<body> wrapper of its own, so navigating to it directly doesn't
// represent a real product surface. Left out of the demo by design.
//
// Output: numbered PNGs in screenshots/l1-platform/, same convention as
// the other verticals (001-, 002-, ...). Once captured, stitch them with
// the existing helper:
//
//   npx playwright test tests/e2e/demo/l1-platform-demo.spec.js
//   bash tests/e2e/demo/build-video.sh l1-platform
//
// build-video.sh doesn't care how the PNGs were produced (it just globs
// screenshots/<vertical>/*.png), so this works with the shared tool
// unmodified and writes tests/e2e/demo/screenshots/l1-platform-demo.mp4 +
// .gif, exactly like the other verticals.

const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TSM_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const VIEWPORT = { width: 1920, height: 1080 };

test('L1 Ticket Copilot platform demo', async ({ page, context }) => {
  test.setTimeout(120_000);

  const outDir = path.join(__dirname, 'screenshots', 'l1-platform');
  fs.mkdirSync(outDir, { recursive: true });

  const shot = async (name, target = page) => {
    const file = path.join(outDir, `${name}.png`);
    await target.screenshot({ path: file });
    console.log(`[l1-platform-demo] captured ${file}`);
  };

  await page.setViewportSize(VIEWPORT);

  // ── Stop 1 — Enterprise Command Center ──────────────────────────────
  await page.goto(`${BASE_URL}/html/l1-copilot/enterprise-command-center.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#l1a-fab');
  await shot('001-command-center-load');

  await page.click('#l1a-fab');
  await page.waitForSelector('#l1a-panel.l1a-open');
  await page.waitForTimeout(300);
  await shot('002-command-center-assistant-open');
  await page.click('#l1a-close');

  // ── Stop 2 — L1 Ticket Copilot ───────────────────────────────────────
  await page.goto(`${BASE_URL}/html/l1-copilot/l1-ticket-copilot.html`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('#tkIncident');
  await shot('003-ticket-copilot-load');

  await page.fill('#tkIncident', 'INC0099887');
  await shot('004-ticket-copilot-incident-entered');

  await page.click('[data-section="vmware"]');
  await page.waitForSelector('#vmwComponent');
  await shot('005-ticket-copilot-vmware-sme-section');

  await page.selectOption('#vmwComponent', 'NSX');
  await page.selectOption('#vmwCategory', 'NSX Edge Deployment');
  await page.selectOption('#vmwEnv', 'Non-Production / Test');
  await shot('006-ticket-copilot-vmware-fields-set');

  // "OPEN FULL VMWARE OPERATIONS MODULE ->" relays context via
  // TSM_VMWARE_COPILOT_RELAY (localStorage/sessionStorage) and opens the
  // target page in a new tab.
  const [vmwarePage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('#btnOpenVmwModule'),
  ]);
  await vmwarePage.setViewportSize(VIEWPORT);
  await vmwarePage.waitForLoadState('domcontentloaded');

  // ── Stop 3 — VMware Copilot ──────────────────────────────────────────
  await vmwarePage.waitForSelector('#ctxBanner.show', { timeout: 10_000 }).catch(() => {
    console.warn('[l1-platform-demo] #ctxBanner never got the "show" class — capturing anyway');
  });
  await shot('007-vmware-copilot-context-banner', vmwarePage);

  // Open the assistant widget on the VMware Copilot page too, for parity
  // with the other two stops.
  await vmwarePage.click('#l1a-fab');
  await vmwarePage.waitForSelector('#l1a-panel.l1a-open');
  await vmwarePage.waitForTimeout(300);
  await shot('008-vmware-copilot-assistant-open', vmwarePage);
});
