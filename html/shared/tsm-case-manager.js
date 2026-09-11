/**
 * TSM Case Engine v1.0
 * --------------------------------------------------------------------------
 * BPO Enterprise Roadmap #10 — Universal Case Object. The "Case →
 * Exception → Action → Approval → Audit" framework: one normalized case
 * shape that every vertical can produce and consume, instead of each
 * vertical inventing its own work-item/ticket/queue-entry shape.
 *
 * TSMCase (the class below) already existed in this file as a plain data
 * shape with no factory, no persistence, and nothing in the codebase ever
 * instantiated it — dead code. This file keeps that same field set
 * (nothing removed, so anything that assumed the old shape still works)
 * and adds the missing lifecycle: persistence, transitions, and a real
 * manager API, following the exact same conventions already proven in
 * tsm-exceptions.js (Roadmap #3) — localStorage persistence with an
 * in-memory fallback, subscribe()/notify(), P1/P2/P3 priority, and
 * best-effort bridges to sibling engines that are silent no-ops if those
 * engines aren't loaded on the page.
 *
 * Relationship to TSMExceptions: a Case does not duplicate exception
 * storage. createFromException() reads one TSMExceptions record and wraps
 * it in a Case (adding the work-queue/approval/execution/audit lifecycle
 * TSMExceptions itself doesn't have); the case keeps only a reference
 * (exceptionId) plus a denormalized snapshot for display, and closing a
 * case best-effort calls TSMExceptions.resolve() on that same id so the
 * two stay in sync without a second source of truth.
 *
 * Relationship to TSMHitlGate (Roadmap #4): recordApproval() uses a
 * shared 'CASE' gate (created once, lazily) if tsm-hitl-gate.js is loaded,
 * so every vertical's case approvals land in the same standardized
 * decision log described in that file's header — same additive,
 * best-effort-if-loaded pattern as the TSMExceptions/TSMMemory bridge.
 *
 * Exposes:
 *   TSMCaseManager.create(data) -> TSMCase, stored
 *   TSMCaseManager.createFromException(exceptionRecord, extra?) -> TSMCase
 *     built from a real TSMExceptions record (see field mapping below)
 *   TSMCaseManager.getAll(vertical?) -> TSMCase[] sorted P1..P3
 *   TSMCaseManager.getAll({ vertical?, tenantId? }) -> TSMCase[], same
 *     sort, additionally scoped to tenantId when supplied (pilot-readiness
 *     fix: getAll() previously only filtered by vertical/sector, so every
 *     client's cases rendered together in one exec portal's Case widget --
 *     the object form is additive, the plain-string form above still works
 *     unchanged for any caller that only ever needed vertical scoping)
 *   TSMCaseManager.getById(caseId) -> TSMCase | null
 *   TSMCaseManager.update(caseId, patch) -> TSMCase | null, logs an audit entry
 *   TSMCaseManager.addArtifact(caseId, artifact) -> TSMCase | null
 *   TSMCaseManager.requestApproval(caseId, opts?) -> TSMCase | null
 *   TSMCaseManager.recordApproval(caseId, decision, actor, meta?) -> TSMCase | null
 *     decision: 'APPROVED' | 'REJECTED'
 *   TSMCaseManager.markExecuted(caseId, outcome?) -> TSMCase | null,
 *     closes the case and best-effort resolves the linked exception
 *   TSMCaseManager.subscribe(callback) -> unsubscribe fn
 *   TSMCaseManager.clear() -> wipes storage (testing/reset only)
 *   TSMCaseManager.summarize(vertical?) -> rollup, same shape family as
 *     TSMExceptions.summarize() (byStatus instead of byPriority, since a
 *     case's lifecycle status is usually what a manager view wants first)
 * ========================================================================== */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'tsm_cases_v1';
  var listeners = [];

  /*
   * Set once a syncToServer/hydrateFromServer call comes back 401/403.
   * /api/bpo/cases is deliberately requireRole()-gated server-side
   * (server.js) — a session with no BPO-internal role (e.g. Guest)
   * will never succeed against it, so once we've seen that denial
   * there's no point firing (and no point letting the browser log)
   * further requests for the rest of this page load. localStorage
   * stays the source of truth for the page's own UI either way, per
   * the "additive, silent no-op if unavailable" contract below — this
   * only stops repeat network calls that are guaranteed to fail the
   * same way. A real reload (e.g. after logging in with a role) resets
   * this back to false.
   */
  var serverSyncDenied = false;

  /**
   * TSMCase — same field set as the original stub, extended (additively,
   * nothing renamed/removed) with the fields the Case->Exception->Action->
   * Approval->Audit framework needs: client, process, source, documentSet,
   * detectedExceptions, priority, deadline, requiredEvidence, assignedQueue,
   * generatedArtifacts, approvalStatus, executionStatus, outcome.
   * `timeline` doubles as the audit history the framework calls for — every
   * lifecycle transition below pushes one entry to it.
   *
   * tenantId / confidenceTier / humanReviewRequired (added, additive —
   * SOW Section 1/2 gap close):
   *   - tenantId: structural client/tenant boundary. Distinct from `client`
   *     (a free-text display name) — this is the field a multi-tenant query
   *     filters on. Defaults to null so existing callers are unaffected;
   *     bpo-internal1.html's DEFAULT_TENANT_ID should be passed in here.
   *   - confidenceTier: 'HIGH' | 'MEDIUM' | 'LOW' | null, derived by
   *     confidenceTierFor() from a 0-100 confidence score if the caller
   *     doesn't supply one explicitly. Feeds the pilot's accuracy-grading
   *     methodology (root cause / appealability / actionable, 0/1) instead
   *     of that being a manual-only review.
   *   - humanReviewRequired: boolean, defaults false only when tier is
   *     HIGH; true for MEDIUM/LOW/unknown so the safe default is "a human
   *     looks at it" rather than silent auto-approval.
   */
  function TSMCase(data) {
    data = data || {};
    this.caseId = data.caseId || makeId();
    // Links this case back to the Mission it was derived from, when the
    // caller has one (e.g. doc-search-multi's buildCaseFromClassification()
    // is called right after buildMissionFromClassification() for the same
    // classification). Additive/optional -- null for any case created
    // without a mission, same honest-missing-value convention as the rest
    // of this file (missingFields, priority fallback, etc.).
    this.missionId = data.missionId || null;
    this.sector = data.sector || 'general';
    this.vertical = data.vertical || data.sector || '';
    this.tenantId = data.tenantId || null;
    this.client = data.client || '';
    this.process = data.process || '';
    this.source = data.source || '';
    this.documentId = data.documentId || '';
    this.documentType = data.documentType || '';
    this.documentSet = data.documentSet || [];

    this.title = data.title || '';
    this.anomalyType = data.anomalyType || '';
    this.description = data.description || '';
    this.detectedExceptions = data.detectedExceptions || [];

    this.owner = data.owner || '';
    this.assignedQueue = data.assignedQueue || '';
    this.pressure = data.pressure || 'MEDIUM';
    this.priority = data.priority || null;
    this.exposure = typeof data.exposure === 'number' ? data.exposure : null;
    this.deadline = data.deadline || null;
    this.requiredEvidence = data.requiredEvidence || [];

    this.status = data.status || 'OPEN';
    this.approvalStatus = data.approvalStatus || 'NOT_REQUESTED';
    this.executionStatus = data.executionStatus || 'NOT_STARTED';
    this.outcome = data.outcome || null;

    this.confidenceTier = data.confidenceTier || null;
    this.humanReviewRequired = typeof data.humanReviewRequired === 'boolean'
      ? data.humanReviewRequired
      : null;

    this.detectedAt = data.detectedAt || new Date().toISOString();
    this.updatedAt = data.updatedAt || new Date().toISOString();

    this.fields = data.fields || {};
    this.missingFields = data.missingFields || [];
    this.recommendedApps = data.recommendedApps || [];
    this.recommendedActions = data.recommendedActions || [];
    this.generatedArtifacts = data.generatedArtifacts || [];
    this.memoryMatches = data.memoryMatches || [];
    this.relayTargets = data.relayTargets || [];
    this.autonomousActions = data.autonomousActions || [];
    this.executiveSummary = data.executiveSummary || {};
    this.timeline = data.timeline || [];
    this.relays = data.relays || [];
  }

  function makeId() {
    return 'CASE-' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function loadAll() {
    try {
      if (typeof global.localStorage === 'undefined') return [];
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw).map(function (d) { return new TSMCase(d); });
    } catch (e) {
      return [];
    }
  }

  function persist(records) {
    try {
      if (typeof global.localStorage === 'undefined') return;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {}
  }

  var _records = loadAll();

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(); } catch (e) {}
    });
  }

  function logAudit(rec, action, detail) {
    rec.timeline.push({ at: new Date().toISOString(), action: action, detail: detail || null });
  }

  function priorityFor(severity, confidence) {
    if (global.TSMExceptions && typeof global.TSMExceptions.priorityFor === 'function') {
      return global.TSMExceptions.priorityFor(severity, confidence);
    }
    var conf = typeof confidence === 'number' ? confidence : 0;
    if (severity === 'high' && conf >= 90) return 'P1';
    if (severity === 'high' || (severity === 'med' && conf >= 85)) return 'P2';
    return 'P3';
  }

  /**
   * confidenceTierFor(confidence) -> 'HIGH' | 'MEDIUM' | 'LOW' | null
   * confidence is a 0-100 score (same scale TSMExceptions already uses).
   * Thresholds intentionally conservative: MEDIUM starts at 70, HIGH at 90,
   * so "unsure" defaults toward human review rather than away from it.
   */
  function confidenceTierFor(confidence) {
    if (typeof confidence !== 'number' || isNaN(confidence)) return null;
    if (confidence >= 90) return 'HIGH';
    if (confidence >= 70) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * humanReviewRequiredFor(tier) -> boolean
   * Safe default: only a HIGH tier skips human review. LOW, MEDIUM, and
   * unknown (null tier, e.g. no confidence score was ever supplied) all
   * require review.
   */
  function humanReviewRequiredFor(tier) {
    return tier !== 'HIGH';
  }

  function tryRequireOutputContract() {
    try { return require('./tsm-output-contract.js'); } catch (e) { return null; }
  }

  function create(data) {
    var rec = new TSMCase(data);
    if (!rec.priority) rec.priority = priorityFor((data && data.severity) || null, (data && data.confidence) || null);
    if (!rec.confidenceTier) rec.confidenceTier = confidenceTierFor(data && data.confidence);
    if (rec.humanReviewRequired === null) rec.humanReviewRequired = humanReviewRequiredFor(rec.confidenceTier);
    // Best-effort bridge to TSMOutputContract (Roadmap #10.1) -- same
    // silent-no-op-if-not-loaded pattern as the TSMHitlGate/TSMExceptions
    // bridges elsewhere in this file. Populates rec.missingFields, which
    // was previously a dead field nothing ever computed.
    try {
      var OutputContract = global.TSMOutputContract || (typeof require !== 'undefined' ? tryRequireOutputContract() : null);
      if (OutputContract && typeof OutputContract.enforceCaseReadiness === 'function') {
        rec.missingFields = OutputContract.enforceCaseReadiness(rec).missing_fields;
      }
    } catch (e) {}
    logAudit(rec, 'CREATED', rec.title || rec.caseId);
    _records.push(rec);
    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  /**
   * findByExceptionId(exceptionId) — reload-safe dedup lookup, same
   * motivation as TSMExceptions.findOpenBySourceKey(): createFromException
   * previously had no way to check "does a case already exist for this
   * exception?", so a page reload that re-feeds the same exception (or a
   * caller invoking createFromException twice for any other reason) spun
   * up a second case pointed at the same underlying exceptionId, each
   * with its own independent approval/execution lifecycle.
   */
  function findByExceptionId(exceptionId) {
    if (!exceptionId) return null;
    return _records.filter(function (r) {
      return Array.isArray(r.detectedExceptions) && r.detectedExceptions.some(function (d) {
        return d && d.exceptionId === exceptionId;
      });
    })[0] || null;
  }

  function createFromException(exceptionRecord, extra) {
    if (!exceptionRecord) return null;
    // Dedup: if a case already exists for this exceptionId, return it
    // unchanged rather than creating a duplicate. Additive/opt-in in the
    // sense that it only short-circuits when a real prior case is found;
    // every other call path below is unchanged.
    var already = findByExceptionId(exceptionRecord.exceptionId);
    if (already) return already;
    extra = extra || {};
    var data = Object.assign({
      sector: exceptionRecord.sector || 'general',
      vertical: exceptionRecord.sector || 'general',
      title: exceptionRecord.title || 'Untitled case',
      description: exceptionRecord.detail || '',
      priority: exceptionRecord.priority || null,
      confidence: typeof exceptionRecord.confidence === 'number' ? exceptionRecord.confidence : null,
      exposure: typeof exceptionRecord.exposure === 'number' ? exceptionRecord.exposure : null,
      recommendedActions: exceptionRecord.recommendedAction ? [exceptionRecord.recommendedAction] : [],
      detectedExceptions: [{
        exceptionId: exceptionRecord.exceptionId,
        title: exceptionRecord.title,
        severity: exceptionRecord.severity || null,
        confidence: typeof exceptionRecord.confidence === 'number' ? exceptionRecord.confidence : null
      }]
    }, extra);
    var rec = create(data);
    logAudit(rec, 'LINKED_EXCEPTION', exceptionRecord.exceptionId);
    persist(_records);
    syncToServer(rec);
    return rec;
  }

  // Accepts either the original plain-string vertical filter, or
  // { vertical, tenantId } for the pilot-readiness tenant-isolation fix.
  // A missing/null tenantId matches everything, same "no filter = no
  // restriction" convention listMissions()/TSMMissionStore already uses --
  // this only restricts results when a caller actually supplies a tenantId,
  // it never silently hides cases that predate this fix and have no
  // tenantId set on them (those still show up for every caller, which is
  // the safest default until every case-creation call site is confirmed
  // to always stamp tenantId).
  function getAll(filter) {
    var vertical = null, tenantId = null;
    if (typeof filter === 'string') {
      vertical = filter;
    } else if (filter && typeof filter === 'object') {
      vertical = filter.vertical || null;
      tenantId = filter.tenantId || null;
    }
    var tierRank = { P1: 1, P2: 2, P3: 3 };
    return _records
      .filter(function (r) { return !vertical || r.sector === vertical || r.vertical === vertical; })
      .filter(function (r) { return !tenantId || r.tenantId === tenantId; })
      .slice()
      .sort(function (a, b) { return (tierRank[a.priority] || 4) - (tierRank[b.priority] || 4); });
  }

  function getById(caseId) {
    return _records.filter(function (r) { return r.caseId === caseId; })[0] || null;
  }

  function touch(rec) {
    rec.updatedAt = new Date().toISOString();
  }

  function update(caseId, patch) {
    var rec = getById(caseId);
    if (!rec) return null;
    patch = patch || {};
    var changedKeys = Object.keys(patch);
    Object.assign(rec, patch);
    touch(rec);
    // Recompute readiness -- a patch may have just supplied the title/
    // detectedExceptions that were missing at creation time, so
    // missingFields would otherwise go stale. Same best-effort bridge as
    // create() above.
    try {
      var OutputContract = global.TSMOutputContract || (typeof require !== 'undefined' ? tryRequireOutputContract() : null);
      if (OutputContract && typeof OutputContract.enforceCaseReadiness === 'function') {
        rec.missingFields = OutputContract.enforceCaseReadiness(rec).missing_fields;
      }
    } catch (e) {}
    logAudit(rec, 'UPDATED', changedKeys.join(', '));
    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  function addArtifact(caseId, artifact) {
    var rec = getById(caseId);
    if (!rec) return null;
    var entry = Object.assign({ generatedAt: new Date().toISOString() }, artifact || {});
    rec.generatedArtifacts.push(entry);
    touch(rec);
    logAudit(rec, 'ARTIFACT_GENERATED', entry.title || entry.type || 'artifact');
    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  function requestApproval(caseId, opts) {
    var rec = getById(caseId);
    if (!rec) return null;
    opts = opts || {};
    // Idempotency guard: a case that's already been decided (APPROVED/
    // REJECTED) or executed must not be silently reset back to PENDING.
    // Before this guard, any caller that re-ran requestApproval() on a
    // case it already held a reference to -- e.g. a war-room re-feeding
    // the same exception on page reload via createFromException(), which
    // now returns the existing case instead of a duplicate -- would
    // revert an approved/executed case to AWAITING_APPROVAL and append a
    // misleading APPROVAL_REQUESTED entry to its audit timeline. No-op
    // (returns the case unchanged) once a real decision/execution exists.
    if (rec.approvalStatus === 'APPROVED' || rec.approvalStatus === 'REJECTED' || rec.executionStatus === 'EXECUTED') {
      return rec;
    }
    rec.approvalStatus = 'PENDING';
    rec.status = 'AWAITING_APPROVAL';
    touch(rec);
    logAudit(rec, 'APPROVAL_REQUESTED', opts.note || null);
    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  var _hitlGate = null;
  function getHitlGate() {
    if (_hitlGate) return _hitlGate;
    var Hitl = global.TSMHitlGate || (typeof require !== 'undefined' ? tryRequireHitlGate() : null);
    if (!Hitl || typeof Hitl.createGate !== 'function') return null;
    _hitlGate = Hitl.createGate('CASE');
    return _hitlGate;
  }
  function tryRequireHitlGate() {
    try { return require('./tsm-hitl-gate.js'); } catch (e) { return null; }
  }

  function recordApproval(caseId, decision, actor, meta) {
    var rec = getById(caseId);
    if (!rec) return null;
    rec.approvalStatus = decision;
    rec.status = decision === 'APPROVED' ? 'APPROVED' : 'OPEN';
    touch(rec);
    logAudit(rec, 'APPROVAL_' + decision, (actor || 'unknown actor') + (meta && meta.reason ? ' — ' + meta.reason : ''));

    var gate = getHitlGate();
    if (gate) {
      try {
        gate.recordDecision({ entityId: caseId, entityType: 'case', decision: decision, actor: actor || 'unknown', meta: meta || {} });
      } catch (e) {}
    }

    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  function markExecuted(caseId, outcome) {
    var rec = getById(caseId);
    if (!rec) return null;
    rec.executionStatus = 'EXECUTED';
    rec.status = 'CLOSED';
    rec.outcome = outcome || rec.outcome;
    touch(rec);
    logAudit(rec, 'EXECUTED', typeof outcome === 'string' ? outcome : (outcome ? JSON.stringify(outcome) : null));

    if (global.TSMExceptions && typeof global.TSMExceptions.resolve === 'function') {
      rec.detectedExceptions.forEach(function (ex) {
        try { global.TSMExceptions.resolve(ex.exceptionId); } catch (e) {}
      });
    }

    persist(_records);
    notify();
    syncToServer(rec);
    return rec;
  }

  /**
   * syncToServer(rec) — best-effort, fire-and-forget mirror of a case to
   * POST /api/bpo/cases/:caseId (server/tsm-ledger-service.js bpo_cases
   * collection). Same "additive, silent no-op if unavailable" contract as
   * the TSMHitlGate bridge above: no fetch() in this environment (e.g.
   * the Node self-test at the bottom of this file), a network failure, or
   * a non-2xx response never throws back into the caller — the
   * localStorage record (`_records`/persist()) stays the source of truth
   * for the page's own UI either way, this is purely a server mirror for
   * cross-device/cross-session visibility and the exec-portal's own
   * server-side reporting.
   */
  function syncToServer(rec) {
    if (!rec || serverSyncDenied || typeof global.fetch !== 'function') return;
    try {
      global.fetch('/api/bpo/cases/' + encodeURIComponent(rec.caseId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
        credentials: 'same-origin'
      }).then(function (res) {
        if (res && (res.status === 401 || res.status === 403)) {
          serverSyncDenied = true;
        }
      }).catch(function () {});
    } catch (e) {}
  }

  /**
   * hydrateFromServer(vertical, opts?) -> Promise<number> merged count
   * Best-effort GET /api/bpo/cases?vertical=... (server/tsm-ledger-service.js
   * bpo_cases collection) and merges results into the local _records array,
   * so a case created/synced from a different browser or session becomes
   * visible here too — syncToServer() alone only pushes local->server;
   * this is the pull side that closes the loop into real cross-device
   * visibility instead of a write-only mirror.
   *
   * Merge rule: a server record only replaces a local one if the server's
   * updatedAt is strictly newer (or the local record doesn't exist yet).
   * This protects an in-flight local edit that hasn't finished its own
   * syncToServer() round-trip from being clobbered by a hydrate that
   * landed in between. Same "additive, silent no-op if unavailable"
   * contract as syncToServer — a missing fetch, a network failure, or a
   * non-2xx response resolves to 0 rather than throwing, so callers can
   * always safely fire this without their own try/catch.
   */
  function hydrateFromServer(vertical, opts) {
    if (serverSyncDenied || typeof global.fetch !== 'function') return Promise.resolve(0);
    opts = opts || {};
    // GET /api/bpo/cases (server.js) already accepts ?tenantId= and already
    // enforces it server-side for client-role sessions -- this was simply
    // never being sent from the browser, so an internal-role operator's
    // hydrate pulled every tenant's cases for the vertical. Additive: a
    // caller that doesn't pass opts.tenantId gets the exact same request
    // as before.
    var params = [];
    if (vertical) params.push('vertical=' + encodeURIComponent(vertical));
    if (opts.tenantId) params.push('tenantId=' + encodeURIComponent(opts.tenantId));
    var qs = params.length ? ('?' + params.join('&')) : '';
    return global.fetch('/api/bpo/cases' + qs, { credentials: 'same-origin' })
      .then(function (res) {
        if (res && (res.status === 401 || res.status === 403)) {
          serverSyncDenied = true;
        }
        return res.ok ? res.json() : null;
      })
      .then(function (body) {
        var serverCases = (body && body.ok && Array.isArray(body.cases)) ? body.cases : [];
        var merged = 0;
        serverCases.forEach(function (doc) {
          var local = getById(doc.caseId);
          var serverTime = doc.updatedAt ? new Date(doc.updatedAt).getTime() : 0;
          var localTime = local && local.updatedAt ? new Date(local.updatedAt).getTime() : -1;
          if (local && serverTime <= localTime) return;
          var rec = new TSMCase(doc);
          if (local) {
            var idx = _records.indexOf(local);
            _records[idx] = rec;
          } else {
            _records.push(rec);
          }
          merged++;
        });
        if (merged > 0) {
          persist(_records);
          notify();
        }
        return merged;
      })
      .catch(function () { return 0; });
  }

  function subscribe(callback) {
    if (typeof callback !== 'function') return function () {};
    listeners.push(callback);
    return function unsubscribe() {
      var idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  function clear() {
    _records = [];
    _hitlGate = null;
    persist(_records);
    notify();
  }

  function summarize(vertical) {
    var all = getAll(vertical);
    var byStatus = {};
    var exposureTotal = 0, exposureCount = 0, unestimatedCount = 0;
    all.forEach(function (r) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (typeof r.exposure === 'number') { exposureTotal += r.exposure; exposureCount++; }
      else unestimatedCount++;
    });
    return {
      total: all.length,
      byStatus: byStatus,
      exposureTotal: exposureTotal,
      exposureCount: exposureCount,
      unestimatedCount: unestimatedCount
    };
  }

  var TSMCaseManager = {
    create: create,
    createFromException: createFromException,
    getAll: getAll,
    getById: getById,
    update: update,
    addArtifact: addArtifact,
    requestApproval: requestApproval,
    recordApproval: recordApproval,
    markExecuted: markExecuted,
    subscribe: subscribe,
    clear: clear,
    summarize: summarize,
    confidenceTierFor: confidenceTierFor,
    humanReviewRequiredFor: humanReviewRequiredFor,
    // Was internal-only. hc-denial-war-room.html's syncStructuredCaseToEngine()
    // needs the same severity+confidence -> P1/P2/P3 mapping create() already
    // uses internally, rather than re-implementing it — exporting it is
    // strictly additive (create()/createFromException() still call the
    // local closure directly, unaffected).
    priorityFor: priorityFor,
    syncToServer: syncToServer,
    hydrateFromServer: hydrateFromServer,
    findByExceptionId: findByExceptionId
  };

  global.TSMCase = TSMCase;
  global.TSMCaseManager = TSMCaseManager;
  if (typeof module !== 'undefined' && module.exports) module.exports = TSMCaseManager;

})(typeof window !== 'undefined' ? window : this);

// ── Self-test (run directly with `node tsm-case-manager.js`) ──────────────
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var Cases = module.exports;

  var exceptionRecord = {
    exceptionId: 'exc_test_1',
    title: 'CLM-1001 denied for medical necessity',
    detail: 'Missing physician documentation.',
    recommendedAction: 'Retrieve authorization and resubmit.',
    severity: 'high',
    confidence: 94,
    priority: 'P1',
    sector: 'healthcare',
    exposure: 1250
  };

  var c = Cases.createFromException(exceptionRecord, { tenantId: 'tenant_acme_health', client: 'Acme Health System', process: 'denial_recovery', deadline: '2026-08-20' });
  console.log('[createFromException]', JSON.stringify(c, null, 2));
  console.log('[confidenceTier check]', c.confidenceTier, '| humanReviewRequired:', c.humanReviewRequired, '| tenantId:', c.tenantId);

  Cases.addArtifact(c.caseId, { type: 'appeal_letter', title: 'Payer Appeal — CLM-1001' });
  Cases.requestApproval(c.caseId, { note: 'Ready for supervisor sign-off' });
  Cases.recordApproval(c.caseId, 'APPROVED', 'Jane Analyst', { reason: 'Evidence checklist complete' });
  Cases.markExecuted(c.caseId, 'Appeal submitted to payer, $1,250 recovered pending response.');

  console.log('[final]', JSON.stringify(Cases.getById(c.caseId), null, 2));
  console.log('[summarize]', JSON.stringify(Cases.summarize('healthcare'), null, 2));
}
