
const { externalLlmFetch } = require('../server/external-llm-policy');
require('dotenv').config();
const express = require('express');
const router = express.Router();

const NODE_PERSONAS = {
  billing:    'You are TSM Neural Core Billing Engine for HonorHealth Scottsdale-Shea. Analyze denial rate, AR aging, CPT/ICD friction, revenue cycle drag. Respond as BNCA advisor for the office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  compliance: 'You are TSM Neural Core Compliance Engine for HonorHealth Scottsdale-Shea. Analyze HIPAA gaps, documentation drift, audit risk, regulatory deadlines. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  medical:    'You are TSM Neural Core Medical Engine for HonorHealth Scottsdale-Shea. Analyze prior auth queue, CPT gaps, coding compliance, clinical throughput. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  pharmacy:   'You are TSM Neural Core Pharmacy Engine for HonorHealth Scottsdale-Shea. Analyze formulary compliance, dispense backlog, med errors, drug spend. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  operations: 'You are TSM Neural Core Operations Engine for HonorHealth Scottsdale-Shea. Analyze staffing coverage, intake backlog, no-show rate, scheduling friction, throughput blockers. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  insurance:  'You are TSM Neural Core Insurance Engine for HonorHealth Scottsdale-Shea. Analyze payer mix, auth denials, eligibility gaps, reimbursement friction. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  financial:  'You are TSM Neural Core Financial Engine for HonorHealth Scottsdale-Shea. Analyze revenue cycle, budget variance, cost per encounter, margin pressure, cash flow. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  legal:      'You are TSM Neural Core Legal Engine for HonorHealth Scottsdale-Shea. Analyze open matters, malpractice exposure, contract compliance, liability flags. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  taxprep:    'You are TSM Neural Core Tax Engine for HonorHealth Scottsdale-Shea. Analyze 990 filing status, 1099 exposure, payroll tax compliance, upcoming deadlines. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  grants:     'You are TSM Neural Core Grants Engine for HonorHealth Scottsdale-Shea. Analyze HRSA, NIH, CMS Innovation, foundation grants. Surface reporting windows, renewal risk, funding gaps. BNCA for office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
  strategist: 'You are TSM Neural Core HC Strategist for HonorHealth Scottsdale-Shea. Cross-node synthesis across Billing, Compliance, Medical, Pharmacy, Operations, Insurance, Financial, Legal, Tax, Grants. Top 3 cross-node risks. Prioritized BNCA for office manager.',
  'main-strategist': 'You are TSM Neural Core Executive Intelligence Engine for HonorHealth. System-wide operational intelligence. Revenue risk, compliance exposure, operational drag. Strategic next actions for healthcare leadership.',
  general:    'You are TSM Neural Core Healthcare Intelligence Engine for HonorHealth Scottsdale-Shea. Provide BNCA analysis for the office manager. Format: TOP ISSUE / WHY IT MATTERS / BEST NEXT ACTIONS / OWNER LANE / CONFIDENCE.',
};

const groq = async (systemPrompt, userQuery, maxTokens=900) => {
  const r = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.TSM_MODEL || 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userQuery }
      ],
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content || 'TSM Neural Core unavailable';
};

// Core ask + query
router.post('/ask', async (req, res) => {
  try {
    const { query='', nodeKey='general', messages=[] } = req.body || {};
    const q = query || messages.map(m => m.content).join(' ');
    const persona = NODE_PERSONAS[nodeKey] || NODE_PERSONAS.general;
    const content = await groq(persona, q);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/query', async (req, res) => {
  try {
    const { query='', message='', messages=[], nodeKey='general' } = req.body || {};
    const q = query || message || messages.map(m => m.content).join(' ');
    const persona = NODE_PERSONAS[nodeKey] || NODE_PERSONAS.general;
    const content = await groq(persona, q);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Nodes
router.get('/nodes', (req, res) => res.json({ ok:true, nodes: Object.keys(NODE_PERSONAS) }));
router.post('/nodes/:node', async (req, res) => {
  try {
    const { node } = req.params;
    const persona = NODE_PERSONAS[node] || NODE_PERSONAS.general;
    const payload = JSON.stringify(req.body || {}).slice(0, 400);
    const content = await groq(persona, `Analyze this node report payload and return BNCA: ${payload}`);
    res.json({ ok:true, node, result:{ node, status:'READY', bnca:content, confidence:92 }, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/node', async (req, res) => {
  try {
    const { node='general', query='' } = req.body || {};
    const persona = NODE_PERSONAS[node] || NODE_PERSONAS.general;
    const content = await groq(persona, query);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Layer 2
router.post('/layer2', async (req, res) => {
  try {
    const { query='', context='', messages=[] } = req.body || {};
    const q = query || messages.map(m => m.content).join(' ');
    const content = await groq(NODE_PERSONAS.strategist, `Context: ${context}. Query: ${q}. Provide mesh intelligence: cross-node patterns, risk signals, revenue impact, 30/60/90 actions.`, 1000);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Tasks / Delegate
router.post('/tasks', async (req, res) => {
  try {
    const { query='', context='' } = req.body || {};
    const content = await groq(NODE_PERSONAS.general, `Task Manager. Context: ${context}. Query: ${query}. Return prioritized task list with owner, deadline, priority.`);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/delegate', async (req, res) => {
  try {
    const { task='', to='', context='' } = req.body || {};
    const content = await groq(NODE_PERSONAS.general, `Delegation brief. Task: ${task}. Delegate to: ${to}. Context: ${context}. Return accountability steps.`);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Brief / Strategist / CFO
router.post('/brief', async (req, res) => {
  try {
    const { context='', scope='daily' } = req.body || {};
    const content = await groq(NODE_PERSONAS['main-strategist'], `${scope} intelligence brief. Context: ${context}. Return: top 3 priorities, key metrics, risks, actions.`, 900);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/strategist', async (req, res) => {
  try {
    const { query='', context='' } = req.body || {};
    const content = await groq(NODE_PERSONAS.strategist, `Context: ${context}. Query: ${query}.`, 900);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/cfo-report', async (req, res) => {
  try {
    const { context='', period='monthly' } = req.body || {};
    const content = await groq(NODE_PERSONAS.financial, `CFO Report. Period: ${period}. Context: ${context}. Revenue metrics, cost analysis, variance, recommendations.`, 1000);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

router.post('/doc-analysis', async (req, res) => {
  try {
    const { content:doc='', docType='', query='', nodeKey='general' } = req.body || {};
    const persona = NODE_PERSONAS[nodeKey] || NODE_PERSONAS.general;
    const content = await groq(persona, `Document Analysis. Type: ${docType}. Query: ${query}. Document: ${doc.slice(0,3000)}. Extract key findings, risks, required actions.`, 900);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// BNCA
router.post('/bnca', async (req, res) => {
  try {
    const { nodeKey='general' } = req.body || {};
    const persona = NODE_PERSONAS[nodeKey] || NODE_PERSONAS.strategist;
    const content = await groq(persona, `Full BNCA analysis. Context: ${JSON.stringify(req.body||{}).slice(0,2000)}`, 900);
    res.json({ ok:true, content, reply:content, ts:new Date().toISOString() });
  } catch(e) { res.status(500).json({ ok:false, error:e.message }); }
});

// Reports
router.get('/reports',  (req, res) => res.json({ ok:true, reports:[] }));
router.post('/reports', (req, res) => {
  const { title='Report', company='HonorHealth', summary='' } = req.body || {};
  res.json({ ok:true, report:{ id:'r'+Date.now(), title, company, summary, createdAt:new Date().toISOString() } });
});

module.exports = router;
