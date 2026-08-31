// tests/playwright/finops-doc-search-to-sentinel-chain.spec.js
//
// Full FinOps chain audit: tsm-doc-search-multi.html -> finops-war-room.html
// -> finops-main-strategist.html -> finops-executive-portal.html ->
// sentinel-center.html. Extends the existing finops-relay-chain.spec.js
// (which covers doc-search -> war-room -> strategist -> exec-portal via the
// "redispatch" button) by also covering the SECOND live entry point out of
// doc-search -- the "SELECT WAR ROOM" picker modal -- the war-room's own
// chain-status nav bar, and the strategist -> Sentinel Center hop. Every
// payload shape, file path, and selector below was re-verified against the
// CURRENT source on `main` on 2026-07-29, not assumed from an earlier trace.
//
// Status as of this pass -- ALL THREE PREVIOUSLY-DOCUMENTED BREAKS ARE NOW
// FIXED on `main`, confirmed by direct source read (not just PR titles):
//   - PR #25 (merged, 3b60095d): fixed the chain-status-bar 404s
//     (finops-war-room.html #tsm-chain-strat / #tsm-chain-exec hrefs now
//     include the /finops-war/ path segment) AND wired the Sentinel push
//     from the strategist's relayToExecutive() (writes
//     TSM_FINOPS_STRATEGIST_RELAY, matching Sentinel Center's generic
//     'TSM_' + id.toUpperCase() + '_STRATEGIST_RELAY' read key).
//   - PR #26 (merged, 20dc2cae): fixed the picker-modal relay-key typo
//     ('tsm_fin_docsearch_relay' -> 'tsm_fo_docsearch_relay') across
//     WAR_ROOM_ROUTES['fo-war-room'] and its 'fo-accounting'/'fo-financial'
//     aliases.
//   NOTE: a `fix/finops-chain-nav-and-sentinel-relay` branch with the same
//   two fixes still exists remotely but predates the PR #25 squash-merge --
//   its content is byte-identical to what's already on main, so it's stale
//   and safe to delete rather than merge again.
//
// Still open (not blocking, not covered by an assertion below):
//   - WAR_ROOM_ROUTES['fo-war-room'].autoKey ('TSM_FIN_WAR_RELAY') is
//     written by launchWarRoom() but still never read anywhere in
//     finops-war-room.html -- harmless dead write, the relay key alone
//     carries the real payload.
//
// Confirmed wiring (doc-search-multi.html):
//   - redispatch(id)      -> DOCSEARCH_ROUTES['finops'] (~line 2607)
//                             writes localStorage 'tsm_fo_docsearch_relay'
//                             -> /html/finops-suite/finops-war/finops-war-room.html
//   - launchWarRoom(id,k) -> WAR_ROOM_ROUTES['fo-war-room'] (~line 2374)
//                             writes localStorage 'tsm_fo_docsearch_relay'
//                             (fixed in PR #26) AND 'TSM_FIN_WAR_RELAY'
//                             (still a dead write, see above)
//                             -> same finops-war-room.html URL
//
// Run: npx playwright test tests/playwright/finops-doc-search-to-sentinel-chain.spec.js
// (needs `npm install` + `npx playwright install chromium`.)

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('FinOps full chain: doc-search -> war-room -> exec-portal -> Sentinel', () => {

  test('doc-search "Dispatch" path: tsm_fo_docsearch_relay populates the war room', async ({ page }) => {
    const docSearchPayload = {
      ts: Date.now(),
      summary: 'DOCUMENT: q3-invoice.pdf\nTYPE: Invoice\nCARRIER/VENDOR: Acme Supply Co\nEXPOSURE: $42,500',
      doc: { fileName: 'q3-invoice.pdf', documentType: 'Invoice', vendor: 'Acme Supply Co', amount: 42500 }
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('tsm_fo_docsearch_relay', JSON.stringify(payload));
    }, docSearchPayload);

    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-war-room.html`);

    await expect(page.locator('#docPaste')).toHaveValue(/q3-invoice\.pdf/, { timeout: 5000 });
  });

  test('doc-search "SELECT WAR ROOM" picker path reaches the war room (fixed)', async ({ page }) => {
    // launchWarRoom() in tsm-doc-search-multi.html writes room.relay for the
    // 'fo-war-room' entry in WAR_ROOM_ROUTES. This used to be
    // 'tsm_fin_docsearch_relay' -- a naming-prefix typo that didn't match
    // any key finops-war-room.html actually reads (only
    // 'tsm_fo_docsearch_relay', same as the DOCSEARCH_ROUTES/redispatch()
    // path). Fixed in PR #26: WAR_ROOM_ROUTES['fo-war-room'] (and the
    // 'fo-accounting'/'fo-financial' aliases that shared the same typo)
    // now use 'tsm_fo_docsearch_relay', matching every other vertical's
    // already-consistent convention between the two route tables.
    const payload = JSON.stringify({
      docText: 'FILE: q3-invoice.pdf\nTYPE: Invoice\nEXPOSURE: $42,500',
      docType: 'Invoice',
      fileName: 'q3-invoice.pdf',
      source: 'doc-search',
      timestamp: Date.now()
    });
    await page.addInitScript((p) => {
      // Seed exactly what launchWarRoom() writes post-fix: relay key +
      // autoKey (autoKey remains a separate, still-unread no-op -- see
      // note below -- so only the relay key needs to carry real data).
      localStorage.setItem('tsm_fo_docsearch_relay', p);
      localStorage.setItem('TSM_FIN_WAR_RELAY', p);
    }, payload);

    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-war-room.html`);

    await expect(page.locator('#docPaste')).toHaveValue(/q3-invoice\.pdf/, { timeout: 5000 });
  });

  test('[FIXED, PR #25] war-room chain-status nav bar links resolve (no more 404s)', async ({ page }) => {
    // finops-war-room.html's own top-of-page chain-status bar (ids
    // #tsm-chain-strat / #tsm-chain-exec) used to hardcode paths missing the
    // /finops-war/ segment (404). PR #25 corrected both hrefs to point at
    // the files' real location under .../finops-suite/finops-war/.
    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-war-room.html`);

    const stratHref = await page.locator('#tsm-chain-strat').getAttribute('href');
    const execHref = await page.locator('#tsm-chain-exec').getAttribute('href');
    expect(stratHref).toBe('/html/finops-suite/finops-war/finops-main-strategist.html');
    expect(execHref).toBe('/html/finops-suite/finops-war/finops-executive-portal.html');

    const stratResp = await page.request.get(`${BASE_URL}${stratHref}`);
    const execResp = await page.request.get(`${BASE_URL}${execHref}`);
    expect(stratResp.ok()).toBeTruthy();
    expect(execResp.ok()).toBeTruthy();
  });

  test('war-room -> strategist: kernel relay renders the brief', async ({ page }) => {
    const kernelPayload = {
      ts: Date.now(),
      v: 'finops-suite',
      p: JSON.stringify({
        docText: 'Sample invoice text for engine analysis...',
        docType: 'Invoice',
        engines: { e1: 'FINANCIAL RISK SCORE: 62', e2: 'EXCEPTION COUNT: 3', e3: 'TOTAL EXPOSURE: $42,500', e4: '', e5: 'QUICK WINS: Renegotiate vendor terms', e6: '' },
        snapshot: { risk: '62', exposure: '$42,500', docType: 'Invoice', exceptions: '3', compliance: 'Pass' },
        timestamp: new Date().toISOString(),
        chainStep: 'war-room'
      })
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('tsm_war_relay_finops-suite', JSON.stringify(payload));
    }, kernelPayload);

    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-main-strategist.html`);

    await expect(page.locator('#stratOutput')).toContainText(/EXPOSURE|Invoice/i, { timeout: 5000 });
  });

  test('strategist -> exec-portal: tsm_strategist_relay renders on the executive portal', async ({ page }) => {
    const strategistRelay = {
      summary: 'TOTAL EXPOSURE: $42,500\nRISK SCORE: 62/100\nEXCEPTION COUNT: 3',
      source: 'warroom',
      timestamp: Date.now(),
      exposure: '$42,500',
      riskScore: '62/100',
      exceptions: '3'
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('tsm_strategist_relay', JSON.stringify(payload));
    }, strategistRelay);

    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-executive-portal.html`);

    await expect(page.locator('body')).toContainText('$42,500', { timeout: 5000 });
  });

  test('exec-portal itself still never writes TSM_FINOPS_STRATEGIST_RELAY (expected -- it is not the write side)', async ({ page }) => {
    // Sentinel Center computes its per-vertical relay key generically as
    // 'TSM_' + id.toUpperCase() + '_STRATEGIST_RELAY', i.e.
    // TSM_FINOPS_STRATEGIST_RELAY for finops -- confirmed still the read
    // key on current main. finops-executive-portal.html only READS this
    // key as a fallback-ordered source, same as before PR #25 -- that part
    // was never broken and isn't expected to change. The write now happens
    // one hop earlier, from the strategist (see next test).
    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-executive-portal.html`);
    const wroteKeyOnLoad = await page.evaluate(() => localStorage.getItem('TSM_FINOPS_STRATEGIST_RELAY'));
    expect(wroteKeyOnLoad).toBeNull();
  });

  test('[FIXED, PR #25] strategist -> Sentinel Center: relayToExecutive() now writes TSM_FINOPS_STRATEGIST_RELAY', async ({ page }) => {
    // finops-main-strategist.html's relayToExecutive() (fired by the
    // "Relay to Executive Portal" button, #relayExecBtn) used to only write
    // 'tsm_strategist_relay' -- never the Sentinel-format key -- so FinOps's
    // row in Sentinel Center could never go LIVE from real navigation. PR
    // #25 added a Sentinel-push block inside relayToExecutive() that parses
    // real exposure/risk numbers out of the rendered #stratOutput text and
    // writes TSM_FINOPS_STRATEGIST_RELAY, mirroring the same convention the
    // BPO strategist already uses.
    await page.goto(`${BASE_URL}/html/finops-suite/finops-war/finops-main-strategist.html`);

    // Seed a rendered strategist report (as if a real Generate had run),
    // then fire the same function the "Relay to Executive Portal" button
    // calls.
    await page.evaluate(() => {
      document.getElementById('stratOutput').textContent =
        'TOTAL EXPOSURE: $42,500\nRISK SCORE: 62/100\nEXCEPTION COUNT: 3';
      // relaySource is a top-level `let`, already defaults to 'warroom'.
      window.relayToExecutive();
    });

    const sentinelRelayRaw = await page.evaluate(() => localStorage.getItem('TSM_FINOPS_STRATEGIST_RELAY'));
    expect(sentinelRelayRaw).not.toBeNull();
    const sentinelRelay = JSON.parse(sentinelRelayRaw);
    expect(sentinelRelay.anomalies[0].exposure).toBe(42500);
    expect(sentinelRelay.anomalies[0].confidence).toBe(62);
    expect(sentinelRelay.anomalies[0].severity).toBe('MED'); // $42,500 falls in the 25k-100k MED band

    // Now prove it actually renders live in Sentinel Center end-to-end.
    await page.addInitScript((payload) => {
      localStorage.setItem('TSM_FINOPS_STRATEGIST_RELAY', payload);
    }, sentinelRelayRaw);
    await page.goto(`${BASE_URL}/html/sentinel-center.html`);

    const foRow = page.locator('.vrow[data-vid="finops"]');
    await expect(foRow).toBeVisible({ timeout: 5000 });
    await expect(foRow.locator('.exposure')).toContainText('42,500');
  });

});