// Regression test for the SAP Strategist S/4HANA + FICO architect track.
// Run from repo root: node scripts/test-sap-s4-fico.js

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
console.log('SAP S/4HANA + FICO REGRESSION TEST');
console.log('========================================');

console.log('\n=== SOURCE INTEGRITY ===');

check(
  'SAP Strategist file exists',
  fs.existsSync(FILE)
);

check(
  'S/4HANA + FICO button exists',
  html.includes('id="s4FicoChallengeBtn"')
);

check(
  'S/4HANA + FICO challenge array exists',
  html.includes('const S4_FICO_CHALLENGES = [')
);

check(
  'specialized renderer exists',
  html.includes('function renderS4FicoChallenge(index)')
);

check(
  'specialized button handler exists',
  html.includes("document.getElementById('s4FicoChallengeBtn')")
);

console.log('\n=== CHALLENGE DEFINITIONS ===');

const script = extractScript(html);

const arrayMatch = script.match(
  /const S4_FICO_CHALLENGES = (\[[\s\S]*?\n    \]);/
);

if (!arrayMatch) {
  check('S4_FICO_CHALLENGES can be extracted', false);
  process.exit(1);
}

let challenges;

try {
  challenges = vm.runInNewContext(
    `(${arrayMatch[1]})`,
    {}
  );
  check('S4_FICO_CHALLENGES loads', Array.isArray(challenges));
} catch (err) {
  check('S4_FICO_CHALLENGES loads', false);
  console.error(err.message);
  process.exit(1);
}

check(
  'exactly 6 specialized stages',
  challenges.length === 6
);

const expectedStages = [
  'S/4HANA',
  'Sales Order',
  'Billing → FI',
  'AR / General Ledger',
  'CO / Cost Center',
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
  'The sales order creates the delivery, which leads to billing and a financial document.',
  'I would validate the sales order, customer, material and delivery relationship.',
  'I would trace the delivery to billing, FI and the accounting document.',
  'I would trace the accounting document into AR, the open item and the general ledger.',
  'I would validate the cost center, CO, cost posting and financial result.',
  'I would connect the sales order to billing, AR, GL and measurable business impact.'
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
  'id="s4FicoAnswer"',
  'id="s4FicoSubmitBtn"',
  'id="s4FicoHintBtn"',
  'id="s4FicoReasoningBtn"',
  'id="s4FicoFeedbackPanel"',
  'id="s4FicoPrevBtn"',
  'id="s4FicoNextBtn"',
  'id="s4FicoReturnBtn"'
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
console.log('S/4HANA + FICO specialized track regression checks passed.');
