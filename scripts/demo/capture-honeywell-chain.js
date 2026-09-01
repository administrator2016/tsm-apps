/**
 * capture-honeywell-chain.js
 *
 * Runs the Honeywell CYBER scenario through the REAL 6-engine Groq analysis,
 * escalates it, and captures populated Strategist + Executive Portal
 * screenshots — the "truth" shots the pitch deck's slide 12 needs.
 *
 * Requires (this machine, not the sandbox):
 *   - GROQ_API_KEY set in .env (server reads it in server.js /api/war-room/stream)
 *   - Network access to api.groq.com
 *   - TSM_ADMIN_PASSWORD and TSM_SESSION_SECRET set in .env — the war-room
 *     engine endpoint is gated behind requireAnyAuth, so this script logs in
 *     first via /api/auth/login before touching the incident page.
 *
 * Usage:
 *   node server.js &                # start the app (port 3000 by default)
 *   TSM_LOGIN_PASSWORD=<your TSM_ADMIN_PASSWORD value> \
 *     node scripts/demo/capture-honeywell-chain.js
 *
 * Output:
 *   stills/honeywell-client-specific-chain/honeywell-strategist-full.png
 *   stills/honeywell-client-specific-chain/honeywell-executive-portal-full.png
 *   (overwrites the existing empty-state PNGs)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.CAPTURE_BASE_URL || 'http://localhost:3000';
const OUT_DIR = path.join(__dirname, '..', '..', 'stills', 'honeywell-client-specific-chain');
const VIEWPORT = { width: 1600, height: 1000 };
const ENGINE_TIMEOUT_MS = 180_000; // 6 engines, sequential, can be slow on retries

async function waitForNoEmptyState(page, emptyStateText, timeout = 15_000) {
  await page.waitForFunction(
    (needle) => !(document.body.innerText || '').includes(needle),
    emptyStateText,
    { timeout }
  );
}

async function waitForEnginesComplete(page) {
  await page.waitForFunction(
    () => {
      const badge = document.getElementById('incBadge');
      return badge && (badge.textContent.includes('COMPLETE') || badge.textContent.includes('ERRORS'));
    },
    null,
    { timeout: ENGINE_TIMEOUT_MS }
  );
  const badgeText = await page.locator('#incBadge').textContent();
  if (badgeText.includes('ERRORS')) {
    throw new Error(
      `Engines finished with errors (badge: "${badgeText.trim()}"). ` +
      `Check GROQ_API_KEY / server logs before using these screenshots.`
    );
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const loginPassword = process.env.TSM_LOGIN_PASSWORD;
  if (!loginPassword) {
    throw new Error(
      'TSM_LOGIN_PASSWORD env var not set. Pass the value of your TSM_ADMIN_PASSWORD ' +
      '(or a valid staff/client access code) so this script can authenticate: ' +
      'the engine endpoint is gated behind requireAnyAuth.'
    );
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });

  console.log('→ Logging in…');
  const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { password: loginPassword },
  });
  if (!loginRes.ok()) {
    const body = await loginRes.text();
    throw new Error(`Login failed (${loginRes.status()}): ${body}`);
  }
  console.log('✓ Logged in.');

  console.log('→ Loading cyber-incident war room…');
  await page.goto(`${BASE_URL}/html/cyber-incident.html`, { waitUntil: 'load' });

  console.log('→ Loading sample incident doc…');
  await page.click('#sampleBtn');
  await page.waitForFunction(() => document.getElementById('docInput').value.trim().length > 0, null, { timeout: 10_000 });

  console.log('→ Firing all 6 engines (real Groq calls, this takes a bit)…');
  await page.click('#fireBtn');
  await waitForEnginesComplete(page);
  console.log('✓ 6-engine analysis complete.');

  // DIAGNOSTIC: dump the raw Engine 04 (Financial Exposure) response and
  // what the extractor actually parsed out of it, since the $150 bug has
  // survived two token-budget fixes and we need to see the real text,
  // not guess from a screenshot that might just be CSS-clipping a card.
  const diag = await page.evaluate(() => ({
    engine4RawText: (typeof sessionData !== 'undefined' && sessionData.outputs?.[3]?.text) || '(missing)',
    engine4Kpi: (typeof sessionData !== 'undefined' && sessionData.kpis?.exposure) || '(missing)',
    engine6RawText: (typeof sessionData !== 'undefined' && sessionData.outputs?.[5]?.text) || '(missing)',
    engine6Kpi: (typeof sessionData !== 'undefined' && sessionData.kpis?.risk) || '(missing)',
  }));
  console.log('\n=== DIAGNOSTIC: Engine 04 (Financial Exposure) ===');
  console.log('--- raw text (last 400 chars) ---');
  console.log(diag.engine4RawText.slice(-400));
  console.log('--- extracted kpis.exposure ---');
  console.log(JSON.stringify(diag.engine4Kpi));
  console.log('\n=== DIAGNOSTIC: Engine 06 (Exec Dispatch) ===');
  console.log('--- raw text (last 400 chars) ---');
  console.log(diag.engine6RawText.slice(-400));
  console.log('--- extracted kpis.risk ---');
  console.log(JSON.stringify(diag.engine6Kpi));
  console.log('=== END DIAGNOSTIC ===\n');

  console.log('→ Escalating to Strategist…');
  await page.click('#escalateBtn');
  await page.waitForURL(/honeywell-strategist\.html/, { timeout: 15_000 });
  await page.waitForLoadState('load');

  // Give the strategist page's render() a moment to paint the relay data
  // (it reads localStorage/sessionStorage on load, no network wait needed,
  // but keep a short buffer for any animation/transition).
  await page.waitForTimeout(1000);
  await waitForNoEmptyState(page, 'NO ANALYSIS RECEIVED');

  const strategistPath = path.join(OUT_DIR, 'honeywell-strategist-full.png');
  await page.screenshot({ path: strategistPath, fullPage: true });
  console.log(`✓ Saved ${strategistPath}`);

  // Strategist -> Executive is a SEPARATE escalation step on this page
  // (writes TSM_HONEYWELL_EXEC_RELAY, distinct from the war-room's
  // TSM_HONEYWELL_*_RELAY keys read on load) -- navigating to the
  // Executive Portal without clicking this leaves it in the empty state.
  console.log('→ Escalating Strategist analysis to Executive…');
  await page.click('button:has-text("ESCALATE TO EXECUTIVE")');
  await page.waitForFunction(
    () => !!(localStorage.getItem('TSM_HONEYWELL_EXEC_RELAY') || sessionStorage.getItem('TSM_HONEYWELL_EXEC_RELAY')),
    null,
    { timeout: 10_000 }
  );
  console.log('✓ Escalated to Executive.');

  console.log('→ Navigating to Executive Portal…');
  await page.goto(`${BASE_URL}/html/war-rooms/honeywell-executive-portal.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  await waitForNoEmptyState(page, 'NO ESCALATION RECEIVED');

  const execPath = path.join(OUT_DIR, 'honeywell-executive-portal-full.png');
  await page.screenshot({ path: execPath, fullPage: true });
  console.log(`✓ Saved ${execPath}`);

  await browser.close();
  console.log('\nDone. Send both PNGs back for slide 12.');
}

main().catch((err) => {
  console.error('\n✗ Capture failed:', err.message);
  process.exit(1);
});
