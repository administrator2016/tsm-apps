// ServiceNow Table API adapter for L1 Ticket Copilot.
//
// Implements the adapter interface documented in
// html/l1-copilot/l1-copilot-backend-spec.md §3 — real HTTP calls against a
// customer's own ServiceNow instance, no hardcoded per-client logic. Every
// customer supplies their own instance URL + credentials via env vars (or a
// config object passed in for multi-tenant use); field mapping for
// non-standard CMDB fields is also config, not code.
//
// This module has NO dependency on express/server.js — it can be required
// and unit-tested standalone (see tests/unit/l1-copilot/servicenow-adapter.test.js).

'use strict';

/**
 * @typedef {Object} ServiceNowConfig
 * @property {string} instanceUrl   e.g. "https://acme.service-now.com"
 * @property {string} [username]    basic-auth username (used if oauthToken absent)
 * @property {string} [password]    basic-auth password
 * @property {string} [oauthToken]  bearer token, preferred over basic auth if present
 * @property {Object} [fieldMap]    optional per-customer field-name overrides, see DEFAULT_FIELD_MAP
 */

const DEFAULT_FIELD_MAP = {
  // sys_id/table field name -> the name l1-copilot's own contract uses.
  asset: {
    tag: 'asset_tag',
    manufacturer: 'manufacturer.name',
    model: 'model_id.display_name',
    warranty: 'warranty_expiration',
    owner: 'assigned_to.name',
    department: 'department.name',
    purchaseDate: 'purchase_date',
    status: 'install_status'
  },
  incident: {
    number: 'number',
    priority: 'priority',
    requester: 'caller_id.name',
    description: 'short_description',
    assignmentGroup: 'assignment_group.name',
    state: 'state',
    asset: 'cmdb_ci.asset_tag'
  }
};

class ServiceNowNotConfiguredError extends Error {
  constructor() {
    super('ServiceNow is not configured for this environment (missing SERVICENOW_INSTANCE_URL / credentials).');
    this.name = 'ServiceNowNotConfiguredError';
    this.code = 'SERVICENOW_NOT_CONFIGURED';
  }
}

/**
 * Reads config from env vars unless an explicit config object is passed
 * (multi-tenant callers pass their own).
 *
 * Deliberately separate from "are credentials present": a customer's
 * SERVICENOW_INSTANCE_URL/USERNAME/PASSWORD/OAUTH_TOKEN can be set as real
 * Fly secrets ahead of time without the integration actually going live —
 * SERVICENOW_INTEGRATION_ENABLED is the single on/off switch a customer
 * flips when they actually want it running. Until then this returns null
 * (same as "not configured"), regardless of what credentials exist.
 */
function loadConfigFromEnv() {
  if (process.env.SERVICENOW_INTEGRATION_ENABLED !== 'true') return null;

  const instanceUrl = process.env.SERVICENOW_INSTANCE_URL || '';
  if (!instanceUrl) return null;
  return {
    instanceUrl: instanceUrl.replace(/\/+$/, ''),
    username: process.env.SERVICENOW_USERNAME || '',
    password: process.env.SERVICENOW_PASSWORD || '',
    oauthToken: process.env.SERVICENOW_OAUTH_TOKEN || '',
    fieldMap: DEFAULT_FIELD_MAP
  };
}

function isConfigured(config) {
  const cfg = config || loadConfigFromEnv();
  if (!cfg || !cfg.instanceUrl) return false;
  return !!(cfg.oauthToken || (cfg.username && cfg.password));
}

function authHeader(cfg) {
  if (cfg.oauthToken) return { Authorization: `Bearer ${cfg.oauthToken}` };
  const basic = Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  return { Authorization: `Basic ${basic}` };
}

/** Reads a possibly-dotted display path (e.g. "manufacturer.name") off a ServiceNow record. */
function readField(record, dottedPath) {
  if (!record || !dottedPath) return null;
  // ServiceNow reference fields come back as { value, display_value } when
  // sysparm_display_value=all is used; dotted paths in our field map are for
  // our own readability and map to the flattened top-level key ServiceNow
  // actually returns for dot-walked fields in a Table API query
  // (e.g. cmdb_ci.asset_tag becomes a literal dotted key in some configs, but
  // by default ServiceNow flattens reference display values onto the base
  // field). We handle both shapes defensively.
  const base = dottedPath.split('.')[0];
  const val = record[dottedPath] !== undefined ? record[dottedPath] : record[base];
  if (val === undefined || val === null) return null;
  if (typeof val === 'object') return val.display_value !== undefined ? val.display_value : (val.value ?? null);
  return val;
}

async function snRequest(cfg, method, path, { query, body } = {}) {
  if (!isConfigured(cfg)) throw new ServiceNowNotConfiguredError();
  const url = new URL(cfg.instanceUrl + path);
  url.searchParams.set('sysparm_display_value', 'all');
  if (query) Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });

  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...authHeader(cfg)
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { throw new Error(`ServiceNow returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`); }

  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || json.error.detail)) || `ServiceNow HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

/**
 * getAsset(assetTag, config?) -> normalized asset record or null if not found
 * Queries cmdb_ci_hardware by asset_tag, per the backend spec's documented mapping.
 */
async function getAsset(assetTag, config) {
  const cfg = config || loadConfigFromEnv();
  const fm = (cfg && cfg.fieldMap && cfg.fieldMap.asset) || DEFAULT_FIELD_MAP.asset;
  const data = await snRequest(cfg, 'GET', '/api/now/table/cmdb_ci_hardware', {
    query: { sysparm_query: `asset_tag=${assetTag}`, sysparm_limit: '1' }
  });
  const record = data.result && data.result[0];
  if (!record) return null;
  return {
    assetTag: readField(record, fm.tag) || assetTag,
    manufacturer: readField(record, fm.manufacturer),
    model: readField(record, fm.model),
    warrantyStatus: readField(record, fm.warranty),
    owner: readField(record, fm.owner),
    department: readField(record, fm.department),
    purchaseDate: readField(record, fm.purchaseDate),
    status: readField(record, fm.status),
    raw: record
  };
}

/**
 * getTicket(incidentNumberOrSysId, config?) -> normalized incident record or null
 */
async function getTicket(incidentId, config) {
  const cfg = config || loadConfigFromEnv();
  const fm = (cfg && cfg.fieldMap && cfg.fieldMap.incident) || DEFAULT_FIELD_MAP.incident;
  const looksLikeSysId = /^[0-9a-f]{32}$/i.test(incidentId);
  const data = await snRequest(cfg, 'GET', '/api/now/table/incident', {
    query: looksLikeSysId
      ? { sysparm_query: `sys_id=${incidentId}`, sysparm_limit: '1' }
      : { sysparm_query: `number=${incidentId}`, sysparm_limit: '1' }
  });
  const record = data.result && data.result[0];
  if (!record) return null;
  return {
    number: readField(record, fm.number),
    priority: readField(record, fm.priority),
    requester: readField(record, fm.requester),
    description: readField(record, fm.description),
    assignmentGroup: readField(record, fm.assignmentGroup),
    state: readField(record, fm.state),
    asset: readField(record, fm.asset),
    sysId: record.sys_id && (record.sys_id.value || record.sys_id),
    raw: record
  };
}

/**
 * searchAssetsByUser(userIdOrName, config?) -> array of asset tags assigned to that user
 */
async function searchAssetsByUser(userIdentifier, config) {
  const cfg = config || loadConfigFromEnv();
  const fm = (cfg && cfg.fieldMap && cfg.fieldMap.asset) || DEFAULT_FIELD_MAP.asset;
  const data = await snRequest(cfg, 'GET', '/api/now/table/cmdb_ci_hardware', {
    query: { sysparm_query: `assigned_to.nameLIKE${userIdentifier}^ORassigned_to.user_nameLIKE${userIdentifier}`, sysparm_limit: '25' }
  });
  return (data.result || []).map(r => readField(r, fm.tag)).filter(Boolean);
}

/**
 * writeWorkNote(incidentId, note, config?) -> { success }
 * PATCHes the incident's work_notes field (ServiceNow appends journal-field
 * updates rather than overwriting — this is a real append, not a replace).
 */
async function writeWorkNote(incidentId, note, config) {
  const cfg = config || loadConfigFromEnv();
  const ticket = await getTicket(incidentId, cfg);
  if (!ticket) throw new Error(`No incident found for "${incidentId}" — cannot write work note.`);
  await snRequest(cfg, 'PATCH', `/api/now/table/incident/${ticket.sysId}`, {
    body: { work_notes: note }
  });
  return { success: true };
}

/**
 * updateTicketStatus(incidentId, state, config?) -> { success }
 * `state` should be the ServiceNow incident state label or numeric code the
 * customer's instance uses (e.g. "Resolved"/6, "In Progress"/2) — this is
 * intentionally left as passthrough since state values are customer-configurable.
 */
async function updateTicketStatus(incidentId, state, config) {
  const cfg = config || loadConfigFromEnv();
  const ticket = await getTicket(incidentId, cfg);
  if (!ticket) throw new Error(`No incident found for "${incidentId}" — cannot update status.`);
  await snRequest(cfg, 'PATCH', `/api/now/table/incident/${ticket.sysId}`, {
    body: { state }
  });
  return { success: true };
}

/**
 * createTicket(fields, config?) -> { success, number, sysId, raw }
 * POSTs a single new record to the incident table. `fields` is a raw
 * ServiceNow field map (short_description, caller_id, assignment_group,
 * priority, cmdb_ci, etc.) — intentionally NOT run through DEFAULT_FIELD_MAP,
 * since that map is for reading/normalizing records we get back, not for
 * translating what a caller writes (per-customer field names on write are
 * the caller's responsibility, same as the rest of this adapter's stance
 * that field mapping is config, not code).
 */
async function createTicket(fields, config) {
  const cfg = config || loadConfigFromEnv();
  const data = await snRequest(cfg, 'POST', '/api/now/table/incident', { body: fields });
  const record = data.result || {};
  return {
    success: true,
    number: readField(record, 'number'),
    sysId: record.sys_id && (record.sys_id.value || record.sys_id),
    raw: record
  };
}

/**
 * deleteTicket(incidentId, config?) -> { success }
 * Not part of the L1 Copilot production contract — exists so PDI/dev-instance
 * testing (see scripts/test-servicenow-batch-pdi.js) can clean up the test
 * records a batch run creates without leaving junk behind on a shared instance.
 */
async function deleteTicket(incidentId, config) {
  const cfg = config || loadConfigFromEnv();
  const ticket = await getTicket(incidentId, cfg);
  if (!ticket) throw new Error(`No incident found for "${incidentId}" — cannot delete.`);
  await snRequest(cfg, 'DELETE', `/api/now/table/incident/${ticket.sysId}`);
  return { success: true };
}

const DEFAULT_BATCH_OPTIONS = {
  // How many createTicket calls are in flight at once. ServiceNow Table API
  // has no documented hard concurrency cap, but most instances (especially
  // sub-prod/dev-tier ones like a PDI) rate-limit aggressively — keep this
  // conservative rather than maximizing throughput.
  chunkSize: 5,
  // Pause between chunks, on top of per-request retry/backoff below. This is
  // what actually protects a shared instance's rate limit budget across a
  // large batch, not just an individual 429.
  delayBetweenChunksMs: 500,
  // Per-record retry count on 429/5xx before that record is reported failed.
  maxRetries: 3,
  initialBackoffMs: 1000
};

// Hard ceiling independent of whatever a caller passes as `options` —
// batch-tickets is a write endpoint; an unbounded array in a single request
// is real blast radius (duplicate incidents, notification storms) regardless
// of how the request got there.
const MAX_BATCH_SIZE = 500;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createTicketWithRetry(fields, cfg, opts) {
  let attempt = 0;
  let lastErr;
  while (attempt <= opts.maxRetries) {
    try {
      return await createTicket(fields, cfg);
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!retryable || attempt === opts.maxRetries) throw e;
      await sleep(opts.initialBackoffMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }
  throw lastErr;
}

async function getTicketWithRetry(incidentId, cfg, opts) {
  let attempt = 0;
  let lastErr;
  while (attempt <= opts.maxRetries) {
    try {
      return await getTicket(incidentId, cfg);
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 429 || (e.status >= 500 && e.status < 600);
      if (!retryable || attempt === opts.maxRetries) throw e;
      await sleep(opts.initialBackoffMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }
  throw lastErr;
}

/**
 * createTicketsBatch(records, options?, config?)
 *   -> { total, succeeded, failed, results: [{ index, success, number?,
 *        sysId?, error?, status?, fields? }] }
 *
 * Chunked batch create with per-record retry/backoff on 429/5xx. A single
 * record failing (bad payload, permissions, whatever) does NOT abort the
 * rest of the batch — every record gets an independent result so the caller
 * can see exactly which ones need attention, rather than an all-or-nothing
 * failure on record #340 of 500 discarding 339 successful creates.
 */
async function createTicketsBatch(records, options, config) {
  const cfg = config || loadConfigFromEnv();
  if (!isConfigured(cfg)) throw new ServiceNowNotConfiguredError();
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('createTicketsBatch requires a non-empty array of ticket field objects.');
  }
  if (records.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch of ${records.length} exceeds the ${MAX_BATCH_SIZE}-record limit per call — split into multiple calls.`);
  }

  const opts = Object.assign({}, DEFAULT_BATCH_OPTIONS, options || {});
  const results = new Array(records.length);

  for (let i = 0; i < records.length; i += opts.chunkSize) {
    const chunk = records.slice(i, i + opts.chunkSize);
    const chunkResults = await Promise.all(chunk.map((fields, offset) => {
      const index = i + offset;
      return createTicketWithRetry(fields, cfg, opts).then(
        r => ({ index, success: true, number: r.number, sysId: r.sysId }),
        e => ({ index, success: false, error: e.message, status: e.status, fields })
      );
    }));
    chunkResults.forEach(r => { results[r.index] = r; });

    const isLastChunk = i + opts.chunkSize >= records.length;
    if (!isLastChunk && opts.delayBetweenChunksMs) {
      await sleep(opts.delayBetweenChunksMs);
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return { total: records.length, succeeded, failed: records.length - succeeded, results };
}

/**
 * getTicketsBatch(incidentIds, options?, config?)
 *   -> { total, succeeded, failed, results: [{ index, success, ticket?,
 *        incidentId, error?, status? }] }
 *
 * Chunked batch read, same chunking/retry/backoff shape as
 * createTicketsBatch — a large "audit/analyze all my open tickets" pull is
 * a real load pattern on a shared instance too, not just batch writes, and
 * getTicket() itself has no protection against 429s without this wrapper.
 * A missing incident (getTicket resolves null) is reported as success:false
 * with a "not found" error, same as any other per-record failure — it does
 * NOT abort the rest of the batch.
 */
async function getTicketsBatch(incidentIds, options, config) {
  const cfg = config || loadConfigFromEnv();
  if (!isConfigured(cfg)) throw new ServiceNowNotConfiguredError();
  if (!Array.isArray(incidentIds) || incidentIds.length === 0) {
    throw new Error('getTicketsBatch requires a non-empty array of incident numbers or sys_ids.');
  }
  if (incidentIds.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch of ${incidentIds.length} exceeds the ${MAX_BATCH_SIZE}-record limit per call — split into multiple calls.`);
  }

  const opts = Object.assign({}, DEFAULT_BATCH_OPTIONS, options || {});
  const results = new Array(incidentIds.length);

  for (let i = 0; i < incidentIds.length; i += opts.chunkSize) {
    const chunk = incidentIds.slice(i, i + opts.chunkSize);
    const chunkResults = await Promise.all(chunk.map((incidentId, offset) => {
      const index = i + offset;
      return getTicketWithRetry(incidentId, cfg, opts).then(
        ticket => ticket
          ? { index, success: true, incidentId, ticket }
          : { index, success: false, incidentId, error: `No incident found for "${incidentId}".` },
        e => ({ index, success: false, incidentId, error: e.message, status: e.status })
      );
    }));
    chunkResults.forEach(r => { results[r.index] = r; });

    const isLastChunk = i + opts.chunkSize >= incidentIds.length;
    if (!isLastChunk && opts.delayBetweenChunksMs) {
      await sleep(opts.delayBetweenChunksMs);
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return { total: incidentIds.length, succeeded, failed: incidentIds.length - succeeded, results };
}

module.exports = {
  DEFAULT_FIELD_MAP,
  DEFAULT_BATCH_OPTIONS,
  MAX_BATCH_SIZE,
  ServiceNowNotConfiguredError,
  loadConfigFromEnv,
  isConfigured,
  getAsset,
  getTicket,
  searchAssetsByUser,
  writeWorkNote,
  updateTicketStatus,
  createTicket,
  deleteTicket,
  createTicketsBatch,
  getTicketsBatch,
  // exported for tests only
  _internal: { readField, snRequest, authHeader, createTicketWithRetry, getTicketWithRetry }
};
