
const { externalLlmFetch } = require('../server/external-llm-policy');
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '15mb' }));
const PORT = process.env.PORT || 8000;
const GROQ_KEY = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
if (!GROQ_KEY) console.warn('\n⚠️  GROQ_API_KEY is not set. export GROQ_API_KEY=your_key_here\n');
const clientUsage = {};
function withinDailyLimit(req, limit = 20) {
  const key = req.ip + '_' + new Date().toDateString();
  clientUsage[key] = (clientUsage[key] || 0) + 1;
  return clientUsage[key] <= limit;
}
app.post('/api/hc/stream', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { model, sys, user, maxTok } = req.body || {};
  if (!sys || !user) return res.status(400).json({ error: 'Missing sys or user' });
  if (!withinDailyLimit(req)) return res.status(429).json({ error: 'Daily analysis limit reached for this demo.' });
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server.' });
  try {
    const groqRes = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY },
      body: JSON.stringify({ model: model || 'openai/gpt-oss-120b', stream: true, max_tokens: maxTok || 500, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
    });
    if (!groqRes.ok) { const err = await groqRes.json().catch(() => ({})); return res.status(502).json({ error: err.error?.message || 'Groq error' }); }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    const { Readable } = require('stream');
    Readable.fromWeb(groqRes.body).pipe(res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
const GROQ_VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'];
app.post('/api/hc/ocr', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { imageBase64, mimeType, prompt } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'Missing imageBase64' });
  if (!withinDailyLimit(req)) return res.status(429).json({ error: 'Daily analysis limit reached for this demo.' });
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured on server.' });
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
  const ocrPrompt = prompt || 'Extract ALL visible text from this image exactly as it appears. Preserve structure, codes, dates, and dollar amounts. Output plain text only.';
  let lastErr;
  for (const model of GROQ_VISION_MODELS) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 25000);
      let groqRes;
      try {
        groqRes = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + GROQ_KEY }, body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'text', text: ocrPrompt }, { type: 'image_url', image_url: { url: dataUrl } }] }] }), signal: controller.signal });
      } finally { clearTimeout(t); }
      if (!groqRes.ok) { const err = await groqRes.text(); lastErr = err; if ([429,500,502,503].includes(groqRes.status)) continue; return res.status(502).json({ error: 'Groq OCR error ' + groqRes.status + ': ' + err }); }
      const data = await groqRes.json();
      return res.json({ ok: true, text: data?.choices?.[0]?.message?.content || '' });
    } catch (e) { lastErr = e.message; }
  }
  return res.status(502).json({ error: 'OCR failed on all models: ' + lastErr });
});
app.use(express.static(path.join(__dirname)));
app.listen(PORT, () => console.log(`\n✅ HC demo server running: http://localhost:${PORT}/html/healthcare/hc-denial-war-room.html\n`));
