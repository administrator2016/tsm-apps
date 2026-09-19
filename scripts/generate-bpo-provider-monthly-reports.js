#!/usr/bin/env node
// scripts/generate-bpo-provider-monthly-reports.js
//
// Generates and persists the Phase 13 Provider Reporting snapshot (client +
// internal projections) for every active client, via bpoSaveProviderSnapshot
// -- which calls the same bpoBuildProviderReport the live API, dashboard and
// PDF use, so a snapshot never disagrees with the live report about how
// anything is calculated.
//
// Like the Phase 4 generator, this does not schedule itself; run it
// manually or from whatever scheduler you wire up (Fly Machines schedule,
// GitHub Actions cron). Typically run early in the month for the month
// that just ended.
//
// Usage:
//   node scripts/generate-bpo-provider-monthly-reports.js
//   node scripts/generate-bpo-provider-monthly-reports.js --period=2026-08
//   node scripts/generate-bpo-provider-monthly-reports.js --client-id=acme-co

require('dotenv').config();
const ledger = require('../server/tsm-ledger-service');

const args = process.argv.slice(2);
const periodArg = args.find(a => a.startsWith('--period='));
const clientIdArg = args.find(a => a.startsWith('--client-id='));
const period = periodArg ? periodArg.split('=')[1] : undefined;
const onlyClientId = clientIdArg ? clientIdArg.split('=')[1] : null;

async function main() {
  const clients = onlyClientId ? [{ id: onlyClientId }] : await ledger.bpoListClients({ status: 'active' });
  if (!clients.length) { console.log('No active clients found -- nothing to generate.'); return; }

  console.log(`Generating provider report snapshot${period ? ` for ${period}` : ' (current period)'} for ${clients.length} client(s)...\n`);
  let succeeded = 0;
  let failed = 0;
  for (const client of clients) {
    const clientId = client.id || client.clientId;
    try {
      const snap = await ledger.bpoSaveProviderSnapshot(clientId, period, 'provider-report-script');
      const es = snap.views.client.executiveSummary;
      console.log(`  OK   ${clientId} — ${snap.periodLabel}: ${es ? es.headline : 'saved'}`);
      succeeded++;
    } catch (e) {
      console.log(`  FAIL ${clientId} — ${e.message}`);
      failed++;
    }
  }
  console.log(`\n${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
