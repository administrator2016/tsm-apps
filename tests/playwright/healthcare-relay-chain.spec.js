// tests/playwright/healthcare-relay-chain.spec.js
//
// Phase 1 vertical relay-chain audit (see docs/audit/phase1-healthcare-chain-audit.md
// for the full trace this spec is seeded from). Every payload shape below was
// copied from the actual writer function in source, not invented.
//
// UNLIKE finops, healthcare does NOT run doc-search -> war-room -> strategist
// -> exec -> sentinel as one line. Two separate paths exist:
//   Path A: doc-search -> hc-denial-war-room.html -- BROKEN, dead relay, no
//           reader anywhere in that file. Test 1 below documents this current
//           (broken) behavior so a future fix shows as a spec change, not a
//           silent pass.
//   Path B: node war rooms (hc-billing, hc-medical, etc.) -> TSM_WAR_ROOM_BRIEF
//           -> hc-main-strategist.html -> TSM_EXEC_RELAY -> executive-portal.html,
//           with a parallel auto-write of TSM_HEALTHCARE_STRATEGIST_RELAY for
//           Sentinel Center. This is the chain that's actually live for the
//           HonorHealth pilot.
//
// Payload shapes traced from:
//   nodeWarRoomBrief      <- html/healthcare/hc-billing/index.html relayToStrategist() ~line 737
//   strategistExecRelay   <- html/healthcare/hc-main-strategist.html escalateToExecPortal() ~line 1373
//   sentinelRelay         <- html/healthcare/hc-main-strategist.html sentinel-push block ~line 1045
//
// IMPORTANT: use html/healthcare/hc-main-strategist.html (the flat file), NOT
// html/healthcare/hc-main-strategist/index.html (a stub with no relay-write
// logic at all -- see audit doc for the autorun routing bug that hits the stub).
//
// Run: npx playwright test tests/playwright/healthcare-relay-chain.spec.js
// (needs `npm install` + `npx playwright install chromium` first.)

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Healthcare relay chain (Phase 1)', () => {

  test('doc-search -> hc-denial-war-room: tsm_hc_docsearch_relay is now read and consumed', async ({ page }) => {
    // FLIPPED from "[DOCUMENTED BROKEN] ... is never read": a real reader now
    // exists at html/healthcare/hc-denial-war-room.html (the IIFE right after
    // the TSM_HC_WAR_RELAY block) -- it reads tsm_hc_docsearch_relay,
    // populates #doc-text from relay.summary via a dispatched 'input' event
    // ~500ms after load, and deletes the key so a refresh can't replay it.
    // Per this test's own prior instruction ("if this test ever starts
    // FAILING ... flip this spec to assert the fix"), this now asserts the
    // real, current behavior instead of the old bug.
    const docSearchPayload = {
      ts: Date.now(),
      summary: 'DOCUMENT: eob-mesa-0417.pdf\nTYPE: EOB\nREF/CLAIM #: CLM-0334\nEXPOSURE: $3,800',
      doc: { fileName: 'eob-mesa-0417.pdf', documentType: 'EOB', invoiceNo: 'CLM-0334', amount: 3800 }
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('tsm_hc_docsearch_relay', JSON.stringify(payload));
    }, docSearchPayload);

    await page.goto(`${BASE_URL}/html/healthcare/hc-denial-war-room.html`);

    // updateStatus() (wired to #doc-text's 'input' listener) is the real
    // signal that the reader's dispatched 'input' event actually fired and
    // docText was populated from the relay -- not a guess at page text.
    await expect(page.locator('#doc-status')).toContainText('chars loaded', { timeout: 3000 });

    const stillThere = await page.evaluate(() => localStorage.getItem('tsm_hc_docsearch_relay'));
    expect(stillThere).toBeNull();
  });

  test('node war room -> strategist: TSM_WAR_ROOM_BRIEF populates the war-room banner', async ({ page }) => {
    const nodeWarRoomBrief = {
      sessionId: 'REL-TEST1',
      timestamp: new Date().toISOString(),
      engineOutputs: { 'HC-BILLING': 'Denial rate 18.4% vs 15% CMS threshold. CLM-0334 at risk, $3,800 timely-filing deadline in 48hrs.' },
      engine06: { narrative: 'Mesa denial spike driven by PR-96 and CO-29 codes; CLM-0334 requires immediate appeal to avoid write-off.', recommendations: [] },
      documentMeta: { ingestType: 'hc-billing', charCount: 142 }
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_WAR_ROOM_BRIEF', JSON.stringify(payload));
      localStorage.setItem('TSM_WAR_ROOM_BRIEF', JSON.stringify(payload));
    }, nodeWarRoomBrief);

    await page.goto(`${BASE_URL}/html/healthcare/hc-main-strategist.html`);

    const banner = page.locator('#tsm-war-room-banner');
    await expect(banner).toContainText('REL-TEST1', { timeout: 5000 });
    await expect(banner).toContainText(/CLM-0334|Mesa denial spike/i);
  });

  test('strategist -> exec portal: TSM_EXEC_RELAY renders on the Strategist Reports tab', async ({ page }) => {
    const strategistExecRelay = {
      ts: Date.now(),
      enriched: true,
      sourceSnapshot: { revenueAtRisk: '$48,000', denialRate: '18.4%' },
      kpi: {},
      bnca: { revenuePosition: 'Revenue at risk $48,000 per latest Strategist sync.', denialIntel: 'Denial hotspot 18.4% — see Strategist session for detail.' },
      alerts: { decisions: [], urgent: ['CLM-0334 (CPT 93454, $3,800, Medicare CO-29 timely filing) — 48hr write-off deadline'] },
      sessionId: 'REL-TEST2',
      warRoomBrief: 'TOP ISSUE\nCLM-0334 timely-filing deadline in 48 hours, $3,800 exposure.\n\nIMMEDIATE ACTIONS\n1. File appeal today.\n2. Loop in Medicare liaison.\n\nPRIMARY ACTOR\nScottsdale billing office manager',
      dashSummary: 'Denial hotspot 18.4%',
      aiSummary: 'CLM-0334 requires immediate appeal.',
      stratReports: { executiveBrief: 'CLM-0334 timely-filing deadline in 48 hours.' },
      liveSignals: [{ severity: 'URGENT', title: 'CLM-0334 timely filing deadline', sub: '48hr write-off risk', source: 'HC-Billing · Scottsdale' }]
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
      localStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
      // checkForFreshRelay() (executive-portal.html) auto-pops a full-screen
      // #esc-modal-overlay (z-index 9999) whenever a TSM_EXEC_RELAY under 10
      // minutes old hasn't been shown yet this session -- exactly what we
      // just seeded. Mark it already-shown, same key/value the app's own
      // dismiss/re-visit logic uses, so the tab underneath is clickable.
      sessionStorage.setItem('TSM_EXEC_RELAY_SHOWN', String(payload.ts));
    }, strategistExecRelay);

    await page.goto(`${BASE_URL}/html/healthcare/executive-portal.html`);

    // buildStratReportsTab() only runs when the Strategist Reports tab is
    // opened -- it does not populate on page load. Click through to it
    // rather than loosen the assertion to whatever's on the default tab.
    await page.locator('[data-tab="stratreports"]').click();

    const reportsContent = page.locator('#strat-reports-content');
    await expect(reportsContent).toContainText('REL-TEST2', { timeout: 5000 });
    await expect(reportsContent).toContainText(/CLM-0334/);
  });

  test('strategist -> Sentinel Center: TSM_HEALTHCARE_STRATEGIST_RELAY renders in the vertical row', async ({ page }) => {
    const sentinelRelay = {
      generatedAt: new Date().toISOString(),
      anomalies: [{
        id: 'hc-test1',
        title: 'HonorHealth Strategist Synthesis',
        severity: 'HIGH',
        exposure: 48000,
        confidence: 78,
        rootCause: 'Denial spike: PR-96 and CO-29 codes concentrated at Mesa office',
        recommendedAction: 'File CLM-0334 appeal before 48hr timely-filing deadline (Owner: Scottsdale billing)'
      }]
    };
    await page.addInitScript((payload) => {
      localStorage.setItem('TSM_HEALTHCARE_STRATEGIST_RELAY', JSON.stringify(payload));
    }, sentinelRelay);

    await page.goto(`${BASE_URL}/html/sentinel-center.html`);

    // Sentinel renders one .vrow per subscribed vertical, keyed by
    // data-vid -- not a generic text-match locator, to avoid a false pass
    // if "Healthcare" appears elsewhere on the page (e.g. a locked-row teaser).
    const hcRow = page.locator('.vrow[data-vid="healthcare"]');
    await expect(hcRow).toBeVisible({ timeout: 5000 });
    // Sentinel's own fmtMoney() (html/sentinel-center.html) abbreviates
    // thousands as "$48K", not "$48,000" -- matching the real formatter,
    // not the raw number.
    await expect(hcRow.locator('.exposure')).toContainText('$48K');

    // Healthcare's canonical Executive Portal lives at
    // /html/healthcare/executive-portal.html.
    // Keep the Sentinel contract anchored to the real served path.
    const execLink = hcRow.locator('.exec-link');
    if (await execLink.count()) {
      await expect(execLink).toHaveAttribute(
        'href',
        /\/html\/healthcare\/executive-portal\.html(?:\?|$)/
      );
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────
// Guide Engine cross-page continuity (js/tsm-guide-engine.js) + Exec Portal
// Decision Center (html/shared/tsm-exec-portal-upgrade.js), both loaded on
// hc-main-strategist.html / executive-portal.html. DOM ids/classes and
// payload shapes below were confirmed present in what server.js actually
// serves, not guessed:
//   #guide-continuity-banner / #guide-continuity-dismiss / #guide-step-counter
//     <- js/tsm-guide-engine.js renderWidget()/readVerifiedAppHandoff()
//   #escalate-strategist-btn -> escalateToStrategist()
//     <- html/healthcare/hc-denial-war-room.html (window.location.href nav)
//   #strat-out
//     <- html/healthcare/hc-main-strategist.html (real pack-output panel;
//        STATE_CHECKERS.healthcare.strategist reads its textContent length,
//        NOT click text)
//   .tsm-btn-approve / .tsm-status-approved
//     <- html/shared/tsm-exec-portal-upgrade.js decide(), auto-mounted via
//        TSMExecPortal.init() on DOMContentLoaded
test.describe('Guide Engine continuity + Decision Center (Phase 1 fix verification)', () => {

  test('hc-denial-war-room escalate: same-tab navigation, not a new tab', async ({ page, context }) => {
    // The guided tour is optional first-run UX. Mark it complete so this
    // workflow test exercises the real escalation control without the
    // tour overlay intercepting pointer events.
    await page.addInitScript(() => {
      localStorage.setItem('hc_denial_tour_done', '1');
    });

    await page.goto(`${BASE_URL}/html/healthcare/hc-denial-war-room.html`);

    // #escalate-strategist-btn doesn't exist in the static page -- it's
    // injected by injectPriorAuthGeneratorWidget() only after the real
    // 5-engine pipeline (fireAll -> API calls) finishes, which is too slow
    // and network-dependent to drive through the UI here. Call the actual
    // dispatcher function directly (same real code path, real markup) to
    // produce the button without faking its HTML by hand.
    await page.evaluate(() => window.injectPriorAuthGeneratorWidget(''));
    await expect(page.locator('#escalate-strategist-btn')).toBeVisible({ timeout: 3000 });

    // escalateToStrategist() runs a ~1.6s "packing" animation before
    // navigating via window.location.href -- assert no second tab/page is
    // ever opened during that window, then confirm the same tab lands on
    // the strategist page.
    let popupSeen = false;
    context.on('page', () => { popupSeen = true; });

    await page.locator('#escalate-strategist-btn').click();
    await page.waitForURL('**/hc-main-strategist.html**', { timeout: 5000 });

    expect(popupSeen).toBe(false);
    expect(page.url()).toContain('hc-main-strategist.html');
  });

  test('strategist: guide-continuity-banner shows the real TSM_WAR_ROOM_BRIEF sessionId', async ({ page }) => {
    const brief = {
      sessionId: 'REL-CONT1',
      timestamp: new Date().toISOString(),
      engineOutputs: {},
      engine06: { narrative: 'Mesa denial spike, CLM-0334 at risk.', recommendations: [] },
      documentMeta: { ingestType: 'hc-billing' }
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_WAR_ROOM_BRIEF', JSON.stringify(payload));
    }, brief);

    await page.goto(`${BASE_URL}/html/healthcare/hc-main-strategist.html`);

    const banner = page.locator('#guide-continuity-banner');
    await expect(banner).toContainText('REL-CONT1', { timeout: 5000 });
    await expect(banner).toContainText(/HC Denial War Room/i);
  });

  test('strategist: dismissing the continuity banner does not delete TSM_WAR_ROOM_BRIEF', async ({ page }) => {
    const brief = {
      sessionId: 'REL-CONT1B',
      timestamp: new Date().toISOString(),
      engineOutputs: {},
      engine06: { narrative: 'Mesa denial spike, CLM-0334 at risk.', recommendations: [] },
      documentMeta: { ingestType: 'hc-billing' }
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_WAR_ROOM_BRIEF', JSON.stringify(payload));
    }, brief);

    await page.goto(`${BASE_URL}/html/healthcare/hc-main-strategist.html`);
    await expect(page.locator('#guide-continuity-banner')).toContainText('REL-CONT1B', { timeout: 5000 });

    await page.locator('#guide-continuity-dismiss').click();
    await expect(page.locator('#guide-continuity-banner')).toHaveCount(0);

    // This banner is flagged noClear (it reads live data hc-main-strategist's
    // OWN readWarRoomBrief() renders from via #tsm-war-room-banner) -- dismiss
    // must only hide the guide widget's copy, never wipe the underlying key.
    const stillThere = await page.evaluate(() => sessionStorage.getItem('TSM_WAR_ROOM_BRIEF'));
    expect(stillThere).not.toBeNull();
    expect(JSON.parse(stillThere).sessionId).toBe('REL-CONT1B');
  });

  test('strategist step tracker: a click-text decoy does not advance it, real #strat-out content does', async ({ page }) => {
    await page.goto(`${BASE_URL}/html/healthcare/hc-main-strategist.html`);

    const counter = page.locator('#guide-step-counter');
    await expect(counter).toHaveText('STEP 1 OF 4', { timeout: 5000 });

    // Decoy: ".tb-name" renders the static label "HC STRATEGIST" -- it
    // contains the word "STRATEGIST" (one of the OLD click-text heuristic's
    // trigger terms for this vertical) but is plain text, not a pack button.
    // Healthcare/strategist now runs on the verified engine
    // (STATE_CHECKERS.healthcare.strategist, keyed off #strat-out content),
    // so this click must NOT advance the counter.
    await page.locator('.tb-name').click();
    await page.waitForTimeout(300);
    await expect(counter).toHaveText('STEP 1 OF 4');

    // Real signal: STATE_CHECKERS.healthcare.strategist treats any
    // #strat-out textContent over 40 chars as "a pack has actually run",
    // which satisfies steps 1-3 (step 4 stays open -- no TSM_EXEC_RELAY yet).
    await page.evaluate(() => {
      document.getElementById('strat-out').textContent =
        'Denial Recovery Bundle generated: 47 claims, $38,000 recoverable, payer group A.';
    });
    await page.waitForTimeout(1000); // next 800ms verified-engine poll tick
    await expect(counter).toHaveText('STEP 4 OF 4');
  });

  test('exec portal: guide-continuity-banner shows the real TSM_EXEC_RELAY sessionId', async ({ page }) => {
    const relay = {
      ts: Date.now(),
      enriched: true,
      sessionId: 'REL-CONT2',
      sourceSnapshot: {}, kpi: {}, bnca: {},
      alerts: { decisions: [], urgent: [] }
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
      localStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
    }, relay);

    await page.goto(`${BASE_URL}/html/healthcare/executive-portal.html`);

    const banner = page.locator('#guide-continuity-banner');
    await expect(banner).toContainText('REL-CONT2', { timeout: 5000 });
    await expect(banner).toContainText(/HC Main Strategist/i);
  });

  test('exec portal authorize step: only flips to done on a real .tsm-btn-approve click, not on load', async ({ page }) => {
    const relay = {
      ts: Date.now(),
      enriched: true,
      sessionId: 'REL-CONT3',
      sourceSnapshot: {}, kpi: {}, bnca: {},
      alerts: { decisions: [], urgent: [] } // empty -> Decision Center falls back to its 3 built-in healthcare defaults
    };
    await page.addInitScript((payload) => {
      sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
      localStorage.setItem('TSM_EXEC_RELAY', JSON.stringify(payload));
      // Suppress checkForFreshRelay()'s auto-popped #esc-modal-overlay (see
      // note on the Strategist Reports test above) -- it would otherwise
      // sit at z-index 9999 over the Decision Center and block the real
      // .tsm-btn-approve click below.
      sessionStorage.setItem('TSM_EXEC_RELAY_SHOWN', String(payload.ts));
    }, relay);

    await page.goto(`${BASE_URL}/html/healthcare/executive-portal.html`);

    // relayLoaded is true from TSM_EXEC_RELAY alone -> steps 1-2 already
    // done on load. Step 3 (authorize) must NOT be done yet -- no approve
    // click has happened.
    const counter = page.locator('#guide-step-counter');
    await expect(counter).toHaveText('STEP 3 OF 3', { timeout: 5000 });
    await expect(page.locator('.tsm-status-approved')).toHaveCount(0);

    await page.locator('.tsm-btn-approve').first().click();

    // decide() synchronously replaces the actions cell with .tsm-status-approved.
    await expect(page.locator('.tsm-status-approved')).toHaveCount(1);
    await page.waitForTimeout(1000); // next verified-engine poll tick
    await expect(counter).toHaveText('COMPLETE');
  });

});
