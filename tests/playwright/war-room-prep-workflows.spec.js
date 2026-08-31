// tests/playwright/war-room-prep-workflows.spec.js
//
// Walks every workflow tracked in war-room-prep.html end to end:
//   doc-search-multi.html (entry point) -> war room -> strategist -> executive portal
//
// Two chain families are covered, because they don't share a URL pattern:
//   1. SECTOR_IDS chain (war-room-prep.html) — hc, finops, ins, con, legal, re,
//      plus the BPO "evolved demo chain" (bpo-war-room.html entry, the
//      one doc-search-multi.html actually routes to).
//   2. PHASE_IDS chain (architecture/kernel/phases.json) — the SAP-phase
//      war rooms under /html/war-rooms/<domain>/, which use a consistent
//      <domain>-war-room.html / <domain>-strategist.html /
//      <domain>-executive-portal.html naming convention.
// Plus the Honeywell scenario chain (plant/cyber/supplier -> honeywell
// strategist -> honeywell executive portal), which war-room-prep.html
// treats as an optional demo path nested under BPO.
//
// For each chain:
//   - confirms doc-search-multi.html actually links/routes to the entry page
//     (this is the same wiring the NOC registry backfill fixed — regression
//     guard against a route existing in the war room but not being
//     discoverable from the entry point)
//   - walks war room -> strategist -> executive portal by URL, asserting
//     each page returns <400 and throws no uncaught page errors
//
// This does NOT simulate clicking "Escalate" buttons or assert relay
// payload contents — that requires seeding real session/localStorage data
// per page and is a separate, heavier pass. This spec is the structural/
// reachability layer: every hop in the chain resolves to a real page.
//
// Run via: npx playwright test tests/playwright/war-room-prep-workflows.spec.js
// Requires BASE_URL (default http://localhost:4173) pointing at a running
// `node server.js`. Browser execution needs a real browser context — run
// this in Codespaces or CI, not a headless sandbox without a display/deps.

const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOC_SEARCH = '/html/tsm-doc-search-multi.html';

// --- Chain 1: SECTOR_IDS (war-room-prep.html), including BPO demo chain ---
const sectorChains = [
  {
    name: 'Healthcare',
    warRoom: '/html/healthcare/hc-denial-war-room.html',
    strategist: '/html/healthcare/hc-main-strategist.html',
    executive: '/html/healthcare/executive-portal.html',
  },
  {
    name: 'FinOps',
    warRoom: '/html/finops-suite/finops-war/finops-war-room.html',
    strategist: '/html/finops-suite/finops-war/finops-main-strategist.html',
    executive: '/html/finops-suite/finops-war/finops-executive-portal.html',
  },
  {
    name: 'Insurance',
    warRoom: '/html/war-rooms/insure-war/insurance-war-room.html',
    strategist: '/html/war-rooms/insure-war/insurance-strategist.html',
    executive: '/html/war-rooms/insure-war/insurance-executive-portal.html',
  },
  {
    name: 'Construction',
    warRoom: '/html/war-rooms/construct-war/construction-war-room.html',
    strategist: '/html/war-rooms/construct-war/construction-strategist.html',
    executive: '/html/war-rooms/construct-war/construction-executive-portal.html',
  },
  {
    name: 'Legal',
    warRoom: '/html/war-rooms/legal-war/legal-war-room.html',
    strategist: '/html/war-rooms/legal-war/legal-main-strategist.html',
    executive: '/html/war-rooms/legal-war/legal-executive-portal.html',
  },
  {
    name: 'Real Estate',
    warRoom: '/html/war-rooms/re-war/re-war-room.html',
    strategist: '/html/war-rooms/re-war/re-strategist.html',
    executive: '/html/war-rooms/re-war/re-exec-portal.html',
  },
  {
    name: 'BPO (demo chain)',
    warRoom: '/html/war-rooms/bpo-war/bpo-war-room.html',
    strategist: '/html/war-rooms/bpo-war/bpo-strategist.html',
    executive: '/html/war-rooms/bpo-war/bpo-executive-portal.html',
  },
];

// --- Chain 2: PHASE_IDS (phases.json) — SAP-phase war rooms ---
const phaseChains = [
  { name: 'O2C', domain: 'o2c', dir: 'o2c' },
  { name: 'CRM', domain: 'crm', dir: 'crm' },
  { name: 'CPQ', domain: 'cpq', dir: 'cpq' },
  { name: 'Catalog', domain: 'catalog', dir: 'catalog' },
  { name: 'Approval', domain: 'approval', dir: 'approval' },
  { name: 'MDM', domain: 'mdm', dir: 'mdm' },
  { name: 'Governance', domain: 'governance', dir: 'governance' },
  { name: 'Digital Twin', domain: 'digital-twin', dir: 'digital-twin', warRoomFile: 'digital-twin.html' },
  { name: 'BPO Services (SAP phase)', domain: 'bpo', dir: 'bpo-war' },
].map((p) => ({
  name: p.name,
  warRoom: `/html/war-rooms/${p.dir}/${p.warRoomFile || `${p.domain}-war-room.html`}`,
  strategist: `/html/war-rooms/${p.dir}/${p.domain}-strategist.html`,
  executive: `/html/war-rooms/${p.dir}/${p.domain}-executive-portal.html`,
}));

// Integration Hub breaks the <domain>-war-room.html convention slightly
phaseChains.push({
  name: 'Integration Hub',
  warRoom: '/html/war-rooms/integration-hub/integration-hub.html',
  strategist: '/html/war-rooms/integration-hub/integration-hub-strategist.html',
  executive: '/html/war-rooms/integration-hub/integration-hub-executive-portal.html',
});
phaseChains.push({
  name: 'NOC',
  warRoom: '/html/l1-copilot/noc/noc-war-room.html',
  strategist: '/html/l1-copilot/noc/noc-strategist.html',
  executive: '/html/l1-copilot/noc/noc-executive-portal.html',
});

// --- Honeywell scenario chain (nested under BPO in war-room-prep.html) ---
const honeywellScenarios = [
  { name: 'Honeywell — Plant Incident', warRoom: '/html/plant-incident.html' },
  { name: 'Honeywell — Cyber Incident', warRoom: '/html/cyber-incident.html' },
  { name: 'Honeywell — Supplier Shutdown', warRoom: '/html/supplier-shutdown.html' },
];
const honeywellStrategist = '/html/war-rooms/honeywell-strategist.html';
const honeywellExecutive = '/html/war-rooms/honeywell-executive-portal.html';

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

test.describe('War Room Prep — entry point wiring', () => {
  test('doc-search-multi.html loads', async ({ page }) => {
    await loadPage(page, DOC_SEARCH, 'Doc Search Multi (entry point)');
  });

  for (const chain of [...sectorChains, ...phaseChains]) {
    test(`doc-search-multi.html links to ${chain.name} war room`, async ({ page }) => {
      await page.goto(`${BASE_URL}${DOC_SEARCH}`, { waitUntil: 'load', timeout: 20000 });
      const html = await page.content();
      expect(
        html.includes(chain.warRoom),
        `${chain.name} war room URL (${chain.warRoom}) is not referenced anywhere in doc-search-multi.html — ` +
        `it exists on disk but isn't discoverable from the entry point (same class of gap the NOC registry backfill fixed)`
      ).toBe(true);
    });
  }
});

test.describe('War Room Prep — sector chains (war room -> strategist -> executive)', () => {
  for (const chain of sectorChains) {
    test(`${chain.name}: full chain reachable`, async ({ page }) => {
      await loadPage(page, chain.warRoom, `${chain.name} war room`);
      await loadPage(page, chain.strategist, `${chain.name} strategist`);
      await loadPage(page, chain.executive, `${chain.name} executive portal`);
    });
  }
});

test.describe('War Room Prep — SAP phase chains (war room -> strategist -> executive)', () => {
  for (const chain of phaseChains) {
    test(`${chain.name}: full chain reachable`, async ({ page }) => {
      await loadPage(page, chain.warRoom, `${chain.name} war room`);
      await loadPage(page, chain.strategist, `${chain.name} strategist`);
      await loadPage(page, chain.executive, `${chain.name} executive portal`);
    });
  }
});

test.describe('War Room Prep — Honeywell scenario chain (optional demo path under BPO)', () => {
  for (const scenario of honeywellScenarios) {
    test(`${scenario.name}: scenario -> strategist -> executive`, async ({ page }) => {
      await loadPage(page, scenario.warRoom, scenario.name);
      await loadPage(page, honeywellStrategist, 'Honeywell strategist');
      await loadPage(page, honeywellExecutive, 'Honeywell executive portal');
    });
  }
});