
const { externalLlmFetch } = require('./server/external-llm-policy');
/**
 * groq-proxy.js
 * 
 * Drop-in Express route — keeps GROQ_API_KEY server-side.
 * 
 * Wire into your main server:
 *   const groqProxy = require('./groq-proxy');
 *   app.use('/api/groq', groqProxy);
 * 
 * Fly secret:
 *   fly secrets set GROQ_API_KEY=gsk_...
 */

'use strict';

const express = require('express');
const router  = express.Router();

// Node 18+ has native fetch. For older Node add: const fetch = require('node-fetch');

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Simple in-memory rate-limit: max 20 req / min per IP
const rl = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const entry = rl.get(ip) || { count: 0, reset: now + 60_000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60_000; }
  entry.count++;
  rl.set(ip, entry);
  return entry.count > 20;
}

router.post('/', express.json({ limit: '25mb' }), async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip;

  if (rateLimit(ip)) {
    return res.status(429).json({ error: { message: 'Rate limit exceeded — 20 req/min' } });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: { message: 'GROQ_API_KEY not configured on server' } });
  }

  // Forward only the fields we trust; strip anything else
  const { model, messages, max_tokens, temperature } = req.body;
  if (!model || !messages) {
    return res.status(400).json({ error: { message: 'model and messages are required' } });
  }

  const payload = {
    model,
    messages,
    max_tokens:  Math.min(max_tokens  ?? 1024, 4096),
    temperature: temperature ?? 0.2,
  };

  try {
    const upstream = await externalLlmFetch(GROQ_API, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    console.error('[groq-proxy] upstream error:', err.message);
    return res.status(502).json({ error: { message: 'Upstream Groq error: ' + err.message } });
  }
});

module.exports = router;
