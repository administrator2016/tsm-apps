// tests/playwright/finops-relay-chain.spec.js
//
// Phase 1 vertical relay-chain audit (see docs/audit/phase1-finops-chain-audit.md
// for the full trace this spec is seeded from). Every payload shape below was
// re-verified against the CURRENT source on `main` -- a prior session traced
// this chain and wrote a first version of this spec, but it was never
// committed/pushed before that session ended, so this is a fresh recreation,
// not a restore. Re-checking the source also surfaced a real regression from
// the earlier trace (see the Sentinel test below).
//
// Payload shapes traced from:
//   docSearchPayload     <- html/tsm-doc-search-multi.html DOCSEARCH_ROUTES ~line 2585
//   warRoomKernelRelay   <- TSM_KERNEL.setRelay() {ts, v, p} wrapper, `p` matching
//                           html/finops-suite/finops-war-room.html's own relay payload
//   strategistRelay      <- html/finops-suite/finops-main-strategist.html
//                           relayToExecutive() ~line 1194 (writes tsm_strategist_relay)
//
// Run: npx playwright test tests/playwright/finops-relay-chain.spec.js
// (needs `npm install` + `npx playwright install chromium` -- could not be run
// in this sandbox, see commit message for why.)

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('FinOps relay chain (Phase 1)', () => {

  test('doc-search -> war-room: tsm_fo_docsearch_relay populates the paste area', async ({ page }) => {
    const docSearchPayload = {
      ts: Date.now(),
      summary: 'DOCUMENT: q3-invoice.pdf\nTYPE: Invoice\nCARRIER/VENDOR: Acme Supply Co\nEXPOSURE: $42,500',
      doc: { fileName: 'q3-invoice.pdf', documentType: 'Invoice', vendor: 'Acme Supply Co', amount: 42500 }
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('tsm_fo_docsearch_relay', JSON.stringify(payload));
    }, docSearchPayload);

    await page.goto(`${BASE_URL}/html/finops-suite/finops-war-room.html`);

    const pasteArea = page.locator('#docPaste');
    await expect(pasteArea).toHaveValue(/q3-invoice\.pdf/, { timeout: 5000 });

    // Writer clears the key after consuming it -- confirm it actually did,
    // not just that it read a stale copy that's still sitting there.
    const remaining = await page.evaluate(() => localStorage.getItem('tsm_fo_docsearch_relay'));
    expect(remaining).toBeNull();
  });

  test('war-room -> strategist: tsm_war_relay_finops-suite (TSM_KERNEL shape) renders the brief', async ({ page }) => {
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

    await page.goto(`${BASE_URL}/html/finops-suite/finops-main-strategist.html`);

    const output = page.locator('#stratOutput');
    await expect(output).toContainText(/EXPOSURE|Invoice/i, { timeout: 5000 });
  });

  test('strategist -> exec portal: tsm_strategist_relay renders on the executive portal', async ({ page }) => {
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

    await page.goto(`${BASE_URL}/html/finops-suite/finops-executive-portal.html`);

    // loadRelay()/populateFromRelay() should have run; assert the page
    // actually shows the seeded exposure figure somewhere, not just a
    // "no relay data" empty state.
    await expect(page.locator('body')).toContainText('$42,500', { timeout: 5000 });
  });

  test('[DOCUMENTED BROKEN] strategist -> Sentinel Center: TSM_FINOPS_STRATEGIST_RELAY is never written by the live strategist', async ({ page }) => {
    // TSM_FINOPS_STRATEGIST_RELAY IS written correctly by html/finops-main-strategist.html
    // (root-level file) -- but nothing in the app actually navigates there.
    // Every real link (finops-war-room.html, finops-executive-portal.html, the
    // autorun pipeline) points at html/finops-suite/finops-main-strategist.html,
    // which has zero references to STRATEGIST_RELAY anywhere in the file.
    // Practical effect: FinOps's row in Sentinel Center can never go LIVE from
    // real use -- only from someone finding and using the orphaned root file,
    // or seeding the key directly as this test does to prove the read side
    // still works once written.
    const sentinelRelay = {
      generatedAt: new Date().toISOString(),
      anomalies: [{
        id: 'fo-test1',
        title: 'FinOps Strategist Synthesis',
        severity: 'HIGH',
        exposure: 42500,
        confidence: 62,
        rootCause: 'Duplicate payments and unapproved vendor spend concentrated in Q3 invoices',
        recommendedAction: 'Renegotiate vendor terms and freeze unapproved vendor POs (Owner: AP lead)'
      }]
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('TSM_FINOPS_STRATEGIST_RELAY', JSON.stringify(payload));
    }, sentinelRelay);

    await page.goto(`${BASE_URL}/html/sentinel-center.html`);

    // Read side works when the key is present (proving Sentinel's contract
    // itself is fine) -- the bug is that the live strategist never writes it.
    const foRow = page.locator('.vrow[data-vid="finops"]');
    await expect(foRow).toBeVisible({ timeout: 5000 });
    await expect(foRow.locator('.exposure')).toContainText('42,500');
  });

});
