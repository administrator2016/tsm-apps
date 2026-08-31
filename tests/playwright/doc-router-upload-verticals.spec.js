// tests/playwright/doc-router-upload-verticals.spec.js
//
// Drives the REAL upload -> extract -> classify pipeline through
// tsm-doc-search-multi.html for every vertical in DOC_ROUTER_NODES
// (server.js), plus a dedicated case for the image/vision path
// (POST /api/hc/ocr's sibling code path inside /api/doc-router/classify,
// which switches to GROQ_VISION_MODEL when imageBase64 is present).
//
// Unlike finops-doc-search-to-sentinel-chain.spec.js (which seeds
// localStorage directly and never touches the network), this spec exercises
// the actual #doc-file-input -> handleFiles() -> processFile() ->
// extractFile() -> classifyExtraction() -> POST /api/doc-router/classify
// chain end to end, against a live Groq call. It exists to catch exactly
// the class of bug the "dead model name" sweep found: the relay-key wiring
// can be perfect and this pipeline will still fail 100% of the time if the
// model string sent to Groq doesn't exist.
//
// REQUIRES:
//   - Server running with a real GROQ_API_KEY (this repo's sandbox CANNOT
//     run this -- api.groq.com is not in its network allowlist and no key
//     is configured there; run this from your own machine or CI).
//   - Network egress to api.groq.com.
//
// Run: npx playwright test tests/playwright/doc-router-upload-verticals.spec.js
// (needs `npm install` + `npx playwright install chromium`.)

const path = require('path');
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'doc-router');

// One fixture per DOC_ROUTER_NODES vertical (server.js) / VERTICALS entry
// (tsm-doc-search-multi.html). Each fixture's content is written to
// plausibly classify into that vertical, but this test does NOT assert on
// the model's specific documentType/routing choice -- that's the model's
// judgment call, not a contract this test should pin. What it DOES assert:
// the request round-trips successfully (no dead-model / 502 / malformed-
// JSON failure) and the upload queue shows a routed, non-error outcome.
const VERTICAL_FIXTURES = [
  { vertical: 'fo',  file: 'fo-vendor-invoice.txt' },
  { vertical: 'ins', file: 'ins-claim-denial.txt' },
  { vertical: 'con', file: 'con-permit-filing.txt' },
  { vertical: 'bpo', file: 'bpo-work-order.txt' },
  { vertical: 're',  file: 're-closing-disclosure.txt' },
  { vertical: 'leg', file: 'leg-filing-dispute.txt' },
  { vertical: 'hc',  file: 'hc-denial-appeal.txt' },
  { vertical: 'pm',  file: 'pm-vendor-cert.txt' },
  { vertical: 'noc', file: 'noc-incident-report.txt' },
];

// Uploads `fixtureFile` through the real file input and waits for the
// corresponding #upload-queue item to settle (success or error), returning
// its final status text. Mirrors handleFiles()'s single-file path in
// tsm-doc-search-multi.html -- setInputFiles() fires the same 'change'
// listener a real browse-and-select would.
async function uploadAndAwaitResult(page, fixtureFile) {
  const fileInput = page.locator('#doc-file-input');
  const beforeCount = await page.locator('#upload-queue .uq-item').count();

  await fileInput.setInputFiles(path.join(FIXTURES, fixtureFile));

  // New item is prepended (uqAdd() does .prepend()), so it's always the
  // first child once handleFiles() has run.
  const item = page.locator('#upload-queue .uq-item').first();
  await expect(item).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator('#upload-queue .uq-item')).toHaveCount(beforeCount + 1, { timeout: 5000 });

  // Classification + routing involves a live Groq round-trip (with up to
  // 2 retries on 429/5xx, see CLASSIFY_MAX_RETRIES), so give this real
  // headroom rather than the 5s default used for pure-DOM assertions
  // elsewhere in this suite.
  const status = item.locator('.uq-status');
  await expect(status).not.toContainText('Extracting...', { timeout: 30000 });
  await expect(status).not.toContainText('Classifying...', { timeout: 30000 });

  return status;
}

test.describe('Doc router live upload: text-content classify path, one fixture per vertical', () => {
  for (const { vertical, file } of VERTICAL_FIXTURES) {
    test(`${vertical}: ${file} uploads, classifies, and routes without error`, async ({ page }) => {
      await page.goto(`${BASE_URL}/html/tsm-doc-search-multi.html`);

      const status = await uploadAndAwaitResult(page, file);

      // Failure modes this actually catches: a dead/decommissioned model
      // name (502 "model_decommissioned" from Groq, surfaces here as
      // "Failed: ..."), malformed JSON from the model, or "No vertical
      // matched" if DOC_ROUTER_PROMPT/DOC_ROUTER_NODES drift out of sync
      // with VERTICALS in the frontend.
      await expect(status).not.toHaveClass(/err/);
      const text = await status.textContent();
      expect(text).not.toMatch(/^Failed:/);
      expect(text).not.toMatch(/No vertical matched/);
    });
  }
});

test.describe('Doc router live upload: image/vision classify path', () => {
  test('sample-scan.png uploads via the vision model without a dead-model failure', async ({ page }) => {
    await page.goto(`${BASE_URL}/html/tsm-doc-search-multi.html`);

    // This is the path that switches server.js's /api/doc-router/classify
    // to GROQ_VISION_MODEL (imageBase64 present in the request body) --
    // the same model family that was dead in /api/hc/ocr's
    // GROQ_VISION_MODELS fallback list before the 2026-08-27 fix. A
    // 1x1-ish placeholder PNG won't produce a meaningful classification
    // (no real document content), so this test does NOT assert on
    // documentType/vertical/routing -- only that the request completes
    // without a transport/model-level failure (502, "model_decommissioned",
    // bad-JSON-from-model 502). Those are exactly the failures a dead
    // vision model name produces regardless of image content.
    const status = await uploadAndAwaitResult(page, 'sample-scan.png');

    const text = await status.textContent();
    expect(text).not.toMatch(/^Failed:/);
    expect(text).not.toMatch(/model_decommissioned/i);
    expect(text).not.toMatch(/Classification service error/i);

    // A trivial/ambiguous image legitimately CAN come back as "No vertical
    // matched" (the model correctly declining to guess) -- that's a valid
    // outcome here, unlike in the text-fixture cases above where the
    // content unambiguously belongs somewhere. So only fail the test on
    // the request-level failure modes, not on that "no match" result.
  });
});
