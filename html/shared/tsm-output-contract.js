/**
 * TSM Output Contract Engine
 * ---------------------------------------------------------------------
 * NOTE: mirrored at html/shared/tsm-output-contract.js so browser pages
 * can load it via <script> (this file itself isn't statically served).
 * Keep both copies identical -- update both on any change.
 * ---------------------------------------------------------------------
 * Two contract tiers, checking two different layers:
 *
 * 1. enforceOutputContract(vertical, payload) / VERTICAL_CONTRACTS --
 *    validates a vertical's "structured case" object (the ANALYSIS
 *    output built client-side by each war-room strategist page -- see
 *    html/shared/tsm-sla-extractor.js and each page's
 *    build<Vertical>StructuredCase() function) before that analysis is
 *    treated as ready to hand off. Only verticals with a real
 *    build*StructuredCase() function get a dedicated entry; everything
 *    else falls through to `default` and reports
 *    used_default_fallback:true. Confirmed against source as of
 *    2026-08-19:
 *      - healthcare: html/healthcare/hc-denial-war-room.html -> buildHCStructuredCase()
 *      - legalops:   html/war-rooms/legal-war/legal-main-strategist.html -> buildLegalStructuredCase()
 *      - insurance:  html/war-rooms/insure-war/insurance-strategist.html -> buildInsuranceStructuredCase()
 *      - finops:     html/finops-suite/finops-war/finops-main-strategist.html -> buildFinOpsStructuredCase()
 *
 * 2. enforceCaseReadiness(caseData) -- validates a TSMCase object (the
 *    UNIVERSAL case shape in html/shared/tsm-case-manager.js, Roadmap
 *    #10) that now spans every vertical, not just the four above.
 *    Wired into TSMCaseManager.create() as a best-effort bridge (same
 *    pattern as that file's existing TSMHitlGate/TSMExceptions
 *    bridges), so it fires on every case creation regardless of
 *    vertical and populates the case's own (previously dead/always-
 *    empty) `missingFields` field. Deliberately vertical-agnostic and
 *    presence-not-just-defined: an empty array or blank string counts
 *    as missing, unlike tier 1's `=== undefined` check, because a case
 *    with e.g. detectedExceptions:[] isn't actually decision-ready
 *    even though the key exists.
 */

const VERTICAL_CONTRACTS = {
  // Richer, denial-specific shape -- buildHCStructuredCase() always returns
  // all of these keys (value may be null when not found in source text).
  healthcare: [
    "claimId", "payer", "denialReasonCode", "denialCategory",
    "rootCauseHypothesis", "appealable", "appealDeadline",
    "recoveryLikelihood", "confidence", "confidenceTier",
    "humanReviewRequired", "financialExposure", "evidenceProvenance"
  ],
  // Shared shape used identically by Legal, Insurance, and FinOps --
  // all three call into the same html/shared/tsm-sla-extractor.js helpers.
  legalops: ["deadline", "requiredEvidence", "financialExposure", "confidence", "confidenceTier", "humanReviewRequired"],
  insurance: ["deadline", "requiredEvidence", "financialExposure", "confidence", "confidenceTier", "humanReviewRequired"],
  finops: ["deadline", "requiredEvidence", "financialExposure", "confidence", "confidenceTier", "humanReviewRequired"],
  // Generic fallback for any vertical without a dedicated contract yet.
  default: ["deadline", "confidence", "humanReviewRequired"]
};

function enforceOutputContract(vertical, payload = {}) {
  const key = (vertical || "").toLowerCase();
  const usedDefaultFallback = !Object.prototype.hasOwnProperty.call(VERTICAL_CONTRACTS, key);
  const requiredOutputs = VERTICAL_CONTRACTS[key] || VERTICAL_CONTRACTS.default;

  const missing = requiredOutputs.filter(field => !isPresent(payload[field]));

  return {
    contract_outputs: requiredOutputs,
    vertical: key || "default",
    contract_used: usedDefaultFallback ? "default" : key,
    used_default_fallback: usedDefaultFallback,
    timestamp: new Date().toISOString(),
    is_compliant: missing.length === 0,
    missing_fields: missing,
    payload
  };
}

// One baseline required-field set for every TSMCase, regardless of
// vertical -- the class itself is already vertical-agnostic (Roadmap
// #10's whole point), so the readiness bar is too. A case is
// "decision-ready" when it has a title, at least one detected
// exception, a priority, and an explicit human-review flag.
// TSMCaseManager.create() already guarantees priority/
// humanReviewRequired via its own defaulting logic, so those should
// always be present by the time this runs; title and
// detectedExceptions are the two a caller can still leave empty.
//
// confidenceTier is deliberately NOT in this baseline: checked against
// real production code (2026-08-19), Mortgage, Schools, NOC, PM,
// Honeywell, and Concierge all hardcode confidence:null in their
// exception-feed functions -- their detection is deterministic
// (SLA breach, compliance flag) rather than an ML confidence score, so
// confidenceTier:null is correct/expected there, not a gap. Requiring
// it universally would flag most verticals' cases permanently.
// humanReviewRequired already covers the safety-relevant part of this:
// it defaults to true whenever tier is unknown, so a no-confidence-
// score case still correctly routes to a human either way.
const CASE_READINESS_FIELDS = ["title", "detectedExceptions", "priority", "humanReviewRequired"];

function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function enforceCaseReadiness(caseData) {
  const payload = caseData || {};
  const missing = CASE_READINESS_FIELDS.filter(field => !isPresent(payload[field]));

  return {
    contract_outputs: CASE_READINESS_FIELDS,
    contract_used: "case_readiness",
    timestamp: new Date().toISOString(),
    is_compliant: missing.length === 0,
    missing_fields: missing
  };
}

(function (global) {
  var TSMOutputContract = {
    VERTICAL_CONTRACTS: VERTICAL_CONTRACTS,
    enforceOutputContract: enforceOutputContract,
    CASE_READINESS_FIELDS: CASE_READINESS_FIELDS,
    enforceCaseReadiness: enforceCaseReadiness
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = TSMOutputContract;
  }
  if (typeof global !== "undefined") {
    global.TSMOutputContract = TSMOutputContract;
  }
})(typeof window !== "undefined" ? window : this);
