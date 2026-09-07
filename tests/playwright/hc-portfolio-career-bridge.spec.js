const { test, expect } = require('@playwright/test');

test('HC Portfolio → Career bridge preserves canonical leakage contract', async ({ page }) => {
  const errors = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', err => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto(
    'http://localhost:3000/html/tsm-career-training-platform.html',
    { waitUntil: 'domcontentloaded' }
  );

  await page.waitForTimeout(500);

  console.log('=== CAREER PLATFORM ===');

  const platform = await page.evaluate(() => ({
    bridge:
      !!window.TSMHealthcarePortfolioCareerBridge,
    bridgeMethods:
      window.TSMHealthcarePortfolioCareerBridge
        ? Object.keys(window.TSMHealthcarePortfolioCareerBridge)
        : [],
    career:
      !!window.TSMRevenueLeakageCareer,
    careerMethods:
      window.TSMRevenueLeakageCareer
        ? Object.keys(window.TSMRevenueLeakageCareer)
        : []
  }));

  console.log(JSON.stringify(platform, null, 2));

  expect(platform.bridge).toBeTruthy();
  expect(platform.career).toBeTruthy();

  expect(platform.bridgeMethods).toEqual(
    expect.arrayContaining([
      'publish',
      'getPortfolioTwin',
      'getLeakageOpportunities',
      'validateTwin',
      'clear'
    ])
  );

  expect(platform.careerMethods).toEqual(
    expect.arrayContaining([
      'setPortfolioTwin',
      'discoverLeakage'
    ])
  );

  console.log('PASS: bridge available');
  console.log('PASS: Career adapter available');

  console.log('=== EMPTY STATE ===');

  const empty = await page.evaluate(() => ({
    twin: window.TSMHealthcarePortfolioCareerBridge.getPortfolioTwin(),
    opportunities:
      window.TSMHealthcarePortfolioCareerBridge.getLeakageOpportunities(),
    discovered:
      window.TSMRevenueLeakageCareer.discoverLeakage()
  }));

  console.log(JSON.stringify(empty, null, 2));

  expect(empty.twin).toBeNull();
  expect(empty.opportunities).toEqual([]);
  expect(empty.discovered).toEqual([]);

  console.log('PASS: no producer payload = zero leakage opportunities');

  console.log('=== CANONICAL PRODUCER HANDOFF ===');

  const result = await page.evaluate(() => {
    const twin = {
      version: 'hc-portfolio-intelligence-v1',
      generatedAt: '2026-09-07T16:00:00.000Z',

      counts: {
        claims: 1,
        denials: 1,
        appeals: 0,
        agedAccounts: 0,
        findings: 0
      },

      claims: [
        {
          id: 'CLM-001',
          type: 'claim',
          claimId: 'CLM-001',
          payer: 'Aetna',
          exposure: 12400,
          ageDays: 97,
          denialReasonCode: 'CO-197',
          denialCategory: 'timely_filing',
          appealable: true,
          appealDeadline: '2026-09-10'
        }
      ],

      denials: [
        {
          id: 'CLM-002',
          type: 'denial',
          claimId: 'CLM-002',
          payer: 'UHC',
          exposure: 8500,
          ageDays: 112,
          denialCategory: 'medical_necessity',
          appealable: true,
          recoveryLikelihood: 'MODERATE'
        }
      ],

      appeals: [],
      agedAccounts: [],
      findings: [],

      leakageOpportunities: [
        {
          id: 'claims:CLM-001',
          opportunityId: 'claims:CLM-001',
          claimId: 'CLM-001',
          accountId: null,
          payer: 'Aetna',
          exposure: 12400,
          ageDays: 97,
          denialReasonCode: 'CO-197',
          denialCategory: 'timely_filing',
          rootCause: null,
          opportunityType: 'timely_filing',
          recommendedAction: 'appeal',
          urgency: 'CRITICAL',
          appealable: true,
          appealDeadline: '2026-09-10',
          recoveryLikelihood: 'STRONG',
          confidence: 85,
          evidenceProvenance: [],
          runtimeSource: 'healthcare-portfolio:claims',
          sourceIndex: 0,
          careerSource: 'canonical-healthcare-portfolio-leakage'
        },
        {
          id: 'denials:CLM-002',
          opportunityId: 'denials:CLM-002',
          claimId: 'CLM-002',
          accountId: null,
          payer: 'UHC',
          exposure: 8500,
          ageDays: 112,
          denialReasonCode: null,
          denialCategory: 'medical_necessity',
          rootCause: null,
          opportunityType: 'medical_necessity',
          recommendedAction: 'appeal',
          urgency: 'HIGH',
          appealable: true,
          appealDeadline: null,
          recoveryLikelihood: 'MODERATE',
          confidence: 65,
          evidenceProvenance: [],
          runtimeSource: 'healthcare-portfolio:denials',
          sourceIndex: 1,
          careerSource: 'canonical-healthcare-portfolio-leakage'
        }
      ],

      leakageSummary: {
        opportunityCount: 2,
        totalExplicitExposure: 20900
      }
    };

    return window.TSMHealthcarePortfolioCareerBridge.publish(twin);
  });

  console.log(JSON.stringify(result, null, 2));

  expect(result.ok).toBeTruthy();
  expect(result.published).toBeTruthy();
  expect(result.careerConnected).toBeTruthy();
  expect(result.count).toBe(2);

  console.log('PASS: canonical Twin published');
  console.log('PASS: Career adapter connected');

  console.log('=== PRESERVATION CHECK ===');

  const state = await page.evaluate(() => {
    const twin =
      window.TSMHealthcarePortfolioCareerBridge.getPortfolioTwin();

    const opportunities =
      window.TSMHealthcarePortfolioCareerBridge
        .getLeakageOpportunities();

    const discovered =
      window.TSMRevenueLeakageCareer.discoverLeakage();

    return {
      twinVersion: twin && twin.version,
      opportunityCount: opportunities.length,
      discoveredCount: discovered.length,

      first: opportunities[0]
        ? {
            claimId: opportunities[0].claimId,
            payer: opportunities[0].payer,
            exposure: opportunities[0].exposure,
            ageDays: opportunities[0].ageDays,
            denialReasonCode: opportunities[0].denialReasonCode,
            denialCategory: opportunities[0].denialCategory,
            opportunityType: opportunities[0].opportunityType,
            recommendedAction: opportunities[0].recommendedAction,
            urgency: opportunities[0].urgency,
            careerSource: opportunities[0].careerSource
          }
        : null,

      second: opportunities[1]
        ? {
            claimId: opportunities[1].claimId,
            payer: opportunities[1].payer,
            exposure: opportunities[1].exposure,
            ageDays: opportunities[1].ageDays,
            denialCategory: opportunities[1].denialCategory,
            opportunityType: opportunities[1].opportunityType,
            recommendedAction: opportunities[1].recommendedAction,
            urgency: opportunities[1].urgency
          }
        : null
    };
  });

  console.log(JSON.stringify(state, null, 2));

  expect(state.twinVersion).toBe('hc-portfolio-intelligence-v1');
  expect(state.opportunityCount).toBe(2);
  expect(state.discoveredCount).toBe(2);

  expect(state.first).toEqual({
    claimId: 'CLM-001',
    payer: 'Aetna',
    exposure: 12400,
    ageDays: 97,
    denialReasonCode: 'CO-197',
    denialCategory: 'timely_filing',
    opportunityType: 'timely_filing',
    recommendedAction: 'appeal',
    urgency: 'CRITICAL',
    careerSource: 'canonical-healthcare-portfolio-leakage'
  });

  expect(state.second).toEqual({
    claimId: 'CLM-002',
    payer: 'UHC',
    exposure: 8500,
    ageDays: 112,
    denialCategory: 'medical_necessity',
    opportunityType: 'medical_necessity',
    recommendedAction: 'appeal',
    urgency: 'HIGH'
  });

  console.log('PASS: canonical leakage fields preserved');
  console.log('PASS: Career discovery sees the same opportunities');

  console.log('=== INVALID PAYLOAD GUARD ===');

  const invalid = await page.evaluate(() =>
    window.TSMHealthcarePortfolioCareerBridge.publish({
      claims: []
    })
  );

  console.log(JSON.stringify(invalid, null, 2));

  expect(invalid.ok).toBeFalsy();
  expect(invalid.published).toBeFalsy();
  expect(invalid.reason).toBe('leakageOpportunities_missing');

  console.log('PASS: invalid Twin rejected');

  console.log('=== PAGE ERRORS ===');

  expect(errors).toEqual([]);

  console.log('PASS: no browser console/page errors');
  console.log('PASS — HC PORTFOLIO → CAREER BRIDGE');
});
