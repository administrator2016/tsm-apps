#!/usr/bin/env node
// Smoke test for snAdapter.writeWorkNote — the append-only "post the
// drafted resolution as a work note" step. This is the one leg of the
// create -> read -> analyze -> append pipeline that hadn't been tested yet
// against a real instance.
//
// Flow:
//   1. Create one test incident.
//   2. Write a work note to it via writeWorkNote (this is a journal-field
//      APPEND on the ServiceNow side, not an overwrite — ServiceNow itself
//      guarantees that for work_notes, this script just confirms our call
//      into it actually lands).
//   3. Read the incident back and confirm the note text is present in
//      whatever ServiceNow returns for that field, so this isn't just
//      "the PATCH call didn't error" but "the data is actually there."
//   4. Attempt a SECOND work note, to confirm appends stack (both notes
//      present) rather than the second overwriting the first.
//   5. Clean up the test incident (best-effort — same caveat as the other
//      scripts: a locked-down service account may not have delete rights,
//      which is fine/expected, just means manual cleanup).
//
// USAGE:
//   SERVICENOW_INSTANCE_URL=https://dev396516.service-now.com \
//   SERVICENOW_USERNAME=admin \
//   SERVICENOW_PASSWORD='...' \
//   node scripts/test-worknote-pdi.js
//
// Optional:
//   KEEP_RECORDS=1   (skip cleanup)

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
    process.exit(1);
  }

  const config = {
    instanceUrl: instanceUrl.replace(/\/+$/, ''),
    username: username || '',
    password: password || '',
    oauthToken: oauthToken || '',
    fieldMap: adapter.DEFAULT_FIELD_MAP
  };

  const keepRecords = process.env.KEEP_RECORDS === '1';
  const tag = nowTag();
  let ok = true;

  console.log(`Target instance: ${config.instanceUrl}`);
  console.log(`Step 1/4: creating 1 test incident (tag l1-copilot-worknote-test-${tag})...`);

  let createResult;
  try {
    createResult = await adapter.createTicketsBatch(
      [{ short_description: `[L1 Copilot work-note test ${tag}]`, urgency: '3', impact: '3' }],
      { chunkSize: 1 },
      config
    );
  } catch (e) {
    console.error('Create call threw:', e.message);
    process.exit(1);
  }

  const created = createResult.results.find(r => r.success);
  if (!created) {
    console.error('Test incident was not created — cannot proceed.');
    console.error(createResult.results[0] && createResult.results[0].error);
    process.exit(1);
  }
  const incidentNumber = created.number;
  console.log(`  created ${incidentNumber}`);

  const firstNote = `[L1 Copilot draft ${tag}] First drafted resolution note — checking append works.`;
  const secondNote = `[L1 Copilot draft ${tag}] Second note — confirming this appends rather than overwriting the first.`;

  console.log(`\nStep 2/4: writing first work note to ${incidentNumber}...`);
  try {
    await adapter.writeWorkNote(incidentNumber, firstNote, config);
    console.log('  writeWorkNote call succeeded (no error thrown)');
  } catch (e) {
    console.error(`  writeWorkNote threw: ${e.message}`);
    ok = false;
  }

  console.log(`\nStep 3/4: reading ${incidentNumber} back to confirm the note is actually present...`);
  let afterFirst;
  try {
    afterFirst = await adapter.getTicket(incidentNumber, config);
  } catch (e) {
    console.error(`  getTicket threw: ${e.message}`);
    ok = false;
  }

  // getTicket() does not map work_notes into its returned object (it's not
  // in DEFAULT_FIELD_MAP.incident) — but the raw ServiceNow record it
  // fetches (ticket.raw) includes every field by default, since getTicket
  // never restricts the request with sysparm_fields. Read the journal
  // field from there instead. ServiceNow returns journal-style fields as
  // either a plain string or a { value, display_value } object depending
  // on sysparm_display_value; handle both.
  function readWorkNotes(ticket) {
    const raw = ticket && ticket.raw && ticket.raw.work_notes;
    if (raw == null) return null;
    return typeof raw === 'object' ? (raw.display_value ?? raw.value ?? null) : raw;
  }

  const workNotesField = readWorkNotes(afterFirst);
  if (workNotesField && String(workNotesField).includes(firstNote)) {
    console.log('  OK — first note text found in the incident\'s work_notes field.');
  } else if (workNotesField) {
    console.warn(`  work_notes field is present but does not contain the expected text. Raw value: ${JSON.stringify(workNotesField).slice(0, 300)}`);
    ok = false;
  } else {
    console.warn('  raw.work_notes came back empty/null — verify manually before trusting the append call:');
    console.warn(`    ${config.instanceUrl}/incident_list.do?sysparm_query=number=${incidentNumber}`);
    ok = false;
  }

  console.log(`\nStep 4/4: writing a second work note to confirm appends stack (not overwrite)...`);
  try {
    await adapter.writeWorkNote(incidentNumber, secondNote, config);
    const afterSecond = await adapter.getTicket(incidentNumber, config);
    const field2 = readWorkNotes(afterSecond);
    const text = String(field2 || '');
    if (text.includes(firstNote) && text.includes(secondNote)) {
      console.log('  OK — both notes present, confirming append (not overwrite) behavior.');
    } else if (field2) {
      console.warn('  Only one note (or neither) found after the second write — check manually before trusting append behavior:');
      console.warn(`    ${config.instanceUrl}/incident_list.do?sysparm_query=number=${incidentNumber}`);
      ok = false;
    } else {
      console.warn('  getTicket() does not appear to return work_notes text — verify append behavior manually in the UI.');
    }
  } catch (e) {
    console.error(`  Second writeWorkNote threw: ${e.message}`);
    ok = false;
  }

  console.log(`\nCleanup:`);
  if (keepRecords) {
    console.log(`KEEP_RECORDS=1 set — leaving ${incidentNumber} in place for manual inspection.`);
    process.exit(ok ? 0 : 1);
  }
  try {
    await adapter.deleteTicket(incidentNumber, config);
    console.log(`  deleted ${incidentNumber}`);
  } catch (e) {
    console.warn(`  could not delete ${incidentNumber} (${e.message}) — remove it manually:`);
    console.warn(`    ${config.instanceUrl}/incident_list.do?sysparm_query=number=${incidentNumber}`);
  }

  process.exit(ok ? 0 : 1);
}

main();
