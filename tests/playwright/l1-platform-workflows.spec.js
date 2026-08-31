// tests/playwright/l1-platform-workflows.spec.js
//
// L1 platform coverage — enterprise-command-center.html, l1-ticket-copilot.html,
// vmware-copilot.html, topology.html. Before this spec, only the NOC trio had
// any coverage (incidentally, via war-room-prep-workflows.spec.js) — the four
// pages above had zero.
//
// Three layers, mirroring war-room-prep-workflows.spec.js (reachability) and
// healthcare-relay-chain.spec.js (real functional relay round-trips seeded
// from source, not invented):
//
//   1. Reachability — every page loads, no uncaught page errors.
//   2. Nav-links wiring — regression guard for the exact gap found and fixed
//      in aa55683cd: l1-ticket-copilot.html's ed459e749 commit message
//      claimed cross-nav was added but the diffstat never touched the file.
//      This test would have caught that immediately.
//   3. Relay chains — real write -> read round trips:
//        a. VMWARE_COPILOT: l1-ticket-copilot.html -> vmware-copilot.html
//           (working prior to this spec; payload shape traced from the
//           actual writer at l1-ticket-copilot.html ~line 1766 and the
//           actual reader at vmware-copilot.html ~line 366)
//        b. FIX_VALIDATED_FROM_CC: enterprise-command-center.html (mission
//           resolve) -> l1-ticket-copilot.html (banner). This relay domain
//           was UNREGISTERED in relay.core.js's RELAY_REGISTRY until the
//           same commit that adds this spec — TSM.relay.write() threw
//           "Unknown relay domain" and TSM.relay.read() silently returned
//           null, so the banner could never have shown regardless of any
//           producer/consumer wiring. Test 3b is the regression guard for
//           that specific class of bug: a relay domain string used by code
//           but absent from the registry.
//
// Run: npx playwright test tests/playwright/l1-platform-workflows.spec.js
// Requires BASE_URL (default http://localhost:4173) pointing at a running
// `node server.js`. Needs a real browser context — run in Codespaces or CI.

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.TSM_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

const PAGES = {
  commandCenter: '/html/l1-copilot/enterprise-command-center.html',
  ticketCopilot: '/html/l1-copilot/l1-ticket-copilot.html',
  vmwareCopilot: '/html/l1-copilot/vmware-copilot.html',
  topology: '/html/l1-copilot/topology.html',
  nocWarRoom: '/html/l1-copilot/noc/noc-war-room.html',
};

async function loadPage(page, url, label) {
  const pageErrors = [];
  const handler = (err) => pageErrors.push(err.stack || String(err));
  page.on('pageerror', handler);

  let response;
  try {
    response = await page.goto(`${BASE_URL}${url}`, { waitUntil: 'load', timeout: 20000 });
  } finally {
    page.off('pageerror', handler);
  }

  expect(response, `${label} (${url}) returned no response — connection refused or DNS failure`).not.toBeNull();
  expect(response.status(), `${label} (${url}) returned HTTP ${response ? response.status() : 'null'}`).toBeLessThan(400);
  expect(pageErrors, `${label} (${url}) threw uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);

  return response;
}

test.describe('L1 Platform — reachability', () => {
  test('Enterprise Command Center loads', async ({ page }) => {
    await loadPage(page, PAGES.commandCenter, 'Enterprise Command Center');
  });
  test('L1 Ticket Copilot loads', async ({ page }) => {
    await loadPage(page, PAGES.ticketCopilot, 'L1 Ticket Copilot');
  });
  test('VMware Copilot loads', async ({ page }) => {
    await loadPage(page, PAGES.vmwareCopilot, 'VMware Copilot');
  });
  test('Topology (digital twin) loads', async ({ page }) => {
    await loadPage(page, PAGES.topology, 'Topology');
  });
});

test.describe('L1 Platform — nav-links wiring', () => {
  // Command Center is the hub — confirm it actually links to all three
  // spokes, not just claims to in a commit message.
  test('Command Center links to Ticket Copilot, VMware Copilot, and NOC', async ({ page }) => {
    await page.goto(`${BASE_URL}${PAGES.commandCenter}`, { waitUntil: 'load', timeout: 20000 });
    const html = await page.content();
    for (const [label, url] of [
      ['L1 Ticket Copilot', '/l1-copilot/l1-ticket-copilot.html'],
      ['VMware Copilot', '/l1-copilot/vmware-copilot.html'],
      ['NOC Command', '/l1-copilot/noc/noc-war-room.html'],
    ]) {
      expect(html.includes(url), `Command Center does not link to ${label} (${url})`).toBe(true);
    }
  });

  // Regression guard for the specific gap fixed in aa55683cd: ed459e749's
  // commit message claimed l1-ticket-copilot.html got outbound nav-links;
  // the diffstat never touched the file. If this test ever starts failing,
  // someone removed the links again without updating this spec.
  test('L1 Ticket Copilot links to Command Center, VMware Copilot, and NOC', async ({ page }) => {
    await page.goto(`${BASE_URL}${PAGES.ticketCopilot}`, { waitUntil: 'load', timeout: 20000 });
    const html = await page.content();
    for (const [label, url] of [
      ['Command Center', '/l1-copilot/enterprise-command-center.html'],
      ['VMware Copilot', '/l1-copilot/vmware-copilot.html'],
      ['NOC Command', '/l1-copilot/noc/noc-war-room.html'],
    ]) {
      expect(html.includes(url), `L1 Ticket Copilot does not link to ${label} (${url})`).toBe(true);
    }
  });

  test('VMware Copilot links back to L1 Ticket Copilot', async ({ page }) => {
    await page.goto(`${BASE_URL}${PAGES.vmwareCopilot}`, { waitUntil: 'load', timeout: 20000 });
    const html = await page.content();
    expect(html.includes('/l1-copilot/l1-ticket-copilot.html'), 'VMware Copilot does not link back to L1 Ticket Copilot').toBe(true);
  });
});

test.describe('L1 Platform — relay chains (real write -> read round trips)', () => {
  test('VMWARE_COPILOT: ticket context relayed into VMware Copilot context banner', async ({ page }) => {
    // Payload shape traced from the actual writer, l1-ticket-copilot.html's
    // btnOpenVmwModule click handler (~line 1766).
    const payload = {
      ticketId: 'INC0099887',
      issueSummary: 'vCenter unresponsive after firmware update',
      component: 'vCenter',
      category: 'Upgrade Readiness',
      environment: 'Production',
    };
    await page.addInitScript((p) => {
      const json = JSON.stringify(p);
      localStorage.setItem('TSM_VMWARE_COPILOT_RELAY', json);
      sessionStorage.setItem('TSM_VMWARE_COPILOT_RELAY', json);
    }, payload);

    await page.goto(`${BASE_URL}${PAGES.vmwareCopilot}`, { waitUntil: 'load', timeout: 20000 });

    const banner = page.locator('#ctxBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText('INC0099887');
    await expect(banner).toContainText('vCenter unresponsive after firmware update');
    await expect(page.locator('#vmwComponent')).toHaveValue('vCenter');
    await expect(page.locator('#vmwCategory')).toHaveValue('Upgrade Readiness');
    await expect(page.locator('#vmwEnv')).toHaveValue('Production');
  });

  test('FIX_VALIDATED_FROM_CC: Command Center resolve notification renders on the matching ticket', async ({ page }) => {
    // Regression guard: this relay domain was unregistered in relay.core.js
    // until the same commit as this spec. Without the registry entry,
    // TSM.relay.write() throws and TSM.relay.read() returns null — the
    // banner never shows no matter what payload is seeded here. If someone
    // removes the RELAY_REGISTRY entry, this is the test that catches it.
    const ticketId = 'INC0055221';

    // Seed the ticket itself so #tkIncident matches on load — the consumer
    // only shows the banner when the currently-open ticket matches
    // payload.ticketId (l1-ticket-copilot.html applyFixValidatedNotification).
    const ticketState = {
      values: { tkIncident: ticketId },
      currentAnalysis: null,
      checklistState: null,
      selectedTeam: null,
      notesManual: '',
      savedAt: Date.now(),
    };

    // Payload shape traced from the actual writer, enterprise-command-center.html
    // openMission()'s resolve branch.
    const fixValidatedPayload = {
      id: 'fv-' + ticketId + '-test',
      ticketId,
      message: 'Fix validated for ESXi Host — host unresponsive. Ticket resolved and closed out.',
    };

    await page.addInitScript(({ ticketState, fixValidatedPayload }) => {
      localStorage.setItem('TSM_L1_CURRENT_TICKET', JSON.stringify(ticketState));
      const json = JSON.stringify(fixValidatedPayload);
      localStorage.setItem('TSM_FIX_VALIDATED_FROM_CC_RELAY', json);
      sessionStorage.setItem('TSM_FIX_VALIDATED_FROM_CC_RELAY', json);
    }, { ticketState, fixValidatedPayload });

    await page.goto(`${BASE_URL}${PAGES.ticketCopilot}`, { waitUntil: 'load', timeout: 20000 });

    const banner = page.locator('#fixValidatedBanner');
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText('ENTERPRISE COMMAND CENTER');
    await expect(banner).toContainText('Fix validated for ESXi Host');
  });

  test('[DOCUMENTED GUARD] FIX_VALIDATED_FROM_CC banner does not show for a non-matching ticket', async ({ page }) => {
    // Confirms the ticketId match guard in applyFixValidatedNotification
    // actually gates the banner — seeds a payload for a different ticket
    // than the one currently open.
    const ticketState = {
      values: { tkIncident: 'INC0011111' },
      currentAnalysis: null, checklistState: null, selectedTeam: null,
      notesManual: '', savedAt: Date.now(),
    };
    const fixValidatedPayload = {
      id: 'fv-INC0099999-test',
      ticketId: 'INC0099999',
      message: 'Fix validated for a different ticket entirely.',
    };

    await page.addInitScript(({ ticketState, fixValidatedPayload }) => {
      localStorage.setItem('TSM_L1_CURRENT_TICKET', JSON.stringify(ticketState));
      const json = JSON.stringify(fixValidatedPayload);
      localStorage.setItem('TSM_FIX_VALIDATED_FROM_CC_RELAY', json);
      sessionStorage.setItem('TSM_FIX_VALIDATED_FROM_CC_RELAY', json);
    }, { ticketState, fixValidatedPayload });

    await page.goto(`${BASE_URL}${PAGES.ticketCopilot}`, { waitUntil: 'load', timeout: 20000 });

    const banner = page.locator('#fixValidatedBanner');
    await expect(banner).not.toBeVisible();
  });
});
