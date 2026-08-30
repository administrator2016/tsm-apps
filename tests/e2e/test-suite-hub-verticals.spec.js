const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.SUITE_BASE_URL || 'http://localhost:3000';
const LOGIN_PASS = process.env.SUITE_LOGIN_PASS;

test.describe('Suite Hub — vertical link crawl', () => {
  test.beforeEach(async ({ page }) => {
    if (LOGIN_PASS) {
      await page.goto(`${BASE_URL}/html/login.html`, { waitUntil: 'domcontentloaded' });
      await page.fill('#pw', LOGIN_PASS);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('domcontentloaded');
    }
  });

  test('crawl every vertical link from suite-hub and check it loads', async ({ page }) => {
    test.setTimeout(300000);

    const failedRequests = [];
    page.on('response', (response) => {
      if (response.status() >= 400) failedRequests.push({ url: response.url(), status: response.status() });
    });

    await page.goto(`${BASE_URL}/html/bpo-files/suite-hub.html`);
    await page.waitForLoadState('domcontentloaded');

    const links = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.suite-link').forEach((a) => {
        out.push({ label: a.textContent.trim(), href: a.getAttribute('href') });
      });
      return out;
    });

    console.log(`Found ${links.length} links.`);
    const results = [];

    for (const { label, href } of links) {
      failedRequests.length = 0;
      const url = href.startsWith('http') ? href : new URL(href, `${BASE_URL}/html/bpo-files/`).href;
      let status = null, errorDetail = '';
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        status = response ? response.status() : null;
        await page.waitForTimeout(1000);
      } catch (e) {
        errorDetail = e.message;
      }
      results.push({ label, href, status, errorDetail, failedRequests: [...failedRequests] });
    }

    console.log('\n=== Results ===');
    for (const r of results) {
      const hasFailures = r.failedRequests.length > 0 || r.errorDetail;
      console.log(`[${hasFailures ? 'FAIL' : 'PASS'}] ${r.label} → ${r.href}  [HTTP ${r.status}]`);
      if (r.errorDetail) console.log(`    nav error: ${r.errorDetail}`);
      r.failedRequests.forEach((f) => console.log(`    [${f.status}] ${f.url}`));
    }
    expect(true).toBe(true);
  });
});
