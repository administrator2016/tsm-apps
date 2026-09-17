'use strict';

/**
 * TSM Operational OS
 * Universal cross-vertical recovery / exception intelligence.
 *
 * Input:
 *   tenant/member
 *   cases
 *   BNCA reports
 *   SLA events
 *   notes
 *   documents
 *
 * Output:
 *   executive recovery package
 *
 * This engine does NOT invent financial exposure.
 * Values are derived only from structured case data.
 */

const VERTICALS = [
  'healthcare',
  'mortgage',
  'construction',
  'real-estate',
  'insurance',
  'finops',
  'legal',
  'schools',
  'bpo',
  'concierge'
];

function num(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    if (typeof value === 'string') {
      const cleaned = value.replace(/[$,%\s,]/g, '');
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function caseVertical(c) {
  return String(
    first(
      c.vertical,
      c.domain,
      c.practice,
      c.category,
      'unclassified'
    )
  ).toLowerCase();
}

function caseExposure(c) {
  return num(
    c.revenueExposure,
    c.revenue_exposure,
    c.recoveryExposure,
    c.recovery_exposure,
    c.financialExposure,
    c.financial_exposure,
    c.amountAtRisk,
    c.amount_at_risk,
    c.exposure,
    c.amount
  );
}

// Most cases don't carry their own exposure field — the dollar estimate
// instead lives on the case's BNCA report(s), under a nested exposure
// object written by TSMBNCAExposureEngine (see
// tsm-ledger-service.js#bpoSaveBncaReport). Confirmed real shape (checked
// against BPO-2026-08-18-ueqqtb's actual stored reports):
//   exposure.currentExposure   -> flat number, the engine's own headline figure
//   exposure.ifIgnored.exposure -> nested number (ifIgnored itself is an
//                                   object with {exposure, basis}, not a number)
//   exposure.ifActed.exposure   -> same nested shape
// currentExposure is preferred as the "current state" figure; the nested
// ifIgnored/ifActed numbers are fallbacks for any report shape that omits
// it. This is real, previously computed data — not a fabricated fallback —
// so it's fair game once a case has no exposure field of its own.
function bncaExposureForCase(bncaReports, caseId) {
  if (!caseId || !Array.isArray(bncaReports) || !bncaReports.length) return null;

  const reports = bncaReports.filter(r => r && r.caseId === caseId);
  if (!reports.length) return null;

  // Most recent report wins. bpoListBncaReports already sorts desc by ts,
  // but don't assume caller order — sort defensively.
  const latest = reports.slice().sort(
    (a, b) => new Date(b.ts || 0) - new Date(a.ts || 0)
  )[0];

  const exposure = latest && latest.exposure;
  if (!exposure || typeof exposure !== 'object') return null;

  return num(
    exposure.currentExposure,
    exposure.ifIgnored && typeof exposure.ifIgnored === 'object'
      ? exposure.ifIgnored.exposure
      : exposure.ifIgnored,
    exposure.ifActed && typeof exposure.ifActed === 'object'
      ? exposure.ifActed.exposure
      : exposure.ifActed
  );
}

// Same lookup as bncaExposureForCase, but returns the whole latest report
// object instead of collapsing it to one number — needed to surface
// confidence/urgencyWindow/ifIgnored/ifActed as separate fields instead
// of folding them into a single fallback-chain scalar.
function latestBncaReportForCase(bncaReports, caseId) {
  if (!caseId || !Array.isArray(bncaReports) || !bncaReports.length) return null;

  const reports = bncaReports.filter(r => r && r.caseId === caseId);
  if (!reports.length) return null;

  return reports.slice().sort(
    (a, b) => new Date(b.ts || 0) - new Date(a.ts || 0)
  )[0];
}

// The value actually used everywhere in the package: the case's own
// exposure field if it has one, else the latest BNCA-derived estimate
// for that case. Still never fabricated — either a real stored case
// field or a real stored BNCA exposure figure, never a guess.
function resolvedExposure(c, bncaReports) {
  const direct = caseExposure(c);
  if (direct !== null) return direct;
  return bncaExposureForCase(bncaReports, first(c.caseId, c.id));
}

function caseRecovered(c) {
  return num(
    c.recoveredAmount,
    c.recovered_amount,
    c.revenueRecovered,
    c.revenue_recovered,
    c.amountRecovered
  ) || 0;
}

function casePrevented(c) {
  return num(
    c.preventedLoss,
    c.prevented_loss,
    c.lossPrevented,
    c.loss_prevented
  ) || 0;
}

function priorityWeight(priority) {
  return {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  }[String(priority || '').toLowerCase()] || 0;
}

function collectText(item) {
  if (!item || typeof item !== 'object') return '';

  return [
    item.title,
    item.summary,
    item.description,
    item.finding,
    item.recommendation,
    item.action,
    item.reason,
    item.note,
    item.text,
    item.message
  ].filter(Boolean).join(' ');
}

function deriveFinding(c) {
  const exposure = caseExposure(c);
  const status = String(c.status || c.stage || '').toLowerCase();
  const priority = String(c.priority || '').toLowerCase();

  if (exposure !== null && exposure > 0) {
    return `${priorityWeight(priority) >= 3 ? 'High-priority ' : ''}financial exposure of ${exposure}`;
  }

  if (status.includes('overdue') || status.includes('escalat')) {
    return 'Operational exception requires management intervention';
  }

  return first(c.title, c.summary, c.description, 'Operational exception identified');
}

function buildRecoveryPackage(input = {}) {
  const member = input.member || input.tenant || {};
  const cases = Array.isArray(input.cases) ? input.cases : [];
  const bnca = Array.isArray(input.bncaReports) ? input.bncaReports : [];
  const sla = Array.isArray(input.slaEvents) ? input.slaEvents : [];
  const notes = Array.isArray(input.notes) ? input.notes : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];

  const exposure = cases.reduce((sum, c) => {
    const value = resolvedExposure(c, bnca);
    return sum + (value === null ? 0 : value);
  }, 0);

  // Track whether any case's exposure figure actually came from a BNCA
  // report rather than the case record itself, so the package can be
  // honest about where the number came from (methodology, below).
  const exposureFromBnca = cases.some(
    c => caseExposure(c) === null && bncaExposureForCase(bnca, first(c.caseId, c.id)) !== null
  );

  // No-action / with-action exposure split, confidence, and urgency
  // window — all real, previously-computed fields already written by
  // TSMBNCAExposureEngine (see bpoSaveBncaReport), just not previously
  // surfaced by this engine. Falls back to the flat per-case exposure
  // figure when no BNCA report exists, so totals stay consistent with
  // financials.exposure above for cases with no BNCA data.
  let noActionExposure = 0;
  let actionExposure = 0;
  let latestConfidence = null;
  let anyConfidenceDefaulted = false;
  let latestUrgencyWindow = null;
  let latestUrgencyTs = null;

  for (const c of cases) {
    const caseId = first(c.caseId, c.id);
    const latestReport = latestBncaReportForCase(bnca, caseId);
    const fallback = resolvedExposure(c, bnca) || 0;

    const exp = latestReport && latestReport.exposure;
    const ifIgnored = exp && typeof exp.ifIgnored === 'object' ? num(exp.ifIgnored.exposure) : num(exp && exp.ifIgnored);
    const ifActed = exp && typeof exp.ifActed === 'object' ? num(exp.ifActed.exposure) : num(exp && exp.ifActed);

    noActionExposure += ifIgnored !== null ? ifIgnored : fallback;
    actionExposure += ifActed !== null ? ifActed : fallback;

    if (latestReport && Number.isFinite(latestReport.confidence)) {
      if (!latestUrgencyTs || new Date(latestReport.ts || 0) > new Date(latestUrgencyTs)) {
        latestConfidence = latestReport.confidence;
      }
      if (latestReport.confidenceDefaulted) anyConfidenceDefaulted = true;
    }

    if (exp && exp.urgencyWindow && (!latestUrgencyTs || new Date(latestReport.ts || 0) > new Date(latestUrgencyTs))) {
      latestUrgencyWindow = exp.urgencyWindow;
      latestUrgencyTs = latestReport.ts;
    }
  }

  const recovered = cases.reduce((sum, c) => sum + caseRecovered(c), 0);
  const prevented = cases.reduce((sum, c) => sum + casePrevented(c), 0);

  const verticalMap = {};

  for (const c of cases) {
    const vertical = caseVertical(c);

    if (!verticalMap[vertical]) {
      verticalMap[vertical] = {
        vertical,
        cases: 0,
        exposure: 0,
        recovered: 0,
        prevented: 0,
        critical: 0,
        high: 0
      };
    }

    const row = verticalMap[vertical];
    row.cases++;

    const e = resolvedExposure(c, bnca);
    if (e !== null) row.exposure += e;

    row.recovered += caseRecovered(c);
    row.prevented += casePrevented(c);

    const p = String(c.priority || '').toLowerCase();
    if (p === 'critical') row.critical++;
    if (p === 'high') row.high++;
  }

  const verticals = Object.values(verticalMap)
    .sort((a, b) => b.exposure - a.exposure);

  const criticalCases = cases
    .filter(c => ['critical', 'high'].includes(
      String(c.priority || '').toLowerCase()
    ))
    .sort((a, b) =>
      priorityWeight(b.priority) - priorityWeight(a.priority)
    );

  const findings = criticalCases.slice(0, 12).map(deriveFinding);

  const escalationTriggers = [];

  if (exposure > 0) {
    escalationTriggers.push(
      `Financial exposure identified across ${cases.length} case(s)`
    );
  }

  if (sla.length) {
    escalationTriggers.push(
      `${sla.length} SLA event(s) require executive review`
    );
  }

  if (criticalCases.length) {
    escalationTriggers.push(
      `${criticalCases.length} high/critical case(s) require prioritization`
    );
  }

  if (!documents.length) {
    escalationTriggers.push(
      'Evidence/document coverage is incomplete'
    );
  }

  const recoveryRate =
    exposure > 0 ? recovered / exposure : null;

  const containmentValue = recovered + prevented;

  return {
    schemaVersion: 'TSM-OPERATIONAL-OS-1.0',

    generatedAt: new Date().toISOString(),

    member: {
      id: first(member.id, member.memberId, member.tenantId, 'demo-member'),
      name: first(member.name, member.memberName, member.tenantName, 'SMB Member')
    },

    executiveSummary:
      exposure > 0
        ? `The portfolio currently carries ${exposure} of identified financial exposure across ${cases.length} operational case(s). The recovery engine has identified ${recovered} recovered value and ${prevented} prevented-loss value from structured case data.`
        : `The portfolio contains ${cases.length} operational case(s), but no structured financial exposure has been recorded yet.`,

    financials: {
      exposure,
      recovered,
      prevented,
      containmentValue,
      recoveryRate,
      noActionExposure,
      actionExposure
    },

    confidence: latestConfidence,
    confidenceDefaulted: anyConfidenceDefaulted,
    urgencyWindow: latestUrgencyWindow,

    portfolio: {
      totalCases: cases.length,
      criticalCases: cases.filter(c =>
        String(c.priority || '').toLowerCase() === 'critical'
      ).length,
      highCases: cases.filter(c =>
        String(c.priority || '').toLowerCase() === 'high'
      ).length,
      verticalCount: verticals.length
    },

    verticals,

    criticalFindings: findings,

    recommendedActions: criticalCases.slice(0, 8).map(c => ({
      caseId: first(c.caseId, c.id),
      vertical: caseVertical(c),
      priority: c.priority || null,
      owner: first(c.owner, c.assignee, c.assignedTo, 'Unassigned'),
      action: first(
        c.recommendedAction,
        c.recommendation,
        c.nextAction,
        c.action,
        'Review and resolve operational exception'
      ),
      exposure: resolvedExposure(c, bnca)
    })),

    escalationTriggers,

    evidence: {
      cases: cases.length > 0,
      bncaReports: bnca.length > 0,
      slaEvents: sla.length > 0,
      notes: notes.length > 0,
      documents: documents.length > 0
    },

    sourceCoverage: {
      cases: cases.length,
      bncaReports: bnca.length,
      slaEvents: sla.length,
      notes: notes.length,
      documents: documents.length
    },

    methodology: {
      verticalsSupported: VERTICALS,
      financialValuesOnlyFromStructuredData: true,
      fabricatedExposure: false,
      fabricatedRecoveryRate: false,
      exposureIncludesBncaDerivedFigures: exposureFromBnca
    }
  };
}

module.exports = {
  VERTICALS,
  buildRecoveryPackage
};
