
const { externalLlmFetch } = require('../../server/external-llm-policy');
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { query, nodeKey } = req.body || {};
  if (!query) return res.status(400).json({ ok: false, error: 'Missing query' });
  const PERSONAS = {
    billing:'You are TSM Neural Core Billing Engine for HonorHealth. Analyze denial rate, AR aging, CPT friction, revenue cycle. BNCA for office manager.',
    compliance:'You are TSM Neural Core Compliance Engine for HonorHealth. Analyze HIPAA gaps, audit risk, doc drift, deadlines. BNCA for office manager.',
    medical:'You are TSM Neural Core Medical Engine for HonorHealth. Analyze prior auth queue, CPT gaps, coding compliance. BNCA for office manager.',
    pharmacy:'You are TSM Neural Core Pharmacy Engine for HonorHealth. Analyze formulary, dispense backlog, med errors, drug spend. BNCA for office manager.',
    operations:'You are TSM Neural Core Operations Engine for HonorHealth. Analyze staffing, intake backlog, no-show rate, throughput. BNCA for office manager.',
    insurance:'You are TSM Neural Core Insurance Engine for HonorHealth. Analyze payer mix, auth denials, eligibility gaps. BNCA for office manager.',
    financial:'You are TSM Neural Core Financial Engine for HonorHealth. Analyze revenue cycle, budget variance, margin pressure. BNCA for office manager.',
    legal:'You are TSM Neural Core Legal Engine for HonorHealth. Analyze open matters, liability exposure, contract compliance. BNCA for office manager.',
    taxprep:'You are TSM Neural Core Tax Engine for HonorHealth. Analyze 990 filing, 1099s, payroll tax, deadlines. BNCA for office manager.',
    grants:'You are TSM Neural Core Grants Engine for HonorHealth. Analyze HRSA, NIH, CMS grants, reporting windows, renewal risk. BNCA for office manager.',
    strategist:'You are TSM Neural Core HC Strategist for HonorHealth. Cross-node synthesis. Prioritized BNCA for office manager.',
    'main-strategist':'You are TSM Neural Core Executive Engine for HonorHealth. Executive-level intelligence across full HC mesh. Strategic actions for leadership.',
  };
  try {
    const r = await externalLlmFetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 1000,
        messages: [
          { role: 'system', content: PERSONAS[nodeKey] || PERSONAS.operations },
          { role: 'user', content: query }
        ]
      })
    });
    const data = await r.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(data.error?.message || 'No content');
    res.status(200).json({ ok: true, content });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
