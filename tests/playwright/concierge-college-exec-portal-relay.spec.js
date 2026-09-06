// tests/playwright/concierge-college-exec-portal-relay.spec.js
//
// Regression test for the fix that wires Concierge and College Command
// into html/shared/tsm-exec-portal-upgrade.js's Decision Center panel
// (VERTICAL_MAP / detectVertical / buildKPIs / buildDecisionItems, plus
// the missing <script src="/shared/tsm-exec-portal-upgrade.js"> include
// on both exec portals -- neither page loaded that module before).
//
// Two things this asserts that a plain jsdom check can't:
//   1. Real layout -- the injected panel's bounding box must sit BELOW
//      each page's existing content (Concierge's `.wrap`, College's
//      `#domainSections`), not overlapping it. jsdom has no layout
//      engine, so this is the part that genuinely needed a real browser.
//   2. The real relay data (seeded the same way the live chain writes
//      it) actually reaches the panel's KPI cards and Decision Center,
//      not just that the panel exists.
//
// Also takes a full-page screenshot of each portal into
// tests/playwright/__screenshots__/ for a quick manual look -- the thing
// this whole spec exists to make unnecessary to do by hand every time.
//
// Run: npx playwright test tests/playwright/concierge-college-exec-portal-relay.spec.js
// (needs `npm install` + `npx playwright install chromium`, and the app
// server running at BASE_URL -- `npm start` in another terminal, or let
// playwright.config.js's webServer block start it if configured.)

const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(__dirname, '__screenshots__');

const CASES = [
  {
    name: 'Concierge',
    url: '/html/concierge/concierge-executive-portal.html',
    relayKey: 'TSM_CONCIERGE_RELAY',
    relayPayload: {
      totalMissions: 22,
      open: 3,
      completed: 18,
      exceptions: 1,
      totalSpend: 4120.5,
    },
    // Existing on-page container the panel must render entirely below.
    existingContentSelector: '.wrap',
    expectedKpiText: ['Open Missions', '3', 'Completed', '18', 'Exceptions', '1', 'Total Spend', '$4120.50'],
  },
  {
    name: 'College Command',
    url: '/html/war-rooms/college-command/college-executive-portal.html',
    relayKey: 'TSM_COLLEGE_EXEC_RELAY',
    relayPayload: {
      timestamp: new Date().toISOString(),
      domains: [
        { domain: 'financial_aid', payload: { financials: { total_exposure: 210000 }, kpis: { disbursed_value: 1900000 } } },
        { domain: 'bursar', payload: { financials: { total_exposure: 95000 }, kpis: { amount_due: 400000 } } },
      ],
    },
    existingContentSelector: '#domainSections',
    expectedKpiText: ['Active Domains', '2', 'Combined Exposure', '$305,000', 'Domains Relayed', '2/5'],
  },
];

for (const c of CASES) {
  test.describe(`${c.name} exec portal: Decision Center wiring`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)),
        { key: c.relayKey, payload: c.relayPayload }
      );
      await page.goto(`${BASE_URL}${c.url}`);
    });

    test(`panel renders without overlapping existing content`, async ({ page }) => {
      const panel = page.locator('#tsm-upgrade-panel');
      await expect(panel).toBeVisible();

      const existing = page.locator(c.existingContentSelector);
      await expect(existing).toBeVisible();

      const existingBox = await existing.boundingBox();
      const panelBox = await panel.boundingBox();
      expect(existingBox).not.toBeNull();
      expect(panelBox).not.toBeNull();

      // The real overlap check: the panel must start at or below the
      // bottom edge of the page's existing content, not on top of it.
      expect(panelBox.y).toBeGreaterThanOrEqual(existingBox.y + existingBox.height - 1);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${c.name.toLowerCase().replace(/\s+/g, '-')}-exec-portal.png`),
        fullPage: true,
      });
    });

    test(`KPI cards reflect the real relay payload, not placeholder defaults`, async ({ page }) => {
      const kpiGrid = page.locator('#tsm-upgrade-panel .tsm-kpi-grid');
      await expect(kpiGrid).toBeVisible();
      // .tsm-kpi-label renders text-transform: uppercase via CSS -- innerText()
      // reflects the rendered (uppercased) text, not the original DOM casing,
      // so compare case-insensitively rather than assuming a casing that CSS
      // is going to override anyway.
      const text = (await kpiGrid.innerText()).toUpperCase();
      for (const expected of c.expectedKpiText) {
        expect(text).toContain(expected.toUpperCase());
      }
    });

    test(`Decision Center renders default decision items for this vertical`, async ({ page }) => {
      const items = page.locator('#tsm-upgrade-panel .tsm-decision-item');
      await expect(items).toHaveCount(2);
    });

    test(`no duplicate element IDs after injection`, async ({ page }) => {
      const dupes = await page.evaluate(() => {
        const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
        return ids.filter((id, i) => id && ids.indexOf(id) !== i);
      });
      expect(dupes).toEqual([]);
    });
  });
}