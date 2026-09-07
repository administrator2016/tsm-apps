#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

TEST="tests/playwright/leakage-001-career-canonical.spec.js"

cat > "$TEST" <<'EOF'
const { test, expect } = require('@playwright/test');

test('LEAKAGE-001 canonical career integration', async ({ page }) => {
  const errors = [];

  page.on('pageerror', err => {
    errors.push(String(err));
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto(
    'http://localhost:3000/html/tsm-career-training-platform.html',
    { waitUntil: 'domcontentloaded' }
  );

  await page.waitForTimeout(500);

  console.log('=== CAREER PLATFORM ===');

  await expect(
    page.locator('body')
  ).toBeVisible();

  console.log('PASS: Career Training Platform loaded');

  const adapter = await page.evaluate(() => ({
    available: !!window.TSMRevenueLeakageCareer,
    methods: window.TSMRevenueLeakageCareer
      ? Object.keys(window.TSMRevenueLeakageCareer)
      : [],
    discoveredWithoutPayload:
      window.TSMRevenueLeakageCareer
        ? window.TSMRevenueLeakageCareer.discoverLeakage()
        : null
  }));

  console.log(JSON.stringify(adapter, null, 2));

  expect(adapter.available).toBeTruthy();
  expect(adapter.methods).toContain('discoverLeakage');
  expect(adapter.methods).toContain('setPortfolioTwin');

  console.log('PASS: TSMRevenueLeakageCareer available');
  console.log('PASS: canonical discovery API available');

  expect(
    Array.isArray(adapter.discoveredWithoutPayload)
  ).toBeTruthy();

  expect(
    adapter.discoveredWithoutPayload.length
  ).toBe(0);

  console.log(
    'PASS: no canonical portfolio payload = zero leakage opportunities'
  );

  console.log('=== CANONICAL PAYLOAD HANDOFF ===');

  const result = await page.evaluate(() => {
    const twin = {
      leakageOpportunities: [
        {
          contractVersion: '1.0.0',
          opportunityId: 'claims:CLM-001',
          source: 'healthcare-portfolio:claims',
          claimId: 'CLM-001',
          payer: 'Aetna',
          exposure: 12400,
          ageDays: 97,
          denialReasonCode: 'CO-197',
          denialCategory: 'timely_filing',
          opportunityType: 'timely_filing',
          recommendedAction: 'appeal',
          urgency: 'CRITICAL',
          appealable: true,
          appealDeadline: '2026-09-10',
          recoveryLikelihood: 'STRONG',
          confidence: 85,
          evidenceProvenance: []
        },
        {
          contractVersion: '1.0.0',
          opportunityId: 'denials:CLM-002',
          source: 'healthcare-portfolio:denials',
          claimId: 'CLM-002',
          payer: 'UHC',
          exposure: 8500,
          ageDays: 112,
          denialCategory: 'medical_necessity',
          opportunityType: 'medical_necessity',
          recommendedAction: 'appeal',
          urgency: 'HIGH',
          appealable: true,
          recoveryLikelihood: 'MODERATE',
          confidence: 65,
          evidenceProvenance: []
        }
      ]
    };

    const accepted =
      window.TSMRevenueLeakageCareer.setPortfolioTwin(twin);

    const opportunities =
      window.TSMRevenueLeakageCareer.discoverLeakage();

    return {
      accepted,
      count: opportunities.length,
      opportunities
    };
  });

  console.log(JSON.stringify(result, null, 2));

  expect(result.accepted).toBeTruthy();
  expect(result.count).toBe(2);

  const first = result.opportunities.find(
    x => x.claimId === 'CLM-001'
  );

  expect(first).toBeTruthy();
  expect(first.payer).toBe('Aetna');
  expect(first.exposure).toBe(12400);
  expect(first.ageDays).toBe(97);
  expect(first.denialReasonCode).toBe('CO-197');
  expect(first.denialCategory).toBe('timely_filing');
  expect(first.opportunityType).toBe('timely_filing');
  expect(first.recommendedAction).toBe('appeal');
  expect(first.urgency).toBe('CRITICAL');

  console.log('PASS: CLM-001 canonical fields preserved');

  const second = result.opportunities.find(
    x => x.claimId === 'CLM-002'
  );

  expect(second).toBeTruthy();
  expect(second.exposure).toBe(8500);
  expect(second.opportunityType).toBe('medical_necessity');
  expect(second.recommendedAction).toBe('appeal');
  expect(second.urgency).toBe('HIGH');

  console.log('PASS: CLM-002 canonical fields preserved');

  console.log('=== CAREER PROGRESSION ===');

  const progression = await page.evaluate(() => {
    if (!window.TSMRCMCareerProgression) {
      return {
        available: false,
        stages: []
      };
    }

    return {
      available: true,
      stages:
        typeof window.TSMRCMCareerProgression.stages === 'function'
          ? window.TSMRCMCareerProgression.stages()
          : []
    };
  });

  console.log(JSON.stringify(progression, null, 2));

  expect(progression.available).toBeTruthy();
  expect(progression.stages.length).toBe(6);

  const leakageStage =
    progression.stages.find(x => x.id === 'LEAKAGE-001');

  expect(leakageStage).toBeTruthy();

  console.log('PASS: LEAKAGE-001 progression stage exists');

  console.log('=== PAGE ERRORS ===');

  if (errors.length) {
    console.log(JSON.stringify(errors, null, 2));
  }

  expect(errors).toEqual([]);

  console.log('PASS: no browser console/page errors');

  console.log('');
  console.log('============================================================');
  console.log('PASS — LEAKAGE-001 CANONICAL CAREER INTEGRATION');
  console.log('============================================================');
});
EOF

echo "============================================================"
echo "TSM — LEAKAGE-001 CANONICAL BROWSER REGRESSION"
echo "============================================================"
echo
echo "TEST: $TEST"
echo "SERVER: existing localhost:3000"
echo
echo "NOTE: This test does not start, stop, or modify the server."
echo

node --check "$TEST"
echo "PASS: test syntax"

echo
echo "=== PLAYWRIGHT ==="

npx playwright test "$TEST" --reporter=line

echo
echo "=== DIFF CHECK ==="
git diff --check
echo "PASS: git diff --check"

echo
echo "============================================================"
echo "LEAKAGE-001 BROWSER REGRESSION COMPLETE"
echo "============================================================"
