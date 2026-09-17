#!/usr/bin/env node
// test-insurance-exposure-honesty.js
// Validates the two Insurance financial-summary endpoints compute real,
// correct dollar exposure — not just "returns 200."
// Confirmed against live source (routes/insurance-claims-financial.js,
// routes/insurance-compliance-financial.js) before writing, including
// normalizedSeverity's actual fallback behavior.

const BASE_URL = process.env.TSM_BASE_URL || 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  // --- Claims: reserve adequacy risk math ---
  {
    const { json } = await post('/api/insurance/claims/financial-summary', {
      claims: [
        { claim_id: 'C1', policy_ref: 'P1', severity: 'HIGH', reserve_amount: 50000 },
        { claim_id: 'C2', policy_ref: 'P2', severity: 'LOW', reserve_amount: 10000 },
      ],
      appeals: [],
    });
    // HIGH: 50000 * 0.20 = 10000, LOW: 10000 * 0.02 = 200
    check('reserve_adequacy_risk_total = exact sum of per-item rounded exposure',
      json.reserve_adequacy_risk_total === 10200);
    check('HIGH-severity claim item exposure computed correctly',
      json.reserve_adequacy_risk_items.find(i => i.id === 'C1').exposure === 10000);
    check('LOW-severity claim item exposure computed correctly',
      json.reserve_adequacy_risk_items.find(i => i.id === 'C2').exposure === 200);
  }

  // --- Claims: severity case-insensitivity ---
  {
    const { json } = await post('/api/insurance/claims/financial-summary', {
      claims: [{ claim_id: 'C3', severity: 'high', reserve_amount: 1000 }],
      appeals: [],
    });
    check('lowercase severity ("high") still maps to the HIGH rate band (0.20)',
      json.reserve_adequacy_risk_items[0].exposure === 200);
  }

  // --- Claims: unrecognized severity silently defaults to MEDIUM (0.08) ---
  // This is a real behavior in normalizedSeverity(), not an assumption —
  // confirmed by reading the source. A claim with a typo'd or missing
  // severity is silently priced as MEDIUM risk rather than flagged or
  // rejected. This test pins that behavior so it can't drift unnoticed;
  // it does NOT assert this is the right behavior — that's a product call.
  {
    const { json } = await post('/api/insurance/claims/financial-summary', {
      claims: [{ claim_id: 'C5', severity: 'URGENT', reserve_amount: 10000 }],
      appeals: [],
    });
    check('unrecognized severity ("URGENT") silently defaults to MEDIUM band (0.08), not rejected or zeroed',
      json.reserve_adequacy_risk_items[0].exposure === 800 &&
      json.reserve_adequacy_risk_items[0].severity === 'MEDIUM');
  }

  // --- Claims: appeal cost ignores severity/reason, flat per appeal ---
  {
    const { json } = await post('/api/insurance/claims/financial-summary', {
      claims: [],
      appeals: [
        { appeal_id: 'A1', reason: 'coverage_dispute', days_pending: 5 },
        { appeal_id: 'A2', reason: 'documentation', days_pending: 40 },
      ],
    });
    check('appeal_handling_cost_total = flat $1800 x appeal count regardless of reason/age',
      json.appeal_handling_cost_total === 3600);
  }

  // --- Compliance: regulatory fine exposure, unrounded flat bands ---
  {
    const { json } = await post('/api/insurance/compliance/financial-summary', {
      regulatory_findings: [
        { finding_id: 'F1', severity: 'HIGH' },
        { finding_id: 'F2', severity: 'LOW' },
      ],
      legal_matters: [],
    });
    check('regulatory_fine_exposure_total = exact sum of severity-band flat fines',
      json.regulatory_fine_exposure_total === 105000); // 100000 + 5000
  }

  // --- Compliance: litigation reserve status filter — the critical, easy-to-miss bug class ---
  {
    const { json } = await post('/api/insurance/compliance/financial-summary', {
      regulatory_findings: [],
      legal_matters: [
        { matter_id: 'M1', severity: 'HIGH', status: 'Closed' },        // must be excluded
        { matter_id: 'M2', severity: 'HIGH', status: 'In litigation' }, // must be included
        { matter_id: 'M3', severity: 'MEDIUM', status: 'Discovery' },   // must be included, case variant
      ],
    });
    check('a Closed HIGH-severity matter contributes $0, not $250,000',
      !json.litigation_reserve_items.find(i => i.id === 'M1'));
    check('litigation_reserve_total only sums active-status matters (250000 + 75000)',
      json.litigation_reserve_total === 325000);
    check('status matching is case-insensitive ("Discovery" matches "discovery" in rate card list)',
      !!json.litigation_reserve_items.find(i => i.id === 'M3'));
  }

  // --- Honesty flag: rate card key present => confidence stays high ---
  {
    const { json } = await post('/api/insurance/claims/financial-summary', {
      claims: [{ claim_id: 'C4', severity: 'HIGH', reserve_amount: 999 }],
      appeals: [],
    });
    check('reserve_confidence stays 90 when rate card key is present (not silently degraded)',
      json.reserve_confidence.confidence === 90);
  }

  // --- Empty/garbage input doesn't throw, degrades gracefully ---
  {
    const { status, json } = await post('/api/insurance/claims/financial-summary', {
      claims: null,
      appeals: 'not-an-array',
    });
    check('malformed claims/appeals input returns 200 with zeroed totals, not a 500',
      status === 200 && json.reserve_adequacy_risk_total === 0 && json.appeal_handling_cost_total === 0);
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
