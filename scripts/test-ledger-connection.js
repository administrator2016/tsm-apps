'use strict';

require('dotenv').config();

const ledger = require('../server/tsm-ledger-service');

const TEST_MISSION_ID = '__ledger_connection_test__';

async function main() {
  console.log('=== CANONICAL LEDGER CONNECTION TEST ===');

  console.log('\n1. Creating test mission...');
  const mission = await ledger.paResetMission(
    TEST_MISSION_ID,
    {
      property: 'Connection Test Property',
      period: '2026-08',
      budget: 1000,
      actual: 0,
    }
  );

  if (!mission || mission.missionId !== TEST_MISSION_ID) {
    throw new Error('Failed to create test mission');
  }

  console.log('   OK:', mission);

  console.log('\n2. Reading mission back...');
  const loaded = await ledger.paGetMission(TEST_MISSION_ID);

  if (!loaded || loaded.missionId !== TEST_MISSION_ID) {
    throw new Error('Failed to read test mission');
  }

  console.log('   OK:', loaded);

  console.log('\n3. Updating budget...');
  const updatedBudget = await ledger.paUpdateBudget(
    TEST_MISSION_ID,
    2500
  );

  if (!updatedBudget || Number(updatedBudget.budget) !== 2500) {
    throw new Error('Budget update failed');
  }

  console.log('   OK: budget =', updatedBudget.budget);

  console.log('\n4. Adjusting actual...');
  const updatedActual = await ledger.paAdjustActual(
    TEST_MISSION_ID,
    400
  );

  if (!updatedActual || Number(updatedActual.actual) !== 400) {
    throw new Error('Actual adjustment failed');
  }

  console.log('   OK: actual =', updatedActual.actual);

  console.log('\n5. Posting GL debit...');
  const debit = await ledger.paPostGlEntry(
    TEST_MISSION_ID,
    {
      date: '2026-08-28',
      account: 'Construction Expense',
      type: 'debit',
      amount: 400,
      description: 'Canonical ledger connection test',
    }
  );

  if (!debit || debit.missionId !== TEST_MISSION_ID) {
    throw new Error('GL debit failed');
  }

  console.log('   OK:', debit);

  console.log('\n6. Posting GL credit...');
  const credit = await ledger.paPostGlEntry(
    TEST_MISSION_ID,
    {
      date: '2026-08-28',
      account: 'Cash',
      type: 'credit',
      amount: 400,
      description: 'Canonical ledger connection test',
    }
  );

  if (!credit || credit.missionId !== TEST_MISSION_ID) {
    throw new Error('GL credit failed');
  }

  console.log('   OK:', credit);

  console.log('\n7. Reading GL entries...');
  const entries = await ledger.paListGlEntries(TEST_MISSION_ID);

  if (entries.length !== 2) {
    throw new Error(`Expected 2 GL entries, got ${entries.length}`);
  }

  console.log('   OK: found', entries.length, 'entries');

  console.log('\n8. Cleaning up test mission...');
  await ledger.paResetMission(
    TEST_MISSION_ID,
    {
      property: 'Connection Test Property',
      period: '2026-08',
      budget: 1000,
      actual: 0,
    }
  );

  // paResetMission recreates the mission, so remove it explicitly.
  const db = await ledger.getDb();
  await db.collection('pa_gl_entries').deleteMany({
    missionId: TEST_MISSION_ID,
  });
  await db.collection('pa_ap_invoices').deleteMany({
    missionId: TEST_MISSION_ID,
  });
  await db.collection('pa_missions').deleteOne({
    missionId: TEST_MISSION_ID,
  });

  console.log('   OK: test data removed');

  await ledger.close();

  console.log('\n==========================================');
  console.log('ALL CANONICAL LEDGER CHECKS PASSED');
  console.log('==========================================');
}

main().catch(async (err) => {
  console.error('\n==========================================');
  console.error('CANONICAL LEDGER TEST FAILED');
  console.error('==========================================');
  console.error(err);

  try {
    await ledger.close();
  } catch (_) {}

  process.exit(1);
});
