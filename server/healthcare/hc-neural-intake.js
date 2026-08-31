'use strict';

const { HC_NODES } = require('./hc-node-registry');

// Deterministic, explainable keyword scoring — no LLM call, so there's
// nothing here that can hallucinate a node that doesn't exist or invent
// confidence it can't justify. Every suggestion carries the literal matched
// phrases so an office manager can see exactly why a node was suggested,
// same "nothing invented" standard the rest of HC Strategist already holds
// itself to (see hc-strategist/index.html's Anomaly Advisor system prompt).
function classifyIntake(description) {
  const text = String(description || '').toLowerCase();

  const scored = HC_NODES.map(node => {
    const matched = node.keywords.filter(kw => text.includes(kw));
    return { key: node.key, label: node.label, score: matched.length, matched };
  }).filter(r => r.score > 0);

  scored.sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return {
      suggestedNode: null,
      suggestedLabel: null,
      confidence: 'none',
      matched: [],
      reason: 'No node keywords matched this description — route manually.',
      alternates: [],
    };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  // Confidence is relative separation from the runner-up, not an invented
  // percentage — a single clearly-dominant match is 'high', a close or
  // multi-node tie is 'low' so the office manager knows to double-check.
  const confidence = !runnerUp || top.score > runnerUp.score ? 'high' : 'low';

  return {
    suggestedNode: top.key,
    suggestedLabel: top.label,
    confidence,
    matched: top.matched,
    reason: `Matched: "${top.matched.join('", "')}"`,
    alternates: scored.slice(1, 3).map(s => ({ key: s.key, label: s.label, matched: s.matched })),
  };
}

module.exports = { classifyIntake };
