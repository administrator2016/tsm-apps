'use strict';

const BASE_URL = process.env.INTERVIEW_BASE_URL || 'http://localhost:3000';

const CASES = [
  ['mortgage', 'ops-analyst', 'Mortgage Operations Analyst'],
  ['healthcare-rcm', 'rcm-analyst', 'RCM Analyst'],
  ['insurance', 'claims-analyst', 'Claims Analyst'],
  ['finops-ai', 'operations-analyst', 'Operations Analyst'],
  ['automation-it', 'l1-support', 'L1 IT Support Technician'],
];

async function main() {
  let failures = 0;

  console.log('=== LIVE INTERVIEW PLAN API TEST ===');
  console.log('Base URL:', BASE_URL);

  for (const [sectorId, roleId, expectedRole] of CASES) {
    const url =
      `${BASE_URL}/api/interview/sectors/` +
      `${encodeURIComponent(sectorId)}/plan?roleId=${encodeURIComponent(roleId)}`;

    console.log(`\n=== ${sectorId} / ${roleId} ===`);

    try {
      const res = await fetch(url);
      const text = await res.text();

      if (!res.ok) {
        console.log(`FAIL — HTTP ${res.status}`);
        console.log(text.slice(0, 500));
        failures++;
        continue;
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        console.log('FAIL — response was not JSON');
        console.log(text.slice(0, 500));
        failures++;
        continue;
      }

      const plan = data && data.plan;

      if (!plan) {
        console.log('FAIL — response has no plan');
        failures++;
        continue;
      }

      const questions = Array.isArray(plan.questions)
        ? plan.questions
        : [];

      const counts = questions.reduce((acc, q) => {
        acc[q.type] = (acc[q.type] || 0) + 1;
        return acc;
      }, {});

      let caseFailed = false;

      if (questions.length !== 6) {
        console.log(`FAIL — expected 6 questions, got ${questions.length}`);
        caseFailed = true;
      }

      for (const type of ['knowledge', 'scenario', 'business']) {
        if (counts[type] !== 2) {
          console.log(
            `FAIL — expected 2 ${type} questions, got ${counts[type] || 0}`
          );
          caseFailed = true;
        }
      }

      const actualRole = plan.role && plan.role.name;

      if (actualRole !== expectedRole) {
        console.log(
          `FAIL — expected role "${expectedRole}", got "${actualRole}"`
        );
        caseFailed = true;
      }

      const ids = questions.map(q => q.id);
      const duplicateIds = ids.filter(
        (id, index) => ids.indexOf(id) !== index
      );

      if (duplicateIds.length) {
        console.log(
          `FAIL — duplicate question IDs: ${duplicateIds.join(', ')}`
        );
        caseFailed = true;
      }

      if (caseFailed) {
        failures++;
        continue;
      }

      console.log('PASS — HTTP 200');
      console.log(`PASS — ${questions.length} questions`);
      console.log(`PASS — role: ${actualRole}`);
      console.log(
        `PASS — levels: knowledge=${counts.knowledge}, ` +
        `scenario=${counts.scenario}, business=${counts.business}`
      );
      console.log('PASS — question IDs unique');
    } catch (err) {
      console.log(`FAIL — request error: ${err.message}`);
      failures++;
    }
  }

  console.log('\n=== RESULT ===');

  if (failures === 0) {
    console.log('PASS — 5/5 interview plans healthy');
    process.exit(0);
  }

  console.log(`FAIL — ${failures}/5 cases failed`);
  process.exit(1);
}

main();
