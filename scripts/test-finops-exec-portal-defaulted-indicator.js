// scripts/test-finops-exec-portal-defaulted-indicator.js
//
// Confirms finops-executive-portal.html's populateFromRelay() surfaces the
// strategist's exposureDefaulted/riskScoreDefaulted honesty flags to the
// user, closing the gap named in docs/audit/step6-cross-vertical-release-
// status.md ("Groq inference layer itself still untested... portal-side
// display for exposureDefaulted/riskScoreDefaulted still missing").
//
// Loads and executes the actual page script via jsdom (not a source grep).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', 'html', 'finops-suite', 'finops-war', 'finops-executive-portal.html');

async function loadPage() {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/finops-suite/finops-war/finops-executive-portal.html',
  });
  const { window } = dom;
  window.scrollTo = () => {};
  window.localStorage.setItem = window.localStorage.setItem || (() => {});
  window.sessionStorage.setItem = window.sessionStorage.setItem || (() => {});

  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 50));
  return { window, document: window.document };
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  // --- Case 1: strategist flagged both as defaulted (demo/ERA-batch fallback) ---
  {
    const { window, document } = await loadPage();
    const payload = {
      summary: 'No structured fields matched in this document.',
      source: 'strategist',
      timestamp: Date.now(),
      exposure: '$91,800–$112,200',
      riskScore: '70/100',
      exposureDefaulted: true,
      riskScoreDefaulted: true,
    };
    window.populateFromRelay(payload);

    check('kpiExposure shows the defaulted value', document.getElementById('kpiExposure').textContent.includes('91,800'));
    check('kpiExposureSub warns it is estimated', document.getElementById('kpiExposureSub').textContent.includes('estimated'));
    check('kpiRiskSub warns it is estimated', document.getElementById('kpiRiskSub').textContent.includes('estimated'));
    window.close();
  }

  // --- Case 2: strategist extracted real numbers — no warning should show ---
  {
    const { window, document } = await loadPage();
    const payload = {
      summary: 'TOTAL EXPOSURE: $47,250\nRISK SCORE: 58/100',
      source: 'strategist',
      timestamp: Date.now(),
      exposure: '$47,250',
      riskScore: '58/100',
      exposureDefaulted: false,
      riskScoreDefaulted: false,
    };
    window.populateFromRelay(payload);

    check('kpiExposure shows the real extracted value', document.getElementById('kpiExposure').textContent.includes('47,250'));
    check('kpiExposureSub does NOT warn when value is real', document.getElementById('kpiExposureSub').textContent === 'financial liability');
    check('kpiRiskSub does NOT warn when value is real', document.getElementById('kpiRiskSub').textContent === 'war room analysis');
    window.close();
  }

  // --- Case 3: strategist's own extraction missed (flag true), but this
  // portal's OWN independent regex still recovers a real number from the
  // same summary text — must NOT show the warning, since the flag alone
  // doesn't mean the value actually on screen is the fallback.
  {
    const { window, document } = await loadPage();
    const payload = {
      summary: 'TOTAL EXPOSURE: $22,000\nRISK SCORE: 40/100',
      source: 'strategist',
      timestamp: Date.now(),
      // Strategist's own regex (slightly narrower alternation) somehow
      // missed and fell back to demo defaults, but the raw summary text
      // still has a real, portal-extractable number.
      exposure: '$91,800–$112,200',
      riskScore: '70/100',
      exposureDefaulted: true,
      riskScoreDefaulted: true,
    };
    window.populateFromRelay(payload);

    check('kpiExposure shows the value this portal itself extracted, not the flagged fallback', document.getElementById('kpiExposure').textContent.includes('22,000'));
    check('kpiExposureSub does NOT warn when the displayed value is not actually the fallback', document.getElementById('kpiExposureSub').textContent === 'financial liability');
    window.close();
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
