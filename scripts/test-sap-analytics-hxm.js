// Regression test for the SAP Strategist Analytics + HXM architect track.
// Run from repo root: node scripts/test-sap-analytics-hxm.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(
  __dirname,
  '..',
  'html',
  'war-rooms',
  'sap',
  'sap-strategist.html'
);

const html = fs.readFileSync(FILE, 'utf8');

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

function extractScript(source) {
  const match = source.match(
    /<script>([\s\S]*?)<\/script>\s*<\/body>/
  );

  if (!match) {
    throw new Error('Could not locate SAP Strategist inline script');
  }

  return match[1];
}

function normalizeInterviewText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('========================================');
console.log('SAP Analytics + HXM REGRESSION TEST');
console.log('========================================');

console.log('\n=== SOURCE INTEGRITY ===');

check(
  'SAP Strategist file exists',
  fs.existsSync(FILE)
);

check(
  'Analytics + HXM button exists',
  html.includes('id="analyticsHxmChallengeBtn"')
);

check(
  'Analytics + HXM challenge array exists',
  html.includes('const ANALYTICS_HXM_CHALLENGES = [')
);

check(
  'specialized renderer exists',
  html.includes('function renderS4FicoChallenge(index)')
);

check(
  'specialized button handler exists',
  html.includes("document.getElementById('analyticsHxmChallengeBtn')")
);

console.log('\n=== CHALLENGE DEFINITIONS ===');

const script = extractScript(html);

const arrayMatch = script.match(
  new RegExp("const ANALYTICS_HXM_CHALLENGES = (\\[[\\s\\S]*?\\]);")
);

if (!arrayMatch) {
  check('ANALYTICS_HXM_CHALLENGES can be extracted', false);
  process.exit(1);
}

let challenges;

try {
  challenges = vm.runInNewContext(
    `(${arrayMatch[1]})`,
    {}
  );
  check('ANALYTICS_HXM_CHALLENGES loads', Array.isArray(challenges));
} catch (err) {
  check('ANALYTICS_HXM_CHALLENGES loads', false);
  console.error(err.message);
  process.exit(1);
}

check(
  'exactly 8 specialized stages',
  challenges.length === 8
);

const expectedStages = [
  'BW/4HANA',
  'Data Model / Provider',
  'Extraction → Transformation',
  'Reporting / Analytics',
  'Employee Data',
  'HR Process / Workflow',
  'Integration',
  'Business Impact'
];

challenges.forEach((challenge, index) => {
  check(
    `Stage ${index + 1}: ${challenge.title}`,
    challenge.stage === expectedStages[index] &&
    Array.isArray(challenge.expected) &&
    challenge.expected.length >= 4 &&
    typeof challenge.scenario === 'string' &&
    challenge.scenario.length > 40
  );
});

console.log('\n=== DETERMINISTIC SCORING ===');

const testAnswers = [
  'I would trace BW/4HANA, the data warehouse and source data through the data flow.',
  'I would validate the data model, provider, business object and analytical data.',
  'I would trace extraction, transformation, loading and the source system.',
  'I would compare the reporting and analytics definition, business metric and data model.',
  'I would validate SuccessFactors, employee data and the employee record synchronization.',
  'I would trace the HR process, workflow, employee data and workflow state.',
  'I would trace SuccessFactors, BW/4HANA, integration and employee data.',
  'I would connect employee data, BW/4HANA, reporting and business impact.'
];

testAnswers.forEach((answer, index) => {
  const challenge = challenges[index];
  const normalized = normalizeInterviewText(answer);

  const matched = challenge.expected.filter(term =>
    normalized.includes(normalizeInterviewText(term))
  );

  const coverage = Math.round(
    (matched.length / challenge.expected.length) * 100
  );

  check(
    `Stage ${index + 1} scoring: ${coverage}%`,
    coverage === 100
  );
});

console.log('\n=== SPECIALIZED UI CONTROLS ===');

[
  'id="challengePanel"',
  'id="analyticsHxmAnswer"',
  'id="analyticsHxmSubmitBtn"',
  'id="analyticsHxmHintBtn"',
  'id="analyticsHxmReasoningBtn"',
  'id="analyticsHxmFeedbackPanel"',
  'id="analyticsHxmPrevBtn"',
  'id="analyticsHxmNextBtn"',
  'id="analyticsHxmReturnBtn"'
].forEach((id) => {
  check(`${id} present in specialized renderer`, html.includes(id));
});

console.log('\n=== ORIGINAL SAP REGRESSION ===');

const originalMatch = script.match(
  /const INTERVIEW_CHALLENGES = (\[[\s\S]*?\n    \]);/
);

if (!originalMatch) {
  check('original INTERVIEW_CHALLENGES preserved', false);
} else {
  let originalChallenges;

  try {
    originalChallenges = vm.runInNewContext(
      `(${originalMatch[1]})`,
      {}
    );

    check(
      'original challenge count remains 8',
      originalChallenges.length === 8
    );

    check(
      'original challenge renderer preserved',
      html.includes('function renderInterviewChallenge(index)')
    );

    check(
      'original challenge button preserved',
      html.includes('id="challengeBtn"')
    );
  } catch (err) {
    check('original INTERVIEW_CHALLENGES loads', false);
    console.error(err.message);
  }
}

console.log('\n=== RESULT ===');

console.log(`PASS: ${passed}`);
console.log(`FAIL: ${failed}`);

if (failed > 0) {
  console.error('\nRESULT: FAIL');
  process.exit(1);
}

console.log('\nRESULT: PASS');
console.log('Analytics + HXM specialized track regression checks passed.');
