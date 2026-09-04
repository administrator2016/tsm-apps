#!/usr/bin/env node
// Smoke test for the L1 Copilot ServiceNow batch-ticket-READ flow
// (snAdapter.getTicketsBatch), meant to be run against a real instance —
// your PDI first, then the company's dev/sub-prod instance once the admin
// grants access.
//
// This is the read-side counterpart to test-servicenow-batch-pdi.js (which
// only proves batch CREATE). It proves getTicketsBatch's chunking/retry/
// partial-failure mechanics work against a real Table API, not a mock.
//
// By default this script creates its own small batch of test incidents
// first (so it has real, known incident numbers to read back), reads them
// back in a batch, deliberately includes one bogus incident number to
// confirm partial-failure handling on the read side works against real
// "not found" responses, then cleans up the incidents it created.
//
// USAGE:
//   SERVICENOW_INSTANCE_URL=https://devXXXXX.service-now.com \
//   SERVICENOW_USERNAME=admin \
//   SERVICENOW_PASSWORD=<your PDI password> \
//   node scripts/test-servicenow-batch-read-pdi.js
//
// Optional:
//   SERVICENOW_OAUTH_TOKEN=...   (use instead of USERNAME/PASSWORD)
//   BATCH_COUNT=5                (how many test incidents to create+read; default 5)
//   KEEP_RECORDS=1                (skip cleanup — leave created incidents in place)
//
// Does NOT require SERVICENOW_INTEGRATION_ENABLED=true — same as the
// create-side script, this calls the adapter module directly.

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
  console.log(`Step 1/3: creating ${batchCount} test incidents to read back (tag l1-copilot-read-test-${tag})...`);

  const createRecords = [];
  for (let i = 0; i < batchCount; i++) {
    createRecords.push({
      short_description: `[L1 Copilot READ test ${tag}] record ${i + 1} of ${batchCount}`,
      urgency: '3',
      impact: '3'
    });
  }

  let createResult;
  try {
    createResult = await adapter.createTicketsBatch(createRecords, { chunkSize: 3, delayBetweenChunksMs: 400 }, config);
  } catch (e) {
    console.error('Setup batch-create call threw — cannot proceed to the read test:');
    console.error(e.message);
    process.exit(1);
  }

  const createdNumbers = createResult.results.filter(r => r.success).map(r => r.number);
  if (createdNumbers.length === 0) {
    console.error('No test incidents were created successfully — cannot proceed to the read test.');
    process.exit(1);
  }
  console.log(`  created ${createdNumbers.length}/${batchCount}: ${createdNumbers.join(', ')}`);

  // Deliberately include one incident number that does not exist, to confirm
  // getTicketsBatch reports a per-record "not found" failure instead of
  // throwing and aborting the whole batch.
  const bogusNumber = `INC9999999-${tag}`;
  const readTargets = [...createdNumbers, bogusNumber];

  console.log(`\nStep 2/3: reading back ${readTargets.length} incidents in one batch call (including 1 deliberately bogus number)...`);

  let readResult;
  try {
    readResult = await adapter.getTicketsBatch(readTargets, { chunkSize: 3, delayBetweenChunksMs: 400 }, config);
  } catch (e) {
    console.error('Batch read call threw (should only happen for config problems, not per-record failures):');
    console.error(e.message);
    process.exit(1);
  }

  console.log(`\nResult: ${readResult.succeeded}/${readResult.total} succeeded, ${readResult.failed} failed`);
  readResult.results.forEach(r => {
    if (r.success) {
      console.log(`  OK   #${r.index}  ${r.incidentId}  -> ${r.ticket.number}  priority=${r.ticket.priority}  state=${r.ticket.state}`);
    } else {
      console.log(`  FAIL #${r.index}  ${r.incidentId}  ${r.error}`);
    }
  });

  const expectedFailures = 1;
  let readOk = true;
  if (readResult.failed !== expectedFailures) {
    console.warn(`\nExpected exactly ${expectedFailures} failure (the deliberately bogus incident number) but got ${readResult.failed}. Investigate before trusting this run as a clean validation.`);
    readOk = false;
  } else {
    console.log('\nExactly the deliberately-bogus incident failed — batch read + partial-failure handling both confirmed working against a real instance.');
  }

  // Sanity-check that what came back for the real incidents actually matches
  // what we created (not just "some record", but the right one).
  const realResults = readResult.results.filter(r => r.incidentId !== bogusNumber);
  const mismatched = realResults.filter(r => !r.success || !r.ticket || r.ticket.number !== r.incidentId);
  if (mismatched.length) {
    console.warn(`\n${mismatched.length} of the real incidents did not read back cleanly (wrong/missing ticket data) — investigate before trusting this run.`);
    readOk = false;
  } else {
    console.log('All real incidents read back with matching incident numbers.');
  }

  console.log(`\nStep 3/3: cleanup`);
  if (keepRecords) {
    console.log(`KEEP_RECORDS=1 set — leaving ${createdNumbers.length} test incident(s) in place: ${createdNumbers.join(', ')}`);
    process.exit(readOk ? 0 : 1);
  }

  console.log(`Cleaning up ${createdNumbers.length} test incident(s)...`);
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

  process.exit(readOk && cleanupFailures === 0 ? 0 : 1);
}

main();
