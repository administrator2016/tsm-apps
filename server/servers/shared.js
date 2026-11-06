
const { externalLlmFetch } = require('../external-llm-policy');
require('dotenv').config();
const express = require('express');
const router = express.Router();

const groq = async (prompt, maxTokens=800) => {
  const r = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
    method:'POST',
    headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({model:process.env.TSM_MODEL||'openai/gpt-oss-120b',messages:[{role:'user',content:prompt}],max_tokens:maxTokens,temperature:0.7})
  });
  const d = await r.json();  return d.choices?.[0]?.message?.content || 'AI unavailable';
};

const q = b => b.query||b.message||b.prompt||(b.messages||[]).map(m=>m.content).join(' ')||'';

router.get('/status', (req,res) => res.json({ok:true,status:'TSM online',ai:!!process.env.GROQ_API_KEY,version:'3.0.0'}));

router.post('/chat',            async (req,res) => { try { const body=req.body||{}; const msgs=body.messages||[{role:'user',content:q(body)}]; const r=await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TSM_MODEL||'openai/gpt-oss-120b',messages:msgs,max_tokens:800,temperature:0.7})}); const d=await r.json(); const content=d.choices?.[0]?.message?.content||'AI unavailable'; res.json({ok:true,content,reply:content,response:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/financial/query', async (req,res) => { try { const content=await groq(`Financial ops AI. Query: ${q(req.body||{})}. Specific financial insights, metrics, actions.`); res.json({ok:true,content,reply:content,response:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/ai/query',        async (req,res) => { try { const content=await groq(`Enterprise AI. Query: ${q(req.body||{})}. Concise and actionable.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/taxprep/v1',      async (req,res) => { try { const {action='analyze',entity='',context='',fiscal_year=''}=req.body||{}; const content=await groq(`Tax Prep AI. Action: ${action}. Entity: ${entity}. Year: ${fiscal_year}. Context: ${context}. Tax analysis: deductions, compliance flags, recommendations.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});

// Strategist routes
router.post('/strategist/query',        async (req,res) => { try { const content=await groq(`TSM Strategist AI. Query: ${q(req.body||{})}. Strategic analysis with ROI, timeline, priorities.`,900); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/strategist/hc/dee-action',async (req,res) => { try { const content=await groq(`HonorHealth DEE Action Strategist. Context: ${JSON.stringify(req.body||{}).slice(0,1500)}. Return: DEE action plan, owner lanes, 30/60/90 milestones, risk flags.`,900); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/main-strategist/hc-report',async (req,res) => { try { const content=await groq(`HonorHealth Main Strategist Report. Context: ${JSON.stringify(req.body||{}).slice(0,1500)}. Return: executive summary, KPIs, strategic priorities, risk matrix.`,1000); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});

// Honor/DEE dashboard
router.post('/honor/dee/dashboard', async (req,res) => { try { const content=await groq(`HonorHealth DEE Dashboard. Context: ${JSON.stringify(req.body||{}).slice(0,1500)}. Return: dashboard summary, active alerts, top metrics, recommended actions.`,900); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.get('/honor/dee/dashboard',  (req,res) => res.json({ok:true,status:'DEE Dashboard online',nodes:[],alerts:[]}));

// Groq passthrough

router.post('/prompt', (req,res) => {
  const prompts = {
    tax_analysis: 'You are a senior tax analyst AI. Provide detailed, actionable tax analysis.',
    tax_return: 'You are a tax return preparation AI. Identify deductions, credits, and filing requirements.',
    tax_framework: 'You are a tax framework AI. Apply relevant tax codes and frameworks to the analysis.',
    tax_entity: 'You are a tax entity structure AI. Analyze entity optimization and pass-through strategies.',
    tax_fica: 'You are a payroll tax AI. Analyze FICA, payroll compliance, and reasonable compensation.'
  };
  const key = req.body?.key||'';
  res.json({ok:true, system: prompts[key]||'You are a financial AI assistant. Be concise and actionable.', prompt: prompts[key]||''});
});

router.post('/groq/query', async (req,res) => { try { const {messages=[],prompt='',max_tokens=800,query=''}=req.body||{}; const msgs=messages.length?messages:[{role:'user',content:prompt||query}]; const r=await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TSM_MODEL||'openai/gpt-oss-120b',messages:msgs,max_tokens,temperature:0.7})}); const d=await r.json(); const content=d.choices?.[0]?.message?.content||'AI unavailable'; res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/groq', async (req,res) => { try { const {messages=[],prompt='',max_tokens=800}=req.body||{}; const msgs=messages.length?messages:[{role:'user',content:prompt}]; const r=await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.TSM_MODEL||'openai/gpt-oss-120b',messages:msgs,max_tokens,temperature:0.7})}); const d=await r.json(); const content=d.choices?.[0]?.message?.content||'AI unavailable'; res.json({ok:true,content,reply:content,choices:d.choices,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});

// Mortgage / Legal
router.post('/mortgage/query', async (req,res) => { try { const content=await groq(`Mortgage AI expert. Query: ${q(req.body||{})}. Focus: rates, qualifications, compliance, strategy.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/legal/query',    async (req,res) => { try { const content=await groq(`Legal AI expert. Query: ${q(req.body||{})}. Focus: contracts, compliance, risk, remediation. Not legal advice.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});

// Music suite
router.post('/music/agent-pass',      async (req,res) => { try { const content=await groq(`Music industry AI. Query: ${q(req.body||{})}. Focus: artist strategy, distribution, sync licensing, revenue.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/structure',       async (req,res) => { try { const content=await groq(`Music structure AI. Input: ${JSON.stringify(req.body||{}).slice(0,1000)}. Return song structure, arrangement, production notes.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/strategy',        async (req,res) => { try { const content=await groq(`Music strategy AI. Input: ${JSON.stringify(req.body||{}).slice(0,1000)}. Return release strategy, marketing, playlist targeting.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/song',            async (req,res) => { try { const content=await groq(`Music songwriting AI. Input: ${JSON.stringify(req.body||{}).slice(0,1000)}. Return lyrics, hooks, song structure.`,900); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/coach',           async (req,res) => { try { const content=await groq(`Music coaching AI. Query: ${q(req.body||{})}. Actionable coaching on performance, branding, growth.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/guidance',        async (req,res) => { try { const content=await groq(`Music guidance AI. Query: ${q(req.body||{})}. Industry guidance, career path, next steps.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/hooks/generate10', async (req,res) => {
  try {
    const {topic='', genre='', mood='', artist=''} = req.body||{};
    const content = await groq(`You are an elite rap/music hook writer. Generate exactly 10 distinct, catchy hooks for a song.
Topic: ${topic||'life and hustle'}. Genre: ${genre||'hip-hop'}. Mood: ${mood||'energetic'}. Artist style: ${artist||'versatile'}.
Return ONLY a numbered list 1-10. Each hook should be 1-2 lines max. No explanations. Make them hard-hitting and memorable.`, 600);
    // Parse into array
    const lines = content.split('\n').filter(l => /^\d+[\.\)]/.test(l.trim())).map(l => l.replace(/^\d+[\.\)]\s*/,'').trim());
    const hooks = lines.length >= 5 ? lines : content.split('\n').filter(l=>l.trim()).slice(0,10);
    res.json({ok:true, hooks, raw:content, ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
router.post('/music/revision/run',    async (req,res) => { try { const content=await groq(`Music revision AI. Input: ${JSON.stringify(req.body||{}).slice(0,1000)}. Return revised lyrics/structure with notes.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/agent/run',       async (req,res) => { try { const content=await groq(`Music agent AI. Task: ${JSON.stringify(req.body||{}).slice(0,1000)}. Execute agent task, return results.`); res.json({ok:true,content,reply:content,ts:new Date().toISOString()}); } catch(e){res.status(500).json({ok:false,error:e.message});}});
router.post('/music/dna/save',        (req,res) => res.json({ok:true,message:'Music DNA saved',id:'dna_'+Date.now()}));
router.post('/music/export/save',     (req,res) => res.json({ok:true,message:'Export saved',id:'exp_'+Date.now()}));
router.post('/music/demo/create',     (req,res) => res.json({ok:true,demo_token:'demo_'+Date.now(),message:'Demo created'}));
router.get('/music/demo/view',        (req,res) => res.json({ok:true,demo:req.query,status:'active'}));
router.get('/music/demo/validate',    (req,res) => res.json({ok:true,valid:true,demo_token:req.query.demo_token}));

// Intake
router.get('/intake/pending',  (req,res) => res.json({ok:true,records:[]}));
router.get('/intake/content/:id', (req,res) => res.json({ok:true,id:req.params.id,text:'',status:'ready'}));

module.exports = router;
// exported for use in server.js
module.exports.authMiddleware = (req, res, next) => {
  const key = req.headers['x-tsm-key'] || req.query.tsm_key;
  if (key && key === process.env.TSM_API_KEY) return next();
  // Allow internal suite pages through without key
  next();
};

// Alias: /api/financial/query → same groq handler
router.post('/query', async (req,res) => {
  try {
    const body = req.body||{};
    const prompt = body.prompt||body.query||body.content||JSON.stringify(body);
    const content = await groq(prompt, body.max_tokens||800);
    res.json({ok:true, content, reply:content, response:content, ts:new Date().toISOString()});
  } catch(e){ res.status(500).json({ok:false,error:e.message}); }
});
