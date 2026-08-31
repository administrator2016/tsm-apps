// tests/playwright/exec-portal-relay-shadowing.spec.js
//
// Regression test for a bug found 2026-08-28 across five exec-portal pages
// (FinOps, Legal, Insurance, Real Estate, BPO): each page's "TSM EXEC KIT"
// block reads a list of possible relay keys (RELAY_KEYS) and uses the
// FIRST one found in storage. The Sentinel-format key
// (TSM_<VERTICAL>_STRATEGIST_RELAY, written on every real strategist run
// to feed Sentinel Center's board view) was listed FIRST -- but that key
// only ever carries {anomalies, generatedAt}, never the real .wip/.explain
// payload the strategist also writes elsewhere. Since the Sentinel key is
// always present after a real run, it silently shadowed the real payload:
// the WIP timeline and Explainability panel fell back to their empty
// "Awaiting relay data..." state, and exportClientPackage() -- which
// reuses that same lastExplainItems -- produced a client package with NO
// findings in it, even immediately after a real strategist analysis.
//
// The Healthcare exec portal had already hit and fixed this exact bug
// (see its RELAY_KEYS comment); this fix brings FinOps/Legal/Insurance/
// RealEstate/BPO in line with it. Legal had a second, compounding bug:
// its fallback keys were written to sessionStorage only, while its
// readRelay() checked localStorage only -- fixed alongside the ordering.
//
// This spec seeds each page with the SAME localStorage/sessionStorage
// state a real strategist relay produces (Sentinel key + real payload
// key both present, since that's what happens on every real run) and
// asserts the WIP/Explainability panes render the real payload's data,
// not the empty fallback state.
//
// Run: npx playwright test tests/playwright/exec-portal-relay-shadowing.spec.js
// (needs `npm install` + `npx playwright install chromium`.)

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const CASES = [
  {
    name: 'FinOps',
    url: '/html/finops-suite/finops-war/finops-executive-portal.html',
    sentinelKey: 'TSM_FINOPS_STRATEGIST_RELAY',
    realKey: 'tsm_strategist_relay',
    realStorage: 'localStorage',
  },
  {
    name: 'Legal',
    url: '/html/war-rooms/legal-war/legal-executive-portal.html',
    sentinelKey: 'TSM_LEGAL_STRATEGIST_RELAY',
    realKey: 'TSM_STRATEGIST_RELAY',
    // The real payload for Legal is only ever written to sessionStorage
    // (legal-main-strategist.html / legal-pro/case-strategist.html) --
    // this is the case that exercises the storage-type half of the fix.
    realStorage: 'sessionStorage',
  },
  {
    name: 'Insurance',
    url: '/html/war-rooms/insure-war/insurance-executive-portal.html',
    sentinelKey: 'TSM_INSURANCE_STRATEGIST_RELAY',
    realKey: 'tsm_ins_strat_relay',
    realStorage: 'localStorage',
  },
  {
    name: 'Real Estate',
    url: '/html/war-rooms/re-war/re-exec-portal.html',
    sentinelKey: 'TSM_REALESTATE_STRATEGIST_RELAY',
    realKey: 'TSM_RE_WAR_RELAY',
    realStorage: 'localStorage',
  },
  {
    name: 'BPO',
    url: '/html/war-rooms/bpo-war/bpo-executive-portal.html',
    sentinelKey: 'TSM_BPO_STRATEGIST_RELAY',
    realKey: 'TSM_BPO_STRAT_RELAY',
    realStorage: 'localStorage',
  },
];

for (const c of CASES) {
  test(`${c.name} exec portal: real wip/explain payload renders (not shadowed by the Sentinel key)`, async ({ page }) => {
    const realPayload = {
      generatedAt: new Date().toISOString(),
      timestamp: Date.now(),
      wip: [
        { id: 'synth', label: 'Strategist Synthesis', status: 'done' },
        { id: 'relay', label: 'Relayed to Exec', status: 'active', detail: 'Awaiting executive review' },
      ],
      explain: [
        {
          claim: 'REGRESSION-MARKER: real strategist payload',
          confidence: 77,
          severity: 'med',
          rationale: 'This text should render in the Explainability pane if the real payload is not shadowed.',
          sources: ['Strategist'],
        },
      ],
    };
    // What a real strategist run ALSO writes alongside the real payload --
    // present at the same time, since both are written by the same
    // relayToExecutive()/storeStratRelay() call. This is what shadowed the
    // real payload before the fix.
    const sentinelPayload = {
      generatedAt: new Date().toISOString(),
      anomalies: [{ id: 'x-1', title: 'Some Anomaly', severity: 'MED', exposure: 10000, confidence: 70 }],
    };

    await page.addInitScript(({ realKey, realStorage, realPayload, sentinelKey, sentinelPayload }) => {
      const realStore = realStorage === 'sessionStorage' ? sessionStorage : localStorage;
      realStore.setItem(realKey, JSON.stringify(realPayload));
      localStorage.setItem(sentinelKey, JSON.stringify(sentinelPayload));
    }, { realKey: c.realKey, realStorage: c.realStorage, realPayload, sentinelKey: c.sentinelKey, sentinelPayload });

    await page.goto(`${BASE_URL}${c.url}`);

    // Before the fix, this would show the "Awaiting relay data..." /
    // "Open the war room to generate a relay." placeholder instead.
    await expect(page.locator('#tsmk-wip-auto')).not.toContainText('Awaiting relay data', { timeout: 5000 });
    await expect(page.locator('#tsmk-exp-auto')).toContainText('REGRESSION-MARKER', { timeout: 5000 });
  });
}
