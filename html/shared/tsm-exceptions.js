/**
 * TSM Exceptions Engine v1.0
 * --------------------------------------------------------------------------
 * BPO Enterprise Roadmap #3 — Autonomous Exception Management, prioritized
 * by impact rather than a flat list.
 *
 * This is the missing half of an already-built UI: html/js/widgets/
 * tsm-exception-widget.js (formerly duplicated under a malformed
 * "html/js/core/, html/js/widgets/" path — see cleanup note below) has
 * called global.TSMExceptions.getAll()/.resolve()/.subscribe() since it was
 * written, but nothing in the codebase ever defined TSMExceptions itself —
 * the widget has been rendering a "TSMExceptions not found" warning and a
 * static empty state the whole time. This file defines that engine.
 *
 * Priority model mirrors the one already proven in
 * html/mdm-suite/mdm-mission-queue.js (P1/P2/P3 from risk + confidence,
 * honest null exposure when no dollar figure is estimable) rather than
 * inventing a second scheme — same principle as tsm-quality-score-engine.js
 * generalizing MDM's scoring instead of reinventing it.
 *
 * Load order: this file, then tsm-agent-registry.js / tsm-quality-score-
 * engine.js if you want agent-tagged or scored input (optional — add()
 * accepts a plain exception object too), then the widget
 * (tsm-exception-widget.js) last.
 *
 * Exposes:
 *   TSMExceptions.add(exception) -> stored record
 *   TSMExceptions.fromExplainItems(items, opts) -> adds one exception per
 *     open finding, deriving priority the same way mission-queue does
 *   TSMExceptions.getAll(sector?) -> record[] (open + resolved), sorted P1..P3
 *   TSMExceptions.resolve(id) -> marks resolved, notifies subscribers
 *   TSMExceptions.subscribe(callback) -> unsubscribe fn; callback fires on
 *     every add()/resolve()
 *   TSMExceptions.clear() -> wipes storage (testing/reset only)
 *
 * RCM OS interop (added): add()/resolve() also mirror into TSMMemory
 * (html/shared/tsm-memory-engine.js) via registerAnomaly()/resolveAnomaly()
 * when that engine is loaded on the page — same principle as the
 * healthcare/REO/mortgage/schools/honeywell reconciliations documented in
 * config/rcm/cross-module-adoption.json: one shared TSM_OPERATIONAL_MEMORY_V3
 * store instead of a second, page-local exception list. This is additive
 * and best-effort — if TSMMemory isn't loaded (most pages that already use
 * TSMExceptions today don't load it), the calls are silent no-ops and
 * TSMExceptions behaves exactly as before. Every exception gets a stable
 * anomalyCode derived from its own exceptionId, so RCM OS's Cross-Module
 * Exceptions view (TSMMemory.getCrossModuleAnomalies()) picks it up
 * automatically with zero RCM OS-side changes.
 * ========================================================================== */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'tsm_exceptions_v1';
  var RISK_WEIGHT = { high: 3, med: 2, low: 1 };
  var listeners = [];

  function loadAll() {
    try {
      if (typeof global.localStorage === 'undefined') return [];
      var raw = global.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function persist(records) {
    try {
      if (typeof global.localStorage === 'undefined') return;
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
      // storage unavailable/full — stays in-memory for this session
    }
  }

  // TSM FIX: before the LLM-refusal-leak fix (buildHCStructuredCase /
  // TSMExecKitProducer.buildExplain), a strategist page whose engine ran
  // without enough source detail could feed an LLM clarification response
  // ("I'm afraid I can't generate... without the specific claim and denial
  // details...") into this store as if it were a real exception, via
  // add()/fromExplainItems(). That fix stops any *new* record like that
  // from being added — but this store is persisted to localStorage, so it
  // does nothing for records already saved before the fix shipped. Every
  // browser that hit an affected page even once has those bad records
  // stuck permanently; no code push can reach into a user's localStorage
  // to clean them up. Self-heal on load instead: purge any persisted
  // record whose title/detail looks like a refusal, once, the first time
  // this file loads after the fix. Reuses TSMExecKitProducer's detector
  // when that engine is loaded on the page (kept in sync with the actual
  // fix rather than duplicating the pattern a second place), falling back
  // to an inline copy of the same check otherwise so this self-heal still
  // works on pages that don't load tsm-exec-kit-producer.js.
  function _isRefusalText(text) {
    if (!text) return false;
    if (global.TSMExecKitProducer && typeof global.TSMExecKitProducer.isRefusalText === 'function') {
      return global.TSMExecKitProducer.isRefusalText(text);
    }
    return /^\s*(i'?m\s+(afraid|sorry|unable)|i\s+can'?t|i\s+cannot|i'?m\s+not\s+able)\b/i.test(text)
      || /\b(please\s+(provide|paste|share|include)|without\s+(the|specific|more)|not\s+enough\s+(information|detail|context)|need\s+(more|additional)\s+(information|detail|context))\b/i.test(text);
  }

  function _purgeStaleRefusalRecords(records) {
    var kept = records.filter(function (r) {
      return !(_isRefusalText(r && r.title) || _isRefusalText(r && r.detail));
    });
    if (kept.length !== records.length) persist(kept);
    return kept;
  }

  // TSM FIX: before hc-denial-war-room.html / tsm-hc-analyzer.js stripped
  // markdown from raw LLM engine output prior to field extraction, a bold
  // heading like "**Claim ID:** HC-DEN-..." broke the "label[:\s]+value"
  // regex the extractors use, so claimId extraction fell back to
  // capturing nothing useful and the record was saved with the raw label
  // text standing in for the real value -- title "Claim ID" (the label,
  // not an actual ID) paired with detail "**Denial Reason**" (the raw
  // unstripped heading, not the explanation that followed it). That
  // extraction bug is fixed now, but the same way as the refusal-leak
  // records above, any browser that hit an affected page while the bug
  // was live has these garbage records stuck in localStorage permanently
  // -- no code push reaches into an existing store to clean them up.
  // Self-heal the same way: purge on load. Deliberately narrow/exact-match
  // (not a fuzzy heuristic) so this can never catch a real claim whose
  // title or rationale legitimately mentions "Claim ID" or "Denial
  // Reason" as part of real content.
  var _GENERIC_LABEL_PLACEHOLDERS = ['claim id', 'denial reason', 'claim', 'id'];
  function _stripMdLocal(text) {
    if (!text) return text;
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/_(.*?)_/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/^#{1,6}\s+/gm, '');
  }
  function _isGenericPlaceholderRecord(title, detail) {
    var t = title ? _stripMdLocal(title).trim().toLowerCase() : '';
    if (_GENERIC_LABEL_PLACEHOLDERS.indexOf(t) === -1) return false;
    var d = detail ? _stripMdLocal(detail).trim().toLowerCase() : '';
    var firstLine = d.split('\n')[0].trim();
    return firstLine === '' || _GENERIC_LABEL_PLACEHOLDERS.indexOf(firstLine) !== -1;
  }

  function _purgeGenericPlaceholderRecords(records) {
    var kept = records.filter(function (r) {
      return !_isGenericPlaceholderRecord(r && r.title, r && r.detail);
    });
    if (kept.length !== records.length) persist(kept);
    return kept;
  }

  // TSM FIX: before hc-denial-war-room.html / hc-main-strategist.html's
  // stripMd() stripped markdown table pipes, an LLM answer formatted as a
  // table row ("| CO-50 ("Unable to determine the medical necessity...")
  // |") rode straight through rootCauseHypothesis extraction and into a
  // record's `detail` field verbatim — visible in the exception queue and
  // in exported tsm-client-package-*.json files' rationale text. That's
  // fixed for any *new* record now, but same as the two migrations above,
  // this store is persisted to localStorage, so records saved while the
  // bug was live are stuck with the raw "| ... |" wrapper permanently
  // unless something rewrites them. Unlike the refusal/placeholder cases
  // above, this data is real and worth keeping — clean it in place on
  // load instead of discarding the record. Reuses the same table-pipe
  // regexes as the fixed stripMd() so a record ends up looking exactly
  // like it would if it had been generated after the fix.
  function _stripTablePipesLocal(text) {
    if (!text) return text;
    return text
      .replace(/^\s*\|?[\s:-]*\|[\s:|-]*\|?\s*$/gm, '') // table separator rows (---|---)
      .replace(/^\s*\|\s*(.*?)\s*\|\s*$/gm, function (_, inner) {
        return inner.split('|').map(function (c) { return c.trim(); }).filter(Boolean).join(' — ');
      });
  }
  function _looksLikeTableArtifact(text) {
    if (!text) return false;
    return /^\s*\|/m.test(text) || /\|\s*$/m.test(text);
  }
  function _cleanTableArtifactRecords(records) {
    var changed = false;
    records.forEach(function (r) {
      if (!r) return;
      if (_looksLikeTableArtifact(r.detail)) {
        r.detail = _stripTablePipesLocal(r.detail);
        changed = true;
      }
      if (_looksLikeTableArtifact(r.title)) {
        r.title = _stripTablePipesLocal(r.title);
        changed = true;
      }
    });
    if (changed) persist(records);
    return records;
  }

  var _records = _cleanTableArtifactRecords(_purgeGenericPlaceholderRecords(_purgeStaleRefusalRecords(loadAll())));

  function makeId() {
    return 'exc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function notify() {
    listeners.forEach(function (cb) {
      try { cb(); } catch (e) { /* a bad subscriber shouldn't break the others */ }
    });
  }

  /** Same P1/P2/P3 rule as mdm-mission-queue.js's computePriority, generalized to any severity+confidence pair. */
  function priorityFor(severity, confidence) {
    var conf = typeof confidence === 'number' ? confidence : 0;
    if (severity === 'high' && conf >= 90) return 'P1';
    if (severity === 'high' || (severity === 'med' && conf >= 85)) return 'P2';
    return 'P3';
  }

  /** Stable per-exception anomalyCode so add()/resolve() always target the same TSMMemory record. */
  function anomalyCodeFor(entry) {
    return 'EXC_' + String(entry.exceptionId).replace(/[^a-z0-9]+/gi, '_').toUpperCase();
  }

  function bridgeAdd(entry) {
    var TM = global.TSMMemory;
    if (!TM || typeof TM.registerAnomaly !== 'function') return;
    try {
      TM.registerAnomaly({
        entityType: 'exception-queue',
        entityId: entry.exceptionId,
        anomalyCode: anomalyCodeFor(entry),
        title: entry.title || 'Exception',
        severity: entry.priority === 'P1' ? 'CRITICAL' : entry.priority === 'P2' ? 'HIGH' : 'MEDIUM',
        source: entry.agentLabel || 'tsm-exceptions',
        meta: {
          detail: entry.detail || null,
          recommendedAction: entry.recommendedAction || null,
          sector: entry.sector || null,
          exposure: typeof entry.exposure === 'number' ? entry.exposure : null,
          priority: entry.priority
        }
      });
    } catch (e) {
      // interop is best-effort — never let a TSMMemory problem break the exception queue itself
    }
  }

  function bridgeResolve(entry) {
    var TM = global.TSMMemory;
    if (!TM || typeof TM.resolveAnomaly !== 'function') return;
    try {
      TM.resolveAnomaly({
        anomalyCode: anomalyCodeFor(entry),
        entityType: 'exception-queue',
        entityId: entry.exceptionId,
        resolvedBy: 'tsm-exceptions',
        status: 'resolved'
      });
    } catch (e) {
      // best-effort, same as bridgeAdd
    }
  }

  /**
   * findOpenBySourceKey(sourceKey, sector) — reload-safe dedup lookup.
   * Callers that re-derive the same exception on every page load/render
   * (e.g. a war-room's feed-from-explain-items pass) previously had no
   * way to ask "has this already been recorded?" other than an in-memory
   * set that resets on refresh, so a reload silently created a fresh
   * duplicate exception every time. This checks the persisted store
   * itself, so the dedup survives a reload. sourceKey is caller-supplied
   * and should be a stable id for the underlying finding (e.g. the
   * upstream item's own id/claim), not the generated exceptionId.
   */
  function findOpenBySourceKey(sourceKey, sector) {
    if (!sourceKey) return null;
    return _records.filter(function (r) {
      return r.sourceKey === sourceKey &&
        (!sector || r.sector === sector) &&
        r.status === 'open';
    })[0] || null;
  }

  /**
   * findBySourceKey(sourceKey, sector) — same lookup as
   * findOpenBySourceKey() but matches a record regardless of status.
   * add()'s dedup needs this: a sourceKey that was already resolved
   * (either by a user clicking Resolve, or by TSMCaseManager.markExecuted
   * resolving the linked case's exceptions) still represents "this finding
   * has already been recorded" — the underlying claim didn't get less
   * duplicated just because it was closed out. findOpenBySourceKey alone
   * only protected against duplicating a *still-open* record, so once a
   * sourceKey's exception resolved, the next reload's re-feed (the exact
   * scenario findOpenBySourceKey was written to survive) found no open
   * match and pushed a brand-new exception + case for the same claim —
   * repeating on every subsequent reload.
   */
  function findBySourceKey(sourceKey, sector) {
    if (!sourceKey) return null;
    return _records.filter(function (r) {
      return r.sourceKey === sourceKey && (!sector || r.sector === sector);
    })[0] || null;
  }

  function add(exception) {
    exception = exception || {};
    // Reload-safe dedup: if the caller passes a sourceKey and an
    // exception with that same sourceKey (in the same sector) already
    // exists — open OR resolved — return it unchanged instead of pushing
    // a duplicate. This is opt-in — callers that don't pass sourceKey
    // keep today's behavior exactly (always creates a new record), so
    // nothing already relying on add() always returning a fresh record
    // is affected.
    if (exception.sourceKey) {
      var existing = findBySourceKey(exception.sourceKey, exception.sector);
      if (existing) return existing;
    }
    var priority = exception.priority || priorityFor(exception.severity, exception.confidence);
    var entry = Object.assign({
      exceptionId: makeId(),
      createdAt: new Date().toISOString(),
      status: 'open',
      exposure: null // honest null unless caller supplies a real dollar figure — never guessed
    }, exception, { priority: priority });

    _records.push(entry);
    persist(_records);
    bridgeAdd(entry);
    notify();
    return entry;
  }

  /**
   * fromExplainItems(items, opts)
   * items: the shared getExplainItems() contract (same array Quality Score
   *   and Agent Registry consume) — one exception is added per item.
   * opts.sector: tag for getAll(sector) filtering.
   * opts.exposureFor(item): optional fn returning a dollar figure for an
   *   item; if omitted, exposure stays honestly null (no fabricated total).
   */
  function fromExplainItems(items, opts) {
    opts = opts || {};
    var list = Array.isArray(items) ? items : [];
    return list.filter(function (it) { return it && it.claim; }).map(function (it) {
      var exposure = typeof opts.exposureFor === 'function' ? opts.exposureFor(it) : null;
      return add({
        title: it.claim,
        detail: it.rationale || null,
        recommendedAction: it.recommendedAction || null,
        severity: it.severity || 'med',
        confidence: it.confidence != null ? it.confidence : null,
        sector: opts.sector || null,
        agentLabel: it.agentLabel || null, // flows through automatically if items came via TSMAgentRegistry.run()
        exposure: typeof exposure === 'number' ? exposure : null
      });
    });
  }

  function getAll(sector) {
    var tierRank = { P1: 1, P2: 2, P3: 3 };
    return _records
      .filter(function (r) { return !sector || r.sector === sector; })
      .slice()
      .sort(function (a, b) { return (tierRank[a.priority] || 4) - (tierRank[b.priority] || 4); });
  }

  function resolve(exceptionId) {
    var rec = _records.filter(function (r) { return r.exceptionId === exceptionId; })[0];
    if (!rec) return null;
    rec.status = 'resolved';
    rec.resolvedAt = new Date().toISOString();
    persist(_records);
    bridgeResolve(rec);
    notify();
    return rec;
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
    persist(_records);
    notify();
  }

  /** Rollup for an executive-outcome-style "why it matters" tile — total exposure, honestly partial if some items have no estimate. */
  function summarize(sector) {
    var open = getAll(sector).filter(function (r) { return r.status === 'open'; });
    var byPriority = { P1: 0, P2: 0, P3: 0 };
    var exposureTotal = 0, exposureCount = 0, unestimatedCount = 0;
    open.forEach(function (r) {
      byPriority[r.priority] = (byPriority[r.priority] || 0) + 1;
      if (typeof r.exposure === 'number') { exposureTotal += r.exposure; exposureCount++; }
      else unestimatedCount++;
    });
    return {
      total: open.length,
      byPriority: byPriority,
      exposureTotal: exposureTotal,
      exposureCount: exposureCount,
      unestimatedCount: unestimatedCount
    };
  }

  var TSMExceptions = {
    add: add,
    fromExplainItems: fromExplainItems,
    getAll: getAll,
    resolve: resolve,
    subscribe: subscribe,
    clear: clear,
    summarize: summarize,
    priorityFor: priorityFor,
    findOpenBySourceKey: findOpenBySourceKey,
    findBySourceKey: findBySourceKey
  };

  global.TSMExceptions = TSMExceptions;
  if (typeof module !== 'undefined' && module.exports) module.exports = TSMExceptions;

})(typeof window !== 'undefined' ? window : this);

// ── Self-test (run directly with `node tsm-exceptions.js`) ────────────────
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var Exceptions = module.exports;

  var sampleItems = [
    { id: 'f1', claim: 'CLM-1001 denied for medical necessity', severity: 'high', confidence: 94, rationale: 'Missing physician documentation.' },
    { id: 'f2', claim: 'CPT 99215 coding mismatch on CLM-1002', severity: 'med', confidence: 80 },
    { id: 'f3', claim: 'HIPAA audit flag on record access log', severity: 'high', confidence: 88 }
  ];

  var added = Exceptions.fromExplainItems(sampleItems, {
    sector: 'healthcare',
    exposureFor: function (it) { return it.claim.indexOf('CLM-1001') !== -1 ? 1250 : null; }
  });
  console.log('[fromExplainItems]', JSON.stringify(added, null, 2));

  console.log('[getAll]', JSON.stringify(Exceptions.getAll('healthcare').map(function (r) { return { title: r.title, priority: r.priority, status: r.status }; }), null, 2));

  var unsub = Exceptions.subscribe(function () { console.log('[subscribe] change notified'); });
  Exceptions.resolve(added[0].exceptionId);
  unsub();

  console.log('[summarize]', JSON.stringify(Exceptions.summarize('healthcare'), null, 2));
}