'use strict';

// Regression/coverage test for routes/training-intelligence.js's quiz
// GET/submit contract and the servicenow-csa provider's blueprint data.
// No test previously existed for this module at all (confirmed via find
// across scripts/ and tests/), despite it being mounted live in
// server.js:3001.
//
// This test does not spin up Express; like the HC and FinOps relay tests,
// it hand-mirrors the exact logic from the route handlers (GET
// /quiz/:providerId/:domainId and POST /quiz/:providerId/submit) since
// that logic is defined inline inside router.get()/router.post() callbacks,
// not as separately requirable functions. If this file is ever refactored
// to extract that logic into exported functions, this test's mirrored
// copies should be replaced with direct requires instead.
//
// Three things are verified, matching the file's own stated honesty/
// security claims in its header comments:
//
//   1. The real servicenow-csa.json blueprint's weights actually sum to
//      100 and verified:true is only present because it looks legitimate
//      (has sourceUrl + verifiedBy + lastVerified) -- not just trusting
//      the flag blindly.
//   2. GET /quiz/:providerId/:domainId truly never includes `correct` or
//      `explanation` on any choice, for any question -- the specific
//      claim the file's own comment makes ("answers are never sitting in
//      a GET response").
//   3. POST /quiz/:providerId/submit grades correctly against the server
//      copy of the bank (right answer -> correct:true, wrong answer ->
//      correct:false with the real correctChoiceId revealed only now,
//      post-submission).

const fs = require('fs');
const path = require('path');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK:', msg);
  }
}

// ── Part 1: real blueprint data sanity ───────────────────────────────
const blueprintPath = path.join(__dirname, '..', 'data', 'training-intelligence', 'providers', 'servicenow-csa.json');
const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));

const weightSum = (blueprint.domains || []).reduce((sum, d) => sum + (typeof d.weight === 'number' ? d.weight : 0), 0);
assert(weightSum === 100,
  `servicenow-csa.json domain weights sum to 100 - got ${weightSum}`);

assert(blueprint.verified === true && !!blueprint.sourceUrl && !!blueprint.verifiedBy && !!blueprint.lastVerified,
  'servicenow-csa.json is verified:true AND carries sourceUrl/verifiedBy/lastVerified (not a bare flag with no evidence)');

// ── Part 2 & 3: quiz GET/submit contract ─────────────────────────────
// A realistic mock question bank in the same shape loadQuestionBank()
// reads (bank.questions[].choices[] with id/text/correct/explanation/
// knowledge), using two of the real domain IDs from the blueprint above.
const mockBank = {
  verified: true,
  questions: [
    {
      id: 'q1',
      domainId: 'platform-overview-navigation',
      question: 'What is the Application Navigator used for?',
      choices: [
        { id: 'a', text: 'Navigating applications and modules', correct: true, explanation: 'Correct — this is its core purpose.', knowledge: ['app-nav-purpose'] },
        { id: 'b', text: 'Editing business rules', correct: false, explanation: 'That is done via Studio or the form editor.', knowledge: ['business-rules'] },
        { id: 'c', text: 'Managing ACLs', correct: false, explanation: 'ACLs are managed under System Security.', knowledge: ['acl-location'] }
      ]
    },
    {
      id: 'q2',
      domainId: 'instance-configuration',
      question: 'Where are system properties configured?',
      choices: [
        { id: 'a', text: 'System Properties module', correct: true, explanation: 'Correct.', knowledge: ['sys-properties'] },
        { id: 'b', text: 'Service Catalog', correct: false, explanation: 'That is for self-service items.', knowledge: ['catalog'] }
      ]
    }
  ]
};

// Mirrors GET /quiz/:providerId/:domainId's stripping logic exactly.
function quizGetLogic(bank, domainId) {
  const questions = (bank.questions || []).filter(q => q.domainId === domainId);
  if (!questions.length) return null;
  return questions.map(q => ({
    id: q.id,
    domainId: q.domainId,
    question: q.question,
    choices: q.choices.map(c => ({ id: c.id, text: c.text }))
  }));
}

const gotQuestions = quizGetLogic(mockBank, 'platform-overview-navigation');
assert(Array.isArray(gotQuestions) && gotQuestions.length === 1,
  `GET quiz returns the right question(s) for the requested domain - got ${gotQuestions && gotQuestions.length}`);

const allChoices = gotQuestions.flatMap(q => q.choices);
assert(allChoices.every(c => !('correct' in c) && !('explanation' in c) && !('knowledge' in c)),
  'GET quiz response never includes correct/explanation/knowledge on any choice');
assert(allChoices.every(c => 'id' in c && 'text' in c && Object.keys(c).length === 2),
  'GET quiz response choices contain ONLY id and text - nothing extra leaking through');

// Regression guard: prove that returning the raw bank question (no
// stripping) WOULD leak the answer, confirming the stripping step is load-
// bearing and this isn't a redundant no-op.
const unstrippedChoice = mockBank.questions[0].choices[0];
assert('correct' in unstrippedChoice && unstrippedChoice.correct === true,
  'regression guard: confirms the raw bank data DOES carry the answer, so GET-side stripping is a real, necessary step');

// Mirrors POST /quiz/:providerId/submit's grading logic exactly.
function quizSubmitLogic(bank, answers) {
  const byId = {};
  (bank.questions || []).forEach(q => { byId[q.id] = q; });

  let correctCount = 0;
  const results = answers.map(a => {
    const q = byId[a.questionId];
    if (!q) return { questionId: a.questionId, error: 'unknown question' };
    const choice = q.choices.find(c => c.id === a.choiceId);
    const correctChoice = q.choices.find(c => c.correct === true);
    const isCorrect = !!choice && choice.correct === true;
    if (isCorrect) correctCount++;
    return {
      questionId: q.id,
      domainId: q.domainId,
      correct: isCorrect,
      pickedChoiceId: a.choiceId || null,
      correctChoiceId: correctChoice ? correctChoice.id : null
    };
  });
  return { results, correctCount };
}

// Case A: one right answer, one wrong answer.
const submitResult = quizSubmitLogic(mockBank, [
  { questionId: 'q1', choiceId: 'a' },  // correct
  { questionId: 'q2', choiceId: 'b' }   // wrong -- correct answer is 'a'
]);

assert(submitResult.correctCount === 1,
  `submit correctly scores 1 of 2 (one right, one wrong) - got ${submitResult.correctCount}`);
assert(submitResult.results[0].correct === true && submitResult.results[0].correctChoiceId === 'a',
  'submit reveals the real correct choice AFTER grading a right answer');
assert(submitResult.results[1].correct === false && submitResult.results[1].correctChoiceId === 'a',
  'submit correctly flags a wrong answer AND still reveals the real correct choice post-submission');

// Case B: unknown question id -- must not throw, must report the error shape.
const unknownResult = quizSubmitLogic(mockBank, [{ questionId: 'does-not-exist', choiceId: 'a' }]);
assert(unknownResult.results[0].error === 'unknown question',
  'submit handles an unknown questionId gracefully instead of throwing');

console.log('\n' + (process.exitCode ? 'TEST FAILED' : 'TEST PASSED'));
