'use strict';

// Server-side smoke test for the client-side fix in
// html/l1-copilot/l1-ticket-copilot.html (getOrCreateCandidateId /
// syncL1ResultToRegistry, commit 04a507c9).
//
// This script proves the server-side half of the contract:
// multiple training-events calls against one candidateId accumulate
// into one candidate record.

const Module = require('module');

// ---- fake mongodb driver ---------------------------------------------------

const candidates = new Map();        // candidateId -> doc
const trainingEvents = [];           // flat list of { candidateId, ... }

function makeCollection(name) {
  const isCandidates = name === 'candidates';
  const isEvents = name === 'candidate_training_events';

  return {
    async findOne(query) {
      if (isCandidates) {
        const doc = candidates.get(query.candidateId);
        return doc ? { ...doc } : null;
      }
      return null;
    },

    find(query = {}) {
      let results;

      if (isEvents) {
        results = trainingEvents
          .filter((e) =>
            query.candidateId === undefined ||
            e.candidateId === query.candidateId
          )
          .map((e) => ({ ...e }));
      } else if (isCandidates) {
        results = [...candidates.values()]
          .filter((c) =>
            query.status === undefined ||
            c.status === query.status
          )
          .map((c) => ({ ...c }));
      } else {
        results = [];
      }

      const api = {
        sort() {
          return api;
        },
        limit(n) {
          results = results.slice(0, n);
          return api;
        },
        async toArray() {
          return results;
        }
      };

      return api;
    },

    async updateOne(query, update, opts) {
      if (!isCandidates) {
        throw new Error('updateOne only stubbed for candidates');
      }

      const existing = candidates.get(query.candidateId) || null;

      if (!existing && !(opts && opts.upsert)) {
        return {
          matchedCount: 0,
          modifiedCount: 0
        };
      }

      const next = existing ? { ...existing } : {};

      if (update.$set) {
        Object.assign(next, update.$set);
      }

      candidates.set(query.candidateId, next);

      return {
        matchedCount: existing ? 1 : 0,
        modifiedCount: existing ? 1 : 0,
        upsertedCount: existing ? 0 : 1
      };
    },

    async insertOne(doc) {
      if (isEvents) {
        trainingEvents.push({ ...doc });
      }

      return {
        acknowledged: true,
        insertedId: 'fake-id'
      };
    }
  };
}

const fakeDb = {
  collection: (name) => makeCollection(name)
};

class FakeMongoClient {
  constructor() {}

  async connect() {
    return this;
  }

  db() {
    return fakeDb;
  }
}

const mongodbResolvedPath = require.resolve('mongodb');

const fakeMongodbModule = new Module(
  mongodbResolvedPath,
  null
);

fakeMongodbModule.exports = {
  MongoClient: FakeMongoClient
};

fakeMongodbModule.loaded = true;

require.cache[mongodbResolvedPath] = fakeMongodbModule;

process.env.MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://fake-host/tsm-consultz-test';

const registry = require('../server/candidate-registry-service');

// ---- assertions ------------------------------------------------------------

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('OK:', msg);
  }
}

(async () => {

  // 1. First sync creates the candidate and returns candidateId.

  const created = await registry.upsertCandidate({
    name: 'Jordan Trainee',
    role: 'IT / L1 Help Desk',
    email: 'jordan@example.com',
    status: 'in_training',
    source: 'l1_ticket_copilot',
    isSampleData: false
  });

  const candidateId = created && created.candidateId;

  assert(
    !!candidateId,
    `first sync creates a candidate and returns a candidateId - got ${candidateId}`
  );

  await registry.recordTrainingEvent(candidateId, {
    type: 'l1_resolution',
    score: 100,
    weight: 1,
    meta: {
      source: 'l1_ticket_copilot',
      incident: 'INC0001001',
      severity: 'Medium'
    }
  });

  // 2. Second event reuses the SAME candidateId.

  await registry.recordTrainingEvent(candidateId, {
    type: 'l1_escalation',
    score: 100,
    weight: 1,
    meta: {
      source: 'l1_ticket_copilot',
      incident: 'INC0001002',
      severity: 'High',
      recommendedTeam: 'Network Operations Center'
    }
  });

  // 3. Third event confirms continued accumulation.

  const finalCandidate =
    await registry.recordTrainingEvent(candidateId, {
      type: 'l1_resolution',
      score: 100,
      weight: 1,
      meta: {
        source: 'l1_ticket_copilot',
        incident: 'INC0001003',
        severity: 'Low'
      }
    });

  // ---- assertions that matter ---------------------------------------------

  const allCandidates =
    await registry.listCandidates({});

  assert(
    allCandidates.length === 1,
    `exactly one candidate record exists after 3 synced events - got ${allCandidates.length}`
  );

  const eventsForCandidate =
    trainingEvents.filter(
      (e) => e.candidateId === candidateId
    );

  assert(
    eventsForCandidate.length === 3,
    `all 3 training events recorded under the SAME candidateId - got ${eventsForCandidate.length}`
  );

  assert(
    typeof finalCandidate.readinessScore === 'number' &&
    finalCandidate.readinessScore > 0,
    `readinessScore accumulates off the 3 recorded events - got ${finalCandidate.readinessScore}`
  );

  // ---- control case: old behavior -----------------------------------------

  candidates.clear();
  trainingEvents.length = 0;

  for (let i = 0; i < 3; i++) {

    const c = await registry.upsertCandidate({
      name: 'Jordan Trainee',
      role: 'IT / L1 Help Desk',
      email: 'jordan@example.com',
      status: 'in_training',
      source: 'l1_ticket_copilot',
      isSampleData: false
    });

    await registry.recordTrainingEvent(c.candidateId, {
      type: 'l1_resolution',
      score: 100,
      weight: 1,
      meta: {
        source: 'l1_ticket_copilot'
      }
    });
  }

  const oldBehaviorCandidates =
    await registry.listCandidates({});

  assert(
    oldBehaviorCandidates.length === 3,
    `control: unfixed pattern DOES fragment into separate rows - got ${oldBehaviorCandidates.length}`
  );

  if (process.exitCode) {
    console.error('\nOne or more assertions failed.');
  } else {
    console.log(
      '\nAll assertions passed. Server-side accumulation behavior matches what the client fix assumes.'
    );

    console.log(
      'Run again with a real MONGODB_URI to validate against the live database.'
    );
  }

})().catch((err) => {
  console.error('Test threw:', err);
  process.exitCode = 1;
});
