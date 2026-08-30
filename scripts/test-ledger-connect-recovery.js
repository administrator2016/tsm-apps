'use strict';

// Regression test for the connect()/connecting bug fixed alongside the
// connectTimeoutMS/socketTimeoutMS addition in server/tsm-ledger-service.js.
//
// Before the fix: a failed client.connect() left `connecting` pointing at
// the rejected promise forever — every future call to any ledger route
// would keep re-awaiting that same rejection instead of retrying, so one
// transient network blip permanently wedged the ledger for the rest of
// the process's life (only a restart would clear it).
//
// After the fix: a failed attempt resets `client`/`connecting` to null,
// so the next call gets a fresh connect() attempt.

let connectCallCount = 0;
let shouldFail = true;

class FakeMongoClient {
  constructor() {}
  async connect() {
    connectCallCount += 1;
    if (shouldFail) throw new Error('simulated stalled/failed connection');
    return this;
  }
  db() {
    return { collection: (name) => ({
      async findOne() { return null; },
      find() { return { sort: () => this, limit: () => this, toArray: async () => [] }; },
    }) };
  }
}

const mongodbPath = require.resolve('mongodb');
require.cache[mongodbPath] = {
  id: mongodbPath,
  filename: mongodbPath,
  loaded: true,
  exports: { MongoClient: FakeMongoClient },
};

process.env.MONGODB_URI = 'mongodb://fake-host/test?loadBalanced=true';

const tsmLedger = require('/home/claude/tsm-apps/server/tsm-ledger-service.js');

(async () => {
  let firstCallFailed = false;
  try {
    await tsmLedger.bpoGetCase('does-not-matter');
  } catch (e) {
    firstCallFailed = true;
  }

  // Simulate the network recovering, then try again without restarting the process.
  shouldFail = false;
  let secondCallSucceeded = false;
  try {
    await tsmLedger.bpoGetCase('does-not-matter');
    secondCallSucceeded = true;
  } catch (e) {
    secondCallSucceeded = false;
  }

  const checks = [
    ['first call failed as expected', firstCallFailed, true],
    ['second call (after recovery) succeeded without restart', secondCallSucceeded, true],
    ['connect() was actually retried, not served from a cached rejection', connectCallCount, 2],
  ];

  console.log('=== connect() recovery-after-failure regression test ===\n');
  let allPass = true;
  for (const [label, actual, expected] of checks) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    if (!pass) allPass = false;
    console.log(`${pass ? '✅' : '❌'} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  console.log('\n' + (allPass ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'));
  process.exit(allPass ? 0 : 1);
})();
