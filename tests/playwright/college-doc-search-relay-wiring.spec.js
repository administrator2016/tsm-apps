// tests/playwright/college-doc-search-relay-wiring.spec.js
//
// Regression test for the fix that wires TSM_COLLEGE_WAR_RELAY (written by
// tsm-doc-search-multi.html before opening any College page) into the 5
// College Command pages and college-strategist.html via the new shared
// html/war-rooms/college-command/shared/college-relay-loader.js.
//
// Before this fix: tsm-doc-search-multi.html correctly routed to the right
// College page and wrote TSM_COLLEGE_WAR_RELAY, but nothing on any College
// page ever read that key back -- the page opened correctly but empty, and
// the classified document's fields silently disappeared (documented as a
// known gap in html/document-processing-revenue-recovery-manual.html).
//
// Note: unlike Construction's docPaste textarea, College Command pages are
// model/JSON-driven dashboards with no free-text intake field to bind a
// classified document into. So the fix surfaces the relay as a visible,
// dismissible banner rather than attempting to auto-fill a table row --
// this test asserts the banner appears with the real relay fields, and
// that dismissing it clears the relay key.
//
// Run: npx playwright test tests/playwright/college-doc-search-relay-wiring.spec.js
// (needs `npm install` + `npx playwright install chromium`, and the app
// server running at BASE_URL -- `npm start` in another terminal, or let
// playwright.config.js's webServer block start it if configured.)

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const RELAY_KEY = 'TSM_COLLEGE_WAR_RELAY';

const RELAY_PAYLOAD = {
  docText: 'FILE: title-iv-r2t4-notice.pdf\nTYPE: R2T4 Notice\nCLIENT: Example State University\nREF: R2T4-88213\nEXPOSURE: $18,400\nStudent withdrew 2026-08-01, funds return due within 45 days.',
  docType: 'R2T4 Notice',
  fileName: 'title-iv-r2t4-notice.pdf',
  client: 'Example State University',
  ref: 'R2T4-88213',
  source: 'doc-search',
  timestamp: Date.now(),
};

const PAGES = [
  { name: 'Financial Aid', url: '/html/war-rooms/college-command/college-finaid-command.html' },
  { name: 'Bursar', url: '/html/war-rooms/college-command/college-bursar-command.html' },
  { name: 'Endowment', url: '/html/war-rooms/college-command/college-endowment-command.html' },
  { name: 'Research/F&A', url: '/html/war-rooms/college-command/college-research-fa-command.html' },
  { name: 'Accreditation', url: '/html/war-rooms/college-command/college-accred-command.html' },
  { name: 'Strategist', url: '/html/war-rooms/college-command/college-strategist.html' },
];

for (const p of PAGES) {
  test.describe(`College ${p.name}: doc-search relay banner`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ({ key, payload }) => localStorage.setItem(key, JSON.stringify(payload)),
        { key: RELAY_KEY, payload: RELAY_PAYLOAD }
      );
      await page.goto(`${BASE_URL}${p.url}`);
    });

    test('banner renders with the real relayed document fields', async ({ page }) => {
      const banner = page.locator('#tsm-college-relay-banner');
      await expect(banner).toBeVisible();
      const text = await banner.innerText();
      expect(text).toContain(RELAY_PAYLOAD.docType);
      expect(text).toContain(RELAY_PAYLOAD.fileName);
      expect(text).toContain(RELAY_PAYLOAD.client);
      expect(text).toContain(RELAY_PAYLOAD.ref);
    });

    test('relay key survives page load (not cleared on read, per College\'s multi-destination architecture)', async ({ page }) => {
      await expect(page.locator('#tsm-college-relay-banner')).toBeVisible();
      const stillThere = await page.evaluate(
        (key) => !!(sessionStorage.getItem(key) || localStorage.getItem(key)),
        RELAY_KEY
      );
      expect(stillThere).toBe(true);
    });

    test('dismiss button clears the banner and the relay key', async ({ page }) => {
      const banner = page.locator('#tsm-college-relay-banner');
      await expect(banner).toBeVisible();
      await page.locator('#tsm-college-relay-dismiss').click();
      await expect(banner).toHaveCount(0);
      const cleared = await page.evaluate(
        (key) => !sessionStorage.getItem(key) && !localStorage.getItem(key),
        RELAY_KEY
      );
      expect(cleared).toBe(true);
    });

    test('no page renders the banner when no relay is present', async ({ page, context }) => {
      await context.clearCookies();
      const freshPage = await context.newPage();
      await freshPage.goto(`${BASE_URL}${p.url}`);
      await expect(freshPage.locator('#tsm-college-relay-banner')).toHaveCount(0);
      await freshPage.close();
    });
  });
}
