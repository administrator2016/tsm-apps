'use strict';

const { HC_NODE_KEYS } = require('./hc-node-registry');

// A single intake event's required/allowed shape. This is a routing
// SUGGESTION record, not a claim that the target node has received,
// accepted, or processed anything — status starts at 'suggested' and only
// ever moves to 'routed' (an office manager explicitly opened the node) or
// 'dismissed' (office manager rejected the suggestion). Nothing here writes
// into a node's findings/bnca — that stays the node pages' own job via
// relayToStrategist().
const VALID_STATUSES = ['suggested', 'routed', 'dismissed'];

function validateIntakeEvent(body) {
  const errors = [];
  const b = body || {};

  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) errors.push('description is required (the document/case text to classify)');
  if (description.length > 4000) errors.push('description must be 4000 characters or fewer');

  if (b.suggestedNode && !HC_NODE_KEYS.includes(b.suggestedNode)) {
    errors.push(`suggestedNode must be one of: ${HC_NODE_KEYS.join(', ')}`);
  }

  if (b.status && !VALID_STATUSES.includes(b.status)) {
    errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  return { ok: errors.length === 0, errors, description };
}

module.exports = { validateIntakeEvent, VALID_STATUSES };
