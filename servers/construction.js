
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


// Root route aliases for /api/audit and /api/chat
router.post('/', async (req,res) => {
  try {
    const {query='',message='',messages=[],nodeKey='general',app='',factor='',sector=''} = req.body||{};
    const userMsg = messages.filter(m=>m.role==='user').map(m=>m.content).join(' ');
    const sysMsg = messages.filter(m=>m.role==='system').map(m=>m.content).join(' ');
    const q = query||message||userMsg||'';
    const content = await groq(sysMsg ? sysMsg + '\n\nUser: ' + q : `Construction AI. Node: ${nodeKey||sector||'general'}. Factor: ${factor}. Query: ${q}. Focus: job costing, subcontractors, lien compliance, OSHA, project financials.`);
    res.json({ok:true,content,reply:content,result:content,ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

// ask + query alias
router.post('/ask', async (req,res) => {
  try {
    const {query='',nodeKey='general',messages=[]} = req.body||{};
    const q = query||messages.map(m=>m.content).join(' ');
    const content = await groq(`Construction AI. Node: ${nodeKey}. Query: ${q}. Focus: job costing, subcontractors, lien compliance, project close.`);
    res.json({ok:true,content,reply:content,ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
router.post('/query', async (req,res) => {
  try {
    const {query='',message='',messages=[],nodeKey='general',app=''} = req.body||{};
    const q = query||message||messages.map(m=>m.content).join(' ');
    const content = await groq(`Construction AI for ${app||'TSM'}. Node: ${nodeKey}. Query: ${q}. Focus: job costing, subcontractors, lien compliance, project close.`);
    res.json({ok:true,content,reply:content,ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
router.get('/nodes', (req,res) => res.json({ok:true,nodes:['job-costing','subcontractors','lien','compliance','project-close','vendors','payroll','equipment','permits','insurance']}));
router.post('/nodes/:node', async (req,res) => {
  try {
    const {node} = req.params;
    const bnca = await groq(`Construction node ${node} BNCA. Payload: ${JSON.stringify(req.body||{}).slice(0,400)}. Top issue, actions, owner lane.`);
    res.json({ok:true,node,result:{node,status:'READY',bnca,confidence:90},ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});
router.post('/bnca', async (req,res) => {
  try {
    const content = await groq(`Construction BNCA. Context: ${JSON.stringify(req.body||{}).slice(0,2000)}. Top issue, metrics, why it matters, best next action, owner lanes, confidence.`, 900);
    res.json({ok:true,content,reply:content,ts:new Date().toISOString()});
  } catch(e){res.status(500).json({ok:false,error:e.message});}
});

module.exports = router;
