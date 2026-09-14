// =====================================================
// STAFFING ENGINE SERVICE
// Fills the gap between the Candidate Registry (training/readiness)
// and an actual placement business: employers, job orders, and the
// submit -> interview -> place pipeline, with fee computation.
//
// Reuses the same MongoClient connection pattern as
// server/candidate-registry-service.js and server/tsm-ledger-service.js.
// Connection string comes from MONGODB_URI in .env.
//
// Honesty pattern (matches candidate-registry-service.js): fees are only
// ever computed off numbers actually entered on the job order and
// placement record — never estimated or typed in as a final dollar
// amount directly.
// =====================================================

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const DEFAULT_DB_NAME = 'tsm-consultz';
const EMPLOYERS_COLLECTION = 'staffing_employers';
const JOB_ORDERS_COLLECTION = 'staffing_job_orders';
const PLACEMENTS_COLLECTION = 'staffing_placements';

let client = null;
let db = null;
let connecting = null;

async function connect() {
  if (db) return db;
  if (connecting) return connecting;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Add it to .env — see server/tsm-ledger-service.js header for format.'
    );
  }

  connecting = (async () => {
    try {
      client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        socketTimeoutMS: 15000,
        retryWrites: false,
      });
      await client.connect();
      db = client.db(process.env.MONGODB_DB_NAME || DEFAULT_DB_NAME);
      return db;
    } finally {
      connecting = null;
    }
  })();

  db = await connecting;
  return db;
}

function genId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------
// Employers
// ---------------------------------------------------------------

async function listEmployers({ status } = {}) {
  const database = await connect();
  const query = status ? { status } : {};
  return database
    .collection(EMPLOYERS_COLLECTION)
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
}

async function getEmployer(employerId) {
  const database = await connect();
  return database.collection(EMPLOYERS_COLLECTION).findOne({ employerId });
}

async function upsertEmployer(payload) {
  const database = await connect();
  const now = new Date().toISOString();
  const employerId = payload.employerId || genId('emp');

  const doc = {
    employerId,
    name: payload.name,
    contactName: payload.contactName || null,
    contactEmail: payload.contactEmail || null,
    contactPhone: payload.contactPhone || null,
    sector: payload.sector || null,
    status: payload.status || 'prospect', // prospect | active | inactive
    notes: payload.notes || null,
    updatedAt: now,
    createdAt: payload.createdAt || now,
  };

  await database
    .collection(EMPLOYERS_COLLECTION)
    .updateOne({ employerId }, { $set: doc }, { upsert: true });

  return getEmployer(employerId);
}

async function deleteEmployer(employerId) {
  const database = await connect();
  const result = await database
    .collection(EMPLOYERS_COLLECTION)
    .deleteOne({ employerId });
  return result.deletedCount > 0;
}

// ---------------------------------------------------------------
// Job orders
// ---------------------------------------------------------------

async function listJobOrders({ employerId, status } = {}) {
  const database = await connect();
  const query = {};
  if (employerId) query.employerId = employerId;
  if (status) query.status = status;
  return database
    .collection(JOB_ORDERS_COLLECTION)
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
}

async function getJobOrder(jobOrderId) {
  const database = await connect();
  return database.collection(JOB_ORDERS_COLLECTION).findOne({ jobOrderId });
}

/**
 * feeType: 'markup' — hourly spread (billRate - payRate) paid on hours worked
 *          'contingency' — one-time % of the placement's annualized pay
 * feeValue: for markup, ignored (spread is derived from billRate/payRate);
 *           for contingency, the percentage (e.g. 25 for 25%)
 */
async function upsertJobOrder(payload) {
  const database = await connect();
  const now = new Date().toISOString();
  const jobOrderId = payload.jobOrderId || genId('job');

  if (payload.employerId) {
    const employer = await getEmployer(payload.employerId);
    if (!employer) {
      throw new Error(`No employer found for employerId ${payload.employerId}`);
    }
  }

  const doc = {
    jobOrderId,
    employerId: payload.employerId,
    title: payload.title,
    sector: payload.sector || null,
    openings: Number.isFinite(payload.openings) ? payload.openings : 1,
    payRate: payload.payRate != null ? Number(payload.payRate) : null, // hourly, paid to candidate
    billRate: payload.billRate != null ? Number(payload.billRate) : null, // hourly, billed to employer (markup model)
    feeType: payload.feeType || 'contingency', // 'markup' | 'contingency'
    feeValue: payload.feeValue != null ? Number(payload.feeValue) : 25, // contingency %, default matches TSM's stated 20-30% band
    status: payload.status || 'open', // open | filled | closed
    updatedAt: now,
    createdAt: payload.createdAt || now,
  };

  await database
    .collection(JOB_ORDERS_COLLECTION)
    .updateOne({ jobOrderId }, { $set: doc }, { upsert: true });

  return getJobOrder(jobOrderId);
}

async function deleteJobOrder(jobOrderId) {
  const database = await connect();
  const result = await database
    .collection(JOB_ORDERS_COLLECTION)
    .deleteOne({ jobOrderId });
  return result.deletedCount > 0;
}

// ---------------------------------------------------------------
// Placements (submit -> interview -> place pipeline)
// ---------------------------------------------------------------

const VALID_STATUSES = [
  'submitted',
  'interviewing',
  'offered',
  'placed',
  'declined',
  'ended',
];

/**
 * Computes the fee for a placement once it reaches 'placed'.
 * annualHours defaults to a standard 2080hr work-year for contingency math;
 * pass a real value on the placement (e.g. part-time roles) to override.
 */
function computeFee(jobOrder, placement) {
  if (!jobOrder) return null;

  if (jobOrder.feeType === 'markup') {
    if (jobOrder.billRate == null || jobOrder.payRate == null) return null;
    const spread = jobOrder.billRate - jobOrder.payRate;
    return {
      type: 'markup',
      hourlySpread: Math.round(spread * 100) / 100,
      basis: 'billRate_minus_payRate_per_hour',
    };
  }

  // contingency
  const payRate = placement.payRate != null ? Number(placement.payRate) : jobOrder.payRate;
  if (payRate == null) return null;
  const annualHours = Number.isFinite(placement.annualHours) ? placement.annualHours : 2080;
  const annualizedPay = payRate * annualHours;
  const pct = Number.isFinite(jobOrder.feeValue) ? jobOrder.feeValue : 25;
  const amount = Math.round(annualizedPay * (pct / 100) * 100) / 100;
  return {
    type: 'contingency',
    percentage: pct,
    annualizedPay: Math.round(annualizedPay * 100) / 100,
    amount,
    basis: 'percentage_of_annualized_pay',
  };
}

async function listPlacements({ jobOrderId, candidateId, employerId, status } = {}) {
  const database = await connect();
  const query = {};
  if (jobOrderId) query.jobOrderId = jobOrderId;
  if (candidateId) query.candidateId = candidateId;
  if (employerId) query.employerId = employerId;
  if (status) query.status = status;
  return database
    .collection(PLACEMENTS_COLLECTION)
    .find(query)
    .sort({ updatedAt: -1 })
    .toArray();
}

async function getPlacement(placementId) {
  const database = await connect();
  return database.collection(PLACEMENTS_COLLECTION).findOne({ placementId });
}

/**
 * Submits a candidate against a job order. This is the "match/submit"
 * action referenced in the partnership plan — creates the placement
 * record that both the readiness dashboard and an employer-facing view
 * can track through status.
 */
async function submitCandidate({ candidateId, jobOrderId, payRate, annualHours, meta }) {
  const database = await connect();
  const jobOrder = await getJobOrder(jobOrderId);
  if (!jobOrder) throw new Error(`No job order found for jobOrderId ${jobOrderId}`);

  const now = new Date().toISOString();
  const placementId = genId('plc');

  const doc = {
    placementId,
    candidateId,
    jobOrderId,
    employerId: jobOrder.employerId,
    status: 'submitted',
    payRate: payRate != null ? Number(payRate) : jobOrder.payRate,
    annualHours: annualHours != null ? Number(annualHours) : null,
    statusHistory: [{ status: 'submitted', at: now }],
    computedFee: null,
    meta: meta || {},
    createdAt: now,
    updatedAt: now,
  };

  await database.collection(PLACEMENTS_COLLECTION).insertOne(doc);
  return getPlacement(placementId);
}

async function updatePlacementStatus(placementId, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const database = await connect();
  const placement = await getPlacement(placementId);
  if (!placement) throw new Error(`No placement found for placementId ${placementId}`);

  const now = new Date().toISOString();
  const update = {
    status,
    updatedAt: now,
    statusHistory: [...(placement.statusHistory || []), { status, at: now }],
  };

  if (status === 'placed') {
    const jobOrder = await getJobOrder(placement.jobOrderId);
    update.computedFee = computeFee(jobOrder, placement);
    update.placedAt = now;
  }

  await database
    .collection(PLACEMENTS_COLLECTION)
    .updateOne({ placementId }, { $set: update });

  // If the job order is now fully staffed, mark it filled. Simple count
  // against openings — doesn't try to guess partial-fill semantics.
  if (status === 'placed') {
    const jobOrder = await getJobOrder(placement.jobOrderId);
    if (jobOrder) {
      const placedCount = (
        await database
          .collection(PLACEMENTS_COLLECTION)
          .find({ jobOrderId: jobOrder.jobOrderId, status: 'placed' })
          .toArray()
      ).length;
      if (placedCount >= jobOrder.openings && jobOrder.status !== 'filled') {
        await database
          .collection(JOB_ORDERS_COLLECTION)
          .updateOne({ jobOrderId: jobOrder.jobOrderId }, { $set: { status: 'filled', updatedAt: now } });
      }
    }
  }

  return getPlacement(placementId);
}

async function deletePlacement(placementId) {
  const database = await connect();
  const result = await database
    .collection(PLACEMENTS_COLLECTION)
    .deleteOne({ placementId });
  return result.deletedCount > 0;
}

module.exports = {
  connect,
  // employers
  listEmployers,
  getEmployer,
  upsertEmployer,
  deleteEmployer,
  // job orders
  listJobOrders,
  getJobOrder,
  upsertJobOrder,
  deleteJobOrder,
  // placements
  listPlacements,
  getPlacement,
  submitCandidate,
  updatePlacementStatus,
  deletePlacement,
  computeFee,
  VALID_STATUSES,
};
