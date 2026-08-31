'use strict';

/**
 * TSM Healthcare Node Contract
 *
 * Every HC specialist node receives the same canonical input
 * and returns the same canonical finding shape.
 *
 * This is intentionally transport-agnostic.
 * A node may later be implemented locally, through an API,
 * through an AI engine, or through another TSM service.
 */

const REQUIRED_INPUT_FIELDS = [
  'document',
  'extraction',
  'classification'
];

const OUTPUT_FIELDS = [
  'node',
  'relevance',
  'confidence',
  'findings',
  'risks',
  'recommendations',
  'evidence'
];

function createNodeRequest(input) {
  const source = input || {};

  return {
    document: source.document || {},
    extraction: source.extraction || {},
    classification: source.classification || {},
    routing: source.routing || {},
    context: source.context || {},
    timestamp: new Date().toISOString()
  };
}

function createNodeResult(node, data) {
  const source = data || {};

  return {
    node: String(node || ''),
    relevance: Number(source.relevance || 0),
    confidence: Number(source.confidence || 0),
    findings: Array.isArray(source.findings)
      ? source.findings
      : [],
    risks: Array.isArray(source.risks)
      ? source.risks
      : [],
    recommendations: Array.isArray(source.recommendations)
      ? source.recommendations
      : [],
    evidence: Array.isArray(source.evidence)
      ? source.evidence
      : [],
    timestamp: new Date().toISOString()
  };
}

function validateNodeRequest(request) {
  const missing = REQUIRED_INPUT_FIELDS.filter(function (field) {
    return !Object.prototype.hasOwnProperty.call(request || {}, field);
  });

  return {
    valid: missing.length === 0,
    missing: missing
  };
}

function validateNodeResult(result) {
  const missing = OUTPUT_FIELDS.filter(function (field) {
    return !Object.prototype.hasOwnProperty.call(result || {}, field);
  });

  return {
    valid: missing.length === 0,
    missing: missing
  };
}

module.exports = {
  REQUIRED_INPUT_FIELDS,
  OUTPUT_FIELDS,
  createNodeRequest,
  createNodeResult,
  validateNodeRequest,
  validateNodeResult
};
