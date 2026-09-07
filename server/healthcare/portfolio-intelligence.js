'use strict';

/**
 * TSM Healthcare (RCM) Portfolio Intelligence v1
 *
 * Deterministic revenue-cycle intelligence layer -- same role as
 * server/mortgage/portfolio-intelligence.js, ported for Healthcare's
 * entity vocabulary (claims, denials, appeals, aged AR accounts).
 *
 * Scope note: same as Mortgage, there is no real structured claims-system
 * feed behind this yet -- no clearinghouse/EHR integration exists in this
 * repo today. This module accepts entities directly (claims/denials/
 * appeals/agedAccounts in payload.sections, same pattern as Mortgage/PM),
 * AND normalizes whatever is already persisted in /api/hc/node-reports
 * (via tsmLedger.verticalListNodeReports('hc')) as findings, so this has
 * real data to show today. Honest-exposure note: HC's node-report body
 * has no exposure field at all (unlike Mortgage's), so node-derived
 * findings carry exposure: null rather than a guessed figure.
 *
 * No LLM required.
 */

const VERSION = 'hc-portfolio-intelligence-v1';
const { buildRevenueLeakageOpportunities, buildRevenueLeakageSummary } = require('./revenue-leakage-contract');

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

function normalizeEntity(item = {}, type) {
  const normalized = {
    id: String(first(
      item.id,
      item.claimId,
      item.claim_id,
      item.accountId,
      item.account_id
    ) || `${type}-unknown`),

    type,

    claimId: first(item.claimId, item.claim_id, item.claim) || null,
    accountId: first(item.accountId, item.account_id) || null,

    status: first(item.status, item.stage, item.state) || 'UNKNOWN',

    exposure: item.exposure === undefined && item.financialExposure === undefined
      && item.financial_exposure === undefined && item.amount === undefined
      ? null
      : num(first(
          item.exposure,
          item.financialExposure,
          item.financial_exposure,
          item.amount
        ), null),

    severity: String(first(item.severity, item.priority) || 'normal').toLowerCase(),

    source: first(item.source, item.sources?.[0]) || VERSION
  };

  /*
   * Canonical Healthcare Revenue Leakage projection fields.
   *
   * Portfolio Intelligence is an intake/normalization boundary.
   * Preserve explicit runtime values so the canonical leakage
   * contract can classify them without scraping UI/demo artifacts.
   */
  const leakageFields = {
    claimId: first(
      item.claimId,
      item.claim_id,
      item.claim,
      normalized.claimId,
      normalized.claim_id
    ),

    accountId: first(
      item.accountId,
      item.account_id,
      normalized.accountId,
      normalized.account_id
    ),

    payer: first(
      item.payer,
      item.payerName,
      item.payer_name,
      normalized.payer
    ),

    exposure: num(first(
      item.exposure,
      item.financialExposure,
      item.financial_exposure,
      item.amount,
      item.balance,
      normalized.exposure
    ), null),

    ageDays: num(
      item.ageDays,
      item.age_days,
      normalized.ageDays,
      normalized.age_days
    ),

    denialReasonCode: first(
      item.denialReasonCode,
      item.denial_reason_code,
      normalized.denialReasonCode,
      normalized.denial_reason_code
    ),

    denialCategory: first(
      item.denialCategory,
      item.denial_category,
      normalized.denialCategory,
      normalized.denial_category
    ),

    rootCause: first(
      item.rootCause,
      item.root_cause,
      item.rootCauseHypothesis,
      item.root_cause_hypothesis,
      normalized.rootCause,
      normalized.root_cause
    ),

    appealable:
      item.appealable !== undefined
        ? item.appealable
        : normalized.appealable,

    appealDeadline: first(
      item.appealDeadline,
      item.appeal_deadline,
      normalized.appealDeadline,
      normalized.appeal_deadline
    ),

    recoveryLikelihood: first(
      item.recoveryLikelihood,
      item.recovery_likelihood,
      normalized.recoveryLikelihood,
      normalized.recovery_likelihood
    ),

    confidence: num(first(
      item.confidence,
      normalized.confidence
    ), null),

    evidenceProvenance: first(
      item.evidenceProvenance,
      item.evidence_provenance,
      normalized.evidenceProvenance,
      normalized.evidence_provenance
    ) || []
  };

  return {
    ...normalized,
    ...leakageFields
  };
}

// Turns a persisted node report (see tsmLedger.verticalListNodeReports)
// into the same normalized entity shape as everything else in this twin.
// HC node reports carry claimIds (plural) rather than a single loanId --
// use the first claim id if present, else fall back to the node id.
function nodeReportToEntity(report = {}) {
  const claimIds = arr(report.claimIds);
  return normalizeEntity({
    id: claimIds[0] || report.nodeId,
    claim_id: claimIds[0] || null,
    status: report.nodeLabel || report.nodeId,
    // HC node reports have no exposure field -- leave unset so
    // normalizeEntity records it as null rather than a guessed 0.
    severity: report.severity,
    source: report.nodeId
  }, 'finding');
}

function buildPortfolioTwin(payload = {}, nodeReports = []) {
  const sections = payload.sections || {};

  const claims = arr(
    sections.claims || payload.claims
  ).map(x => normalizeEntity(x, 'claim'));

  const denials = arr(
    sections.denials || payload.denials || payload.denial_exception_items
  ).map(x => normalizeEntity(x, 'denial'));

  const appeals = arr(
    sections.appeals || payload.appeals || payload.appeal_pipeline_items
  ).map(x => normalizeEntity(x, 'appeal'));

  const agedAccounts = arr(
    sections.agedAccounts || payload.agedAccounts || payload.ar_aging_items
  ).map(x => normalizeEntity(x, 'aged_account'));

  const explicitFindings = arr(payload.findings)
    .concat(arr(sections.findings))
    .map(x => normalizeEntity(x, 'finding'));

  const nodeFindings = arr(nodeReports).map(nodeReportToEntity);

  const findings = explicitFindings.concat(nodeFindings);

  const all = [
    ...claims,
    ...denials,
    ...appeals,
    ...agedAccounts,
    ...findings
  ];

    const leakageOpportunities =
    buildRevenueLeakageOpportunities({
      claims,
      denials,
      appeals,
      agedAccounts
    });

return {
    version: VERSION,
    generatedAt: new Date().toISOString(),

    counts: {
      claims: claims.length,
      denials: denials.length,
      appeals: appeals.length,
      agedAccounts: agedAccounts.length,
      findings: findings.length
    },

    claims,
    denials,
    appeals,
    agedAccounts,
    findings,

    exposure: all.reduce((sum, entity) => sum + num(entity.exposure), 0)
  ,

    leakageOpportunities,


    leakageSummary:


      buildRevenueLeakageSummary(leakageOpportunities)
  };
}

module.exports = {
  VERSION,
  buildPortfolioTwin
};
