
const { externalLlmFetch } = require('../server/external-llm-policy');
// explain.js
// The LLM's ONLY job here is to turn a rule that has already fired
// (deterministically, in rules/*.js) into a plain-language explanation
// grounded in the specific evidence events. It never decides whether
// something is anomalous — that already happened before this file runs.

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are a decision-explanation service inside an enterprise audit system.
You will be given a rule that fired and the specific events that triggered it.

Respond with ONLY valid JSON, no preamble, no markdown code fences, matching exactly this shape:
{
  "recommended_action": string,
  "reasoning": string[],
  "risk_summary": string
}

Rules:
- Each string in "reasoning" MUST reference a specific event id from the evidence provided.
- Do not speculate beyond the provided events.
- If the evidence is thin, say so explicitly in reasoning rather than inventing detail.
- "risk_summary" is one plain-language sentence, no jargon.`;

function safeJsonParse(text) {
  try {
    const cleaned = text.trim().replace(/^```json\s*|```$/g, '');
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

/**
 * Offline/no-API-key fallback so this service is runnable and testable
 * without a live Groq key. Produces a real, evidence-grounded explanation
 * using template logic instead of a model call. Replace by just setting
 * GROQ_API_KEY once you're ready to wire in the live model.
 */
function fallbackExplain(ruleResult, triggerEvent) {
  const ids = ruleResult.matchedEventIds.join(', ');
  return {
    recommended_action: 'Hold payment pending manual review',
    reasoning: [
      `Invoice ${triggerEvent.id} matches ${ruleResult.matchedEventIds.length} prior invoice(s) from the same vendor (${ids}) within the ${90}-day lookback window.`,
      `Amount similarity score of ${ruleResult.rawScore.toFixed(2)} exceeds the 0.92 duplicate threshold.`
    ],
    risk_summary: 'This looks like the same invoice may have been submitted more than once.'
  };
}

async function explainDecision(ruleResult, triggerEvent, entityContext = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return { ...fallbackExplain(ruleResult, triggerEvent), source: 'fallback_no_api_key' };
  }

  const userPrompt = JSON.stringify({
    rule: {
      rule_id: ruleResult.rule_id,
      severity: ruleResult.severity,
      rawScore: ruleResult.rawScore
    },
    trigger_event: triggerEvent,
    evidence_events: ruleResult.matchedEvents,
    entity_context: entityContext
  });

  try {
    const response = await externalLlmFetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1, // low on purpose — this is explanation, not creative writing
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', response.status, errText);
      return { ...fallbackExplain(ruleResult, triggerEvent), source: 'fallback_api_error' };
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = safeJsonParse(raw);

    if (!parsed) {
      console.error('Groq returned non-JSON, falling back:', raw);
      return { ...fallbackExplain(ruleResult, triggerEvent), source: 'fallback_parse_error' };
    }

    return { ...parsed, source: 'groq_live' };
  } catch (err) {
    console.error('Groq call failed:', err.message);
    return { ...fallbackExplain(ruleResult, triggerEvent), source: 'fallback_network_error' };
  }
}

module.exports = { explainDecision };
