/**
 * TSM Executive Outcome View v1.0
 * --------------------------------------------------------------------------
 * BPO Enterprise Roadmap #7 — "Executives don't care about documents. They
 * care about money, risk, time, decisions." Four questions every portal
 * should answer: What happened? Why does it matter? What should we do?
 * Who owns it?
 *
 * This is a pure rollup layer — no new scoring or classification logic.
 * Every number below is read from an engine this platform already has:
 *
 *   What happened?    <- TSMQualityScoreEngine (#2): recordCount, overall,
 *                         openFindings, band
 *   Why does it matter? <- mission-queue-style estimatedImpactTotal /
 *                         unestimatedCount (see mdm-mission-queue.js's
 *                         summarize()) + high-severity finding count as a
 *                         risk proxy where no dollar figure exists
 *   What should we do? <- the open findings themselves (already-produced
 *                         explain items), capped and sorted by severity
 *   Who owns it?       <- claimedBy / missionStatus from the mission queue
 *                         (already tracks per-item ownership); when no
 *                         queue is supplied, honestly reports "Unassigned"
 *                         rather than guessing a team name
 *
 * Usage:
 *   const view = TSMExecutiveOutcome.build({
 *     domain: 'Healthcare',
 *     qualityScore: TSMQualityScoreEngine.fromExplainItems(items, { recordCount: 9842 }),
 *     explainItems: items,               // same array passed to the score above
 *     missionQueueSummary: summarize(queue), // optional, from mdm-mission-queue.js or equivalent
 *     missionQueue: queue                    // optional, for owner/due-date detail
 *   });
 *
 * Any field the caller doesn't supply is reported honestly as unavailable
 * (null / "Unassigned" / "Not estimated") rather than fabricated — same
 * convention as mdm-mission-queue.js's estimatedImpact and
 * decision-provenance.js's ruleIds.
 * ========================================================================== */

(function (global) {
  'use strict';

  function whatHappened(qualityScore, opts) {
    var qs = qualityScore || {};
    return {
      domain: opts.domain || 'Unknown',
      // TSM FIX: was named "documentsProcessed" but is actually
      // qualityScore.recordCount — the number of structured-data records
      // the quality engine scored, not source documents ingested. That's a
      // different, real counter (processedDocuments.count in
      // tsm-delivery-package.js, sourced from opts.documentCount) which
      // this file has no access to. The old name collided with it in the
      // exported JSON, letting a reader assume the two agreed when they
      // measure different things. Renamed to match what the value is.
      recordsProcessed: qs.recordCount != null ? qs.recordCount : null,
      accuracy: qs.overall != null ? qs.overall + '%' : null,
      band: qs.band || null,
      openFindings: qs.openFindings != null ? qs.openFindings : 0
    };
  }

  function whyItMatters(qualityScore, explainItems, missionQueueSummary) {
    var items = Array.isArray(explainItems) ? explainItems : [];
    var highSeverityCount = items.filter(function (it) { return it.severity === 'high'; }).length;

    var financialExposure = null;
    var exposureIsPartial = null;
    if (missionQueueSummary) {
      financialExposure = typeof missionQueueSummary.estimatedImpactTotal === 'number'
        ? missionQueueSummary.estimatedImpactTotal
        : null;
      exposureIsPartial = (missionQueueSummary.unestimatedCount || 0) > 0;
    }

    return {
      highSeverityFindings: highSeverityCount,
      financialExposure: financialExposure, // null if no mission queue summary supplied — not a guessed 0
      financialExposureIsPartial: exposureIsPartial, // true if some items had no estimable impact
      complianceBand: qualityScore && qualityScore.band ? qualityScore.band : null
    };
  }

  function whatShouldWeDo(explainItems, opts) {
    opts = opts || {};
    var limit = opts.actionLimit || 5;
    var sevRank = { high: 0, med: 1, low: 2 };
    var items = (Array.isArray(explainItems) ? explainItems.slice() : [])
      .filter(function (it) { return it && it.claim; })
      .sort(function (a, b) {
        return (sevRank[a.severity] != null ? sevRank[a.severity] : 1)
             - (sevRank[b.severity] != null ? sevRank[b.severity] : 1);
      });

    return items.slice(0, limit).map(function (it) {
      return {
        action: it.claim,
        severity: it.severity || 'med',
        confidence: it.confidence != null ? it.confidence : null,
        agentLabel: it.agentLabel || null // populated automatically if items came through TSMAgentRegistry.run() first
      };
    });
  }

  function whoOwnsIt(missionQueue) {
    var queue = Array.isArray(missionQueue) ? missionQueue : [];
    if (!queue.length) {
      return { owner: 'Unassigned', dueDate: null, claimedCount: 0, queuedCount: 0 };
    }
    var claimed = queue.filter(function (m) { return m.missionStatus === 'CLAIMED'; });
    var owners = claimed.map(function (m) { return m.claimedBy; }).filter(Boolean);
    // Most-common claimant, ties broken by first-seen order.
    var counts = Object.create(null);
    owners.forEach(function (o) { counts[o] = (counts[o] || 0) + 1; });
    var topOwner = owners.length
      ? Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0]
      : null;

    return {
      owner: topOwner || 'Unassigned',
      dueDate: null, // no due-date field exists upstream yet — honest null, not fabricated
      claimedCount: claimed.length,
      queuedCount: queue.length - claimed.length
    };
  }

  /**
   * build(opts)
   * opts.domain: string label
   * opts.qualityScore: result of TSMQualityScoreEngine.fromExplainItems/fromMdmScore
   * opts.explainItems: the same array passed into the score above (or agent-tagged via TSMAgentRegistry.run())
   * opts.missionQueueSummary: optional, from a mission-queue-style summarize()
   * opts.missionQueue: optional, the mission queue array itself (for ownership detail)
   */
  function build(opts) {
    opts = opts || {};
    return {
      domain: opts.domain || 'Unknown',
      generatedAt: new Date().toISOString(),
      whatHappened: whatHappened(opts.qualityScore, opts),
      whyItMatters: whyItMatters(opts.qualityScore, opts.explainItems, opts.missionQueueSummary),
      whatShouldWeDo: whatShouldWeDo(opts.explainItems, opts),
      whoOwnsIt: whoOwnsIt(opts.missionQueue)
    };
  }

  var TSMExecutiveOutcome = { build: build };

  global.TSMExecutiveOutcome = TSMExecutiveOutcome;
  if (typeof module !== 'undefined' && module.exports) module.exports = TSMExecutiveOutcome;

})(typeof window !== 'undefined' ? window : this);

// ── Self-test (run directly with `node tsm-executive-outcome.js`) ─────────
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var View = module.exports;

  var sampleItems = [
    { id: 'f1', claim: 'CLM-1001 denied for medical necessity', severity: 'high', confidence: 94 },
    { id: 'f2', claim: 'CPT 99215 coding mismatch on CLM-1002', severity: 'med', confidence: 80 },
    { id: 'f3', claim: 'HIPAA audit flag on record access log', severity: 'high', confidence: 88 }
  ];

  var sampleQualityScore = {
    overall: 97, band: 'STRONG', openFindings: 3, recordCount: 9842
  };

  var sampleMissionQueueSummary = {
    estimatedImpactTotal: 1250, estimatedImpactCount: 1, unestimatedCount: 2
  };

  var sampleMissionQueue = [
    { id: 'f1', missionStatus: 'CLAIMED', claimedBy: 'Finance Team' },
    { id: 'f2', missionStatus: 'QUEUED', claimedBy: null },
    { id: 'f3', missionStatus: 'CLAIMED', claimedBy: 'Finance Team' }
  ];

  var view = View.build({
    domain: 'Healthcare',
    qualityScore: sampleQualityScore,
    explainItems: sampleItems,
    missionQueueSummary: sampleMissionQueueSummary,
    missionQueue: sampleMissionQueue
  });

  console.log(JSON.stringify(view, null, 2));
}