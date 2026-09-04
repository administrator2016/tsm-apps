#!/usr/bin/env node
// Smoke test for the L1 Copilot ServiceNow batch-ticket-create flow, meant
// to be run against a real instance — your PDI first, then (once the admin
// grants access) the company's dev/sub-prod instance if one exists.
//
// This is the validation the unit tests (servicenow-batch.test.js) can't
// give you: it proves the code's mechanics work against a real Table API,
// not a local mock. It does NOT prove compatibility with a company
// instance's custom fields/business rules/ACLs — that still needs its own
// pass once you have real (non-PDI) credentials, per the plan discussed
// with the admin.
//
// USAGE:
//   SERVICENOW_INSTANCE_URL=https://devXXXXX.service-now.com \
//   SERVICENOW_USERNAME=admin \
//   SERVICENOW_PASSWORD=<your PDI password> \
//   node scripts/test-servicenow-batch-pdi.js
//
// Optional:
//   SERVICENOW_OAUTH_TOKEN=...   (use instead of USERNAME/PASSWORD)
//   BATCH_COUNT=5                (how many test incidents to create; default 5)
//   KEEP_RECORDS=1                (skip cleanup — leave created incidents in place for manual inspection)
//
// By default this script cleans up after itself (deletes every incident it
// creates) so repeated runs don't accumulate junk on the instance. It also
// intentionally creates ONE record with a missing mandatory field
// (short_description omitted) to confirm partial-failure handling works
// against a real instance's real validation errors, not just the mock's.
//
// Does NOT require SERVICENOW_INTEGRATION_ENABLED=true — that flag only
// gates server.js's HTTP routes; this script calls the adapter module
// directly, same as the unit tests do.

'use strict';

const adapter = require('../server/l1-copilot/servicenow-adapter');

function nowTag() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL;
  const oauthToken = process.env.SERVICENOW_OAUTH_TOKEN;
  const username = process.env.SERVICENOW_USERNAME;
  const password = process.env.SERVICENOW_PASSWORD;

  if (!instanceUrl || !(oauthToken || (username && password))) {
    console.error('Missing config. Required: SERVICENOW_INSTANCE_URL + either SERVICENOW_OAUTH_TOKEN or SERVICENOW_USERNAME/SERVICENOW_PASSWORD.');
    console.error('See the usage comment at the top of this file.');
    process.exit(1);
  }

  const config = {
    instanceUrl: instanceUrl.replace(/\/+$/, ''),
    username: username || '',
    password: password || '',
    oauthToken: oauthToken || '',
    fieldMap: adapter.DEFAULT_FIELD_MAP
  };

  const batchCount = parseInt(process.env.BATCH_COUNT || '5', 10);
  const keepRecords = process.env.KEEP_RECORDS === '1';
  const tag = nowTag();

  console.log(`Target instance: ${config.instanceUrl}`);
  console.log(`Creating ${batchCount} test incidents (tag l1-copilot-pdi-test-${tag})...`);

  const records = [];
  for (let i = 0; i < batchCount; i++) {
    records.push({
      short_description: `[L1 Copilot PDI test ${tag}] record ${i + 1} of ${batchCount}`,
      urgency: '3',
      impact: '3'
    });
  }
  // Deliberately break one record on purpose — real validation-error handling,
  // not the mock server's simulated one.
  records.push({ urgency: '3' }); // no short_description

  let result;
  try {
    result = await adapter.createTicketsBatch(records, { chunkSize: 3, delayBetweenChunksMs: 400 }, config);
  } catch (e) {
    console.error('Batch call threw (should only happen for config problems, not per-record failures):');
    console.error(e.message);
    process.exit(1);
  }

  console.log(`\nResult: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`);
  result.results.forEach(r => {
    if (r.success) {
      console.log(`  OK   #${r.index}  ${r.number}`);
    } else {
      console.log(`  FAIL #${r.index}  ${r.error}`);
    }
  });

  const expectedFailures = 1;
  if (result.failed !== expectedFailures) {
    console.warn(`\nExpected exactly ${expectedFailures} failure (the deliberately-broken record) but got ${result.failed}. Investigate before trusting this run as a clean validation.`);
  } else {
    console.log('\nExactly the deliberately-broken record failed — batch create + partial-failure handling both confirmed working against a real instance.');
  }

  const createdNumbers = result.results.filter(r => r.success).map(r => r.number);

  if (keepRecords || createdNumbers.length === 0) {
    if (createdNumbers.length) {
      console.log(`\nKEEP_RECORDS=1 set — leaving ${createdNumbers.length} test incident(s) in place: ${createdNumbers.join(', ')}`);
    }
    process.exit(result.failed === expectedFailures ? 0 : 1);
  }

  console.log(`\nCleaning up ${createdNumbers.length} test incident(s)...`);
  let cleanupFailures = 0;
  for (const number of createdNumbers) {
    try {
      await adapter.deleteTicket(number, config);
      console.log(`  deleted ${number}`);
    } catch (e) {
      cleanupFailures += 1;
      console.warn(`  could not delete ${number}: ${e.message}`);
    }
  }
  if (cleanupFailures) {
    console.warn(`\n${cleanupFailures} record(s) could not be auto-deleted — remove them manually from the instance.`);
  }

  process.exit(result.failed === expectedFailures && cleanupFailures === 0 ? 0 : 1);
}

main();
