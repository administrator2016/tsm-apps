
const { externalLlmFetch } = require('../server/external-llm-policy');
require('dotenv').config();
const express = require('express');
const router = express.Router();

const groq = async (prompt, maxTokens=800) => {
  const r = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.TSM_MODEL||'llama-3.1-8b-instant',messages:[{role:'user',content:prompt}],max_tokens:maxTokens,temperature:0.7})
  });
  const d = await r.json();  return d.choices?.[0]?.message?.content || 'AI unavailable';
};

router.post('/query', async (req,res) => {
  try {
    const {query='',message='',messages=[],context=''} = req.body||{};
    const q = query||message||messages.map(m=>m.content).join(' ');
    const content = await groq(`Healthcare insurance AI: auth denials, payer strategy, compliance. Context: ${context}. Query: ${q}. Concise and actionable.`, 900);
    res.json({ok:true,content,reply:content,ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

module.exports = router;
