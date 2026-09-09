'use strict';
// Training Intelligence — certification blueprint tracking + gap-driven study
// roadmap. Honesty pattern: blueprint domain weights are never guessed by an
// LLM and never hardcoded as "official". They live in
// data/training-intelligence/providers/<id>.json with verified/sourceUrl/
// lastVerified fields, start out verified:false with null weights, and only
// flip to verified:true through the admin-gated PUT route below once someone
// has actually checked them against a real Now Learning source. Every read
// route echoes the verified flag back so the frontend can show the
// "unverified — confirm against your Now Learning account" banner and must
// never suppress it while verified is false.

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const { requireRole } = require('../middleware/require-auth');
const { groqChat } = require('./_shared');

const PROVIDERS_DIR = path.join(__dirname, '..', 'data', 'training-intelligence', 'providers');
const ADMIN_ROLES = ['admin', 'manager'];

// Quiz question banks live in the same providers dir as <providerId>-questions.json.
// Same honesty pattern as the blueprint: hand-authored, starts verified:false,
// never LLM-generated at request time. The GET route below strips `correct`
// and `explanation` from choices before sending — those only come back after
// POST /submit grades the attempt server-side, so a user can't just read the
// answer out of the network tab before answering.
function loadQuestionBank(providerId) {
  const p = providerPath(providerId);
  if (!p) return null;
  const qPath = p.replace(/\.json$/, '-questions.json');
  if (!fs.existsSync(qPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(qPath, 'utf8'));
  } catch {
    return null;
  }
}

// Teach Me content is general domain-knowledge explanation ("what is
// Platform Implementation and what should I know about it"), not blueprint
// facts — an LLM explaining a well-known concept is a different honesty risk
// than an LLM guessing an exam's domain weight. The system prompt still
// explicitly forbids stating exam weights/item counts/pass scores, since
// those belong to the verified blueprint config, not a free-generated
// explanation. Cached in memory per (providerId, domainId) since the content
// doesn't change request to request and Groq calls aren't free.
global.TSM_TEACH_ME_CACHE = global.TSM_TEACH_ME_CACHE || {};

function teachMeSystemPrompt(providerDisplayName, domain) {
  const anchors = {
    'platform-overview-navigation': [
      'Platform architecture and core navigation',
      'Applications, modules, lists, forms, and records',
      'Application Navigator and navigation hierarchy',
      'Search, filtering, sorting, breadcrumbs, and list/form behavior',
      'Personalization versus configuration',
      'Core platform terminology'
    ],

    'instance-configuration': [
      'Instance-level configuration',
      'System properties and platform configuration',
      'Users, groups, and roles',
      'Applications, modules, forms, lists, and fields',
      'Configuration versus personalization',
      'Administrative settings'
    ],

    'configuring-applications-collaboration': [
      'Application configuration',
      'Tables, fields, forms, and lists',
      'UI Policies and UI Actions',
      'Business Rules at a conceptual level',
      'Notifications and collaboration',
      'Application development and configuration tools'
    ],

    'self-service-automation': [
      'Self-service experiences',
      'Service Catalog and catalog items',
      'Knowledge management',
      'Record Producers',
      'Workflow and automation',
      'Flow Designer concepts'
    ],

    'database-management-platform-security': [
      'ServiceNow data model',
      'Base and extended tables',
      'Fields, records, and relationships',
      'Database management concepts',
      'Access Controls (ACLs)',
      'Users, groups, roles, and security evaluation'
    ],

    'data-migration-integration': [
      'Import Sets',
      'Transform Maps and field mapping',
      'Data loading and migration',
      'Integration patterns',
      'REST and SOAP concepts',
      'IntegrationHub concepts',
      'Data validation and transformation'
    ]
  };

  const selectedAnchors =
    anchors[domain && domain.id] || [
      'The supplied certification domain',
      'Core administrator terminology',
      'Practical ServiceNow usage',
      'Configuration concepts relevant to the domain'
    ];

  return [
    `You are a certification study tutor for ${providerDisplayName}.`,
    '',
    'Teach ONE selected certification domain.',
    'The learner needs accurate, practical, exam-oriented instruction.',
    '',
    'AUTHORITY RULES:',
    '- The supplied provider blueprint defines the domain.',
    '- Never invent exam weights.',
    '- Never invent question counts.',
    '- Never invent a passing score.',
    '- Never claim this generated lesson is an official ServiceNow lesson.',
    '- Never copy official exam questions.',
    '- Use original examples and original knowledge-check questions.',
    '',
    'SELECTED DOMAIN:',
    domain && (domain.label || domain.id)
      ? (domain.label || domain.id)
      : 'Selected certification domain',
    '',
    'TEACHING ANCHORS:',
    selectedAnchors.map(x => `- ${x}`).join('\n'),
    '',
    'STAY ON DOMAIN:',
    'Keep the lesson centered on the selected domain.',
    'Only introduce supporting concepts when they directly help explain it.',
    'Do not drift into unrelated ServiceNow topics.',
    '',
    'REQUIRED STRUCTURE:',
    '# DOMAIN TITLE',
    '',
    '## What This Domain Covers',
    '## Core Concepts',
    '## Know the Difference',
    '## Practical Example',
    '## Exam Thinking',
    '## Key Terms',
    '',
    'For Key Terms use this exact valid Markdown format:',
    '| Term | Meaning |',
    '| --- | --- |',
    '| Example | Definition |',
    '',
    'Include 6-12 domain-relevant terms.',
    '',
    '## Knowledge Check',
    'Create exactly 3 original multiple-choice questions.',
    'Each must contain A, B, C, and D choices.',
    'Do not provide the answer key.',
    '',
    'QUALITY REQUIREMENTS:',
    '- Markdown only.',
    '- No JSON.',
    '- No code fences.',
    '- Use concrete ServiceNow examples.',
    '- Prefer reasoning and distinctions over trivia.',
    '- Do not invent official blueprint facts.',
    '- Do not end mid-sentence.',
    '- Do not end with a dangling colon, comma, conjunction, or preposition.',
    '- Do not use "and so on".',
    '- Do not say "continued".',
    '- Finish the complete lesson.'
  ].join('\n');
}

// Hands-on Lab generator. Same honesty boundary as Teach Me: a lab walking
// someone through "create an ACL on a PDI" is general product-usage
// knowledge, not a blueprint fact, so LLM generation is fine — but the
// system prompt still explicitly forbids stating exam weights, item counts,
// or passing scores, since those remain the verified blueprint's job alone.
// Cached per (providerId, domainId) like Teach Me. The knowledge-check
// answer key and the practical-challenge model guidance are held server-side
// in TSM_LAB_ANSWER_CACHE and only sent to the client once /submit is
// called, mirroring how the quiz bank strips `correct`/`explanation` from
// GET responses.
global.TSM_LAB_CACHE = global.TSM_LAB_CACHE || {};
global.TSM_LAB_ANSWER_CACHE = global.TSM_LAB_ANSWER_CACHE || {};

function labSystemPrompt(providerDisplayName) {
  return `You are a hands-on lab author for ${providerDisplayName} certification prep. ` +
    'Given one exam domain, write ONE hands-on lab assuming the learner has access to ' +
    'a free Personal Developer Instance (PDI) or equivalent sandbox. ' +
    'Respond with ONLY a single JSON object, no markdown fences, no commentary, matching ' +
    'exactly this shape:\n' +
    '{"title": string, "objective": string (1-2 sentences), ' +
    '"tasks": string[] (4-8 concrete numbered actions the learner performs in the sandbox), ' +
    '"knowledgeCheck": {"question": string, ' +
    '"choices": [{"id": "a","text": string},{"id":"b","text": string},{"id":"c","text": string},{"id":"d","text": string}], ' +
    '"correctChoiceId": one of "a"/"b"/"c"/"d", "explanation": string}, ' +
    '"practicalChallenge": {"prompt": string (asks the learner to explain WHY the lab behaved ' +
    'as it did), "guidance": string (a model answer / what a strong response covers)}}\n' +
    'Do NOT state or imply any specific exam weight percentage, question count, or passing ' +
    'score anywhere in the lab — those belong to the separately verified blueprint, not to ' +
    'you. Keep tasks concrete and actionable, not vague ("navigate to X", "create a Y named Z").';
}

function parseJsonLoose(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*|^```\s*|```$/g, '').trim();
  return JSON.parse(cleaned);
}

function providerPath(providerId) {
  // providerId comes straight from the URL; keep it to a safe slug so this
  // can never be turned into a path traversal read/write.
  if (!/^[a-z0-9-]+$/.test(providerId || '')) return null;
  return path.join(PROVIDERS_DIR, `${providerId}.json`);
}

function loadProvider(providerId) {
  const p = providerPath(providerId);
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function saveProvider(providerId, data) {
  const p = providerPath(providerId);
  if (!p) throw new Error('invalid providerId');
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// GET /api/training-intelligence/providers
// List known blueprint configs (id/displayName/verified only — not the full
// domain payload, so the picker list is cheap).
router.get('/api/training-intelligence/providers', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(PROVIDERS_DIR)
      .filter(f => f.endsWith('.json'))
      .filter(f => !f.endsWith('-questions.json'));
  } catch {
    return res.json({ ok: true, providers: [] });
  }
  const providers = files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PROVIDERS_DIR, f), 'utf8'));
      return {
        providerId: data.providerId,
        displayName: data.displayName,
        verified: !!data.verified,
        lastVerified: data.lastVerified || null
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
  res.json({ ok: true, providers });
});

// GET /api/training-intelligence/blueprint/:providerId
// Returns the blueprint config as-is, verified flag included. If verified is
// false, weight fields are null and the client is expected to render the
// unverified banner rather than compute anything off them.
router.get('/api/training-intelligence/blueprint/:providerId', (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });
  res.json({ ok: true, blueprint: data });
});

// PUT /api/training-intelligence/blueprint/:providerId
// Admin-only. This is the ONLY way domain weights or verified:true get set —
// no scraper, no LLM-guessed numbers. Body must include sourceUrl and mark
// verified explicitly; lastVerified is stamped server-side so it can't be
// backdated.
router.put('/api/training-intelligence/blueprint/:providerId', requireRole(ADMIN_ROLES), (req, res) => {
  const existing = loadProvider(req.params.providerId);
  if (!existing) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const { domains, sourceUrl, verified, note } = req.body || {};
  if (verified === true && !sourceUrl) {
    return res.status(400).json({ ok: false, error: 'sourceUrl is required to mark a blueprint verified' });
  }
  if (domains && !Array.isArray(domains)) {
    return res.status(400).json({ ok: false, error: 'domains must be an array' });
  }

  const updated = {
    ...existing,
    domains: domains || existing.domains,
    sourceUrl: sourceUrl !== undefined ? sourceUrl : existing.sourceUrl,
    verified: verified === true,
    verifiedBy: verified === true ? (req.tsmSession?.label || req.tsmSession?.staffId || 'admin') : null,
    lastVerified: verified === true ? new Date().toISOString() : null,
    note: note !== undefined ? note : existing.note
  };

  try {
    saveProvider(req.params.providerId, updated);
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Failed to save blueprint' });
  }
  res.json({ ok: true, blueprint: updated });
});

// Arbitrary-URL blueprint analyzer. This is the one place in the file that
// lets an LLM look at exam-structure content at all, so it gets the
// strictest guardrail: this route NEVER calls saveProvider. It only ever
// returns a `draft` object for a human to review — PUT /blueprint/:providerId
// above remains the sole write path, and that route still requires an
// explicit sourceUrl before verified can be set true. A scrape guessing
// domain names and weights from one random page is exactly the
// confidently-wrong-numbers failure this app exists to prevent, so the
// draft is always shaped and labeled as unverified, weight guesses are only
// populated when the page text explicitly states them as percentages, and
// nothing here can silently become the "official" blueprint.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i, /^127\./, /^0\.0\.0\.0$/, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^\[?::1\]?$/, /^\[?fe80:/i,
  /^\[?fc00:/i, /^\[?fd00:/i
];

function isSafeAnalyzeUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname;
  return !PRIVATE_HOST_PATTERNS.some(re => re.test(host));
}

// Dependency-free HTML-to-text: jsdom is only a devDependency in this repo,
// so pulling it into a production route risks breaking on a --omit=dev
// install. This is a blunt strip, not a real parser, but it's enough signal
// for the LLM extraction step below and adds nothing to the prod bundle.
function extractPageText(html, maxChars = 6000) {
  const withoutBlocks = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
  return decoded.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function slugifyLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'domain';
}

function analyzeUrlSystemPrompt() {
  return 'You are compiling a DRAFT certification-blueprint proposal from a single web page, ' +
    'for a human admin to manually verify before it is ever trusted. Respond with ONLY a single ' +
    'JSON object, no markdown fences, no commentary, matching exactly this shape:\n' +
    '{"displayName": string|null, "weightsStatedOnPage": boolean, ' +
    '"domains": [{"label": string, "weightGuess": number|null}], ' +
    '"confidence": "low"|"medium"|"high", "caveats": string}\n' +
    'Rules: only list domain names that literally appear on the page as exam-domain/blueprint ' +
    'section headings — never invent or infer domains that aren\'t evidenced by the text. Only ' +
    'set weightsStatedOnPage:true and fill in weightGuess numbers if the page explicitly states ' +
    'percentage weights for each domain; otherwise weightsStatedOnPage must be false and every ' +
    'weightGuess must be null. If the page does not look like an exam blueprint at all, return ' +
    'an empty domains array and explain why in caveats. Set confidence based on how directly the ' +
    'page states this structure (a vendor exam-guide page = higher; a third-party blog or forum ' +
    'summary = low, and say so in caveats).';
}

// POST /api/training-intelligence/analyze-url
// Admin-only, same trust boundary as the PUT route this feeds into. Body:
// { url, providerId? }. Fetches one page, extracts a candidate domain list
// via the shared Groq helper, and returns it as an unverified draft — never
// persisted, never given a verified:true path. The admin reviews the draft,
// cross-checks it against a real source by hand, edits as needed, and only
// then calls PUT /blueprint/:providerId themselves to save it (still
// verified:false unless they explicitly mark it true with a sourceUrl).
router.post('/api/training-intelligence/analyze-url', requireRole(ADMIN_ROLES), async (req, res) => {
  const { url, providerId } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'url is required' });
  }
  if (!isSafeAnalyzeUrl(url)) {
    return res.status(400).json({ ok: false, error: 'url must be a public http(s) address' });
  }
  if (providerId && !/^[a-z0-9-]+$/.test(providerId)) {
    return res.status(400).json({ ok: false, error: 'providerId must be a lowercase slug' });
  }

  let html;
  try {
    const resp = await axios.get(url, {
      timeout: 8000,
      maxContentLength: 2_000_000,
      maxRedirects: 3,
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TSM-TrainingIntelligence/1.0)' },
      validateStatus: s => s >= 200 && s < 400
    });
    html = resp.data;
  } catch (e) {
    return res.status(502).json({ ok: false, error: `Could not fetch that URL: ${e.message || 'request failed'}` });
  }

  const pageText = extractPageText(html);
  if (!pageText) {
    return res.status(502).json({ ok: false, error: 'Fetched the page but found no readable text on it' });
  }

  let parsed;
  try {
    const raw = await groqChat(
      analyzeUrlSystemPrompt(),
      `Page URL: ${url}\n\nPage text:\n${pageText}`,
      1200
    );
    parsed = parseJsonLoose(raw);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Draft extraction failed' });
  }

  const domains = Array.isArray(parsed && parsed.domains) ? parsed.domains.slice(0, 20) : [];
  const weightsStated = !!(parsed && parsed.weightsStatedOnPage);

  const draft = {
    providerId: providerId || null,
    displayName: (parsed && parsed.displayName) || null,
    sourceUrl: url,
    verified: false,
    verifiedBy: null,
    lastVerified: null,
    confidence: (parsed && parsed.confidence) || 'low',
    weightsStatedOnPage: weightsStated,
    domains: domains.map(d => ({
      id: slugifyLabel(d.label),
      label: d.label,
      weight: null,
      weightGuessFromPage: weightsStated && typeof d.weightGuess === 'number' ? d.weightGuess : null
    })),
    caveats: (parsed && parsed.caveats) || null,
    note: 'DRAFT extracted from a single URL by an LLM — not verified. An admin must confirm ' +
      'this against the actual source by hand and use PUT /blueprint/:providerId to save it; ' +
      'this endpoint never writes to disk on its own.'
  };

  res.json({ ok: true, draft });
});

// GET /api/training-intelligence/roadmap/:providerId
// Gap-driven study roadmap generation off the blueprint config. When the
// blueprint isn't verified yet, this returns an evenly-weighted roadmap
// explicitly labeled as an estimate rather than pretending to prioritize by
// real exam weight.
router.get('/api/training-intelligence/roadmap/:providerId', (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const domains = Array.isArray(data.domains) ? data.domains : [];
  const n = domains.length || 1;

  const roadmap = domains.map(d => ({
    id: d.id,
    label: d.label,
    weight: data.verified ? d.weight : null,
    estimatedWeight: data.verified ? null : Math.round((100 / n) * 10) / 10,
    priority: data.verified && typeof d.weight === 'number' ? d.weight : null
  }));

  if (data.verified) {
    roadmap.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  res.json({
    ok: true,
    providerId: data.providerId,
    verified: !!data.verified,
    basis: data.verified ? 'blueprint-weight' : 'even-split-estimate',
    roadmap
  });
});

// GET /api/training-intelligence/teach/:providerId/:domainId
// Teach Me content layer. Generates a general study explanation of one
// blueprint domain via the shared Groq helper. The auto-detect/any-URL
// provider generator is still explicitly deferred — this only teaches
// domains that already exist in a hand-authored provider config, so there's
// no path for the LLM to invent a domain that isn't real.
router.get('/api/training-intelligence/teach/:providerId/:domainId', async (req, res) => {
  const data = loadProvider(req.params.providerId);

  if (!data) {
    return res.status(404).json({
      ok: false,
      error: 'Unknown provider'
    });
  }

  const domain = (data.domains || []).find(
    d => d.id === req.params.domainId
  );

  if (!domain) {
    return res.status(404).json({
      ok: false,
      error: 'Unknown domain for this provider'
    });
  }

  const TEACH_ME_PROMPT_VERSION =
    '2026-CSA-DOMAIN-ANCHORS-V3';

  const cacheKey =
    `${TEACH_ME_PROMPT_VERSION}:${req.params.providerId}:${req.params.domainId}`;

  const cached =
    global.TSM_TEACH_ME_CACHE[cacheKey];

  if (cached) {
    return res.json({
      ok: true,
      providerId: data.providerId,
      domainId: domain.id,
      label: domain.label,
      verified: !!data.verified,
      content: cached,
      cached: true
    });
  }

  try {
    const content = await groqChat(
      teachMeSystemPrompt(data.displayName, domain),
      `Teach the "${domain.label}" domain completely. Finish every required section.`,
      2200
    );

    const normalized =
      String(content || '')
        .replace(/\r\n/g, '\n')
        .trim();

    const requiredSections = [
      '## What This Domain Covers',
      '## Core Concepts',
      '## Know the Difference',
      '## Practical Example',
      '## Exam Thinking',
      '## Key Terms',
      '## Knowledge Check'
    ];

    const missingSections =
      requiredSections.filter(
        section => !normalized.includes(section)
      );

    const looksIncomplete =
      !normalized ||
      missingSections.length > 0 ||
      /[-–—:]\s*(locate|understand|know|identify|review|recognize|use|configure|learn|interpret)\s*$/i.test(normalized) ||
      /,\s*$/i.test(normalized) ||
      /:\s*$/i.test(normalized) ||
      /\b(and|or|to|with|for|the|a|an|of|in|on|by|from)\s*$/i.test(normalized);

    if (looksIncomplete) {
      return res.status(502).json({
        ok: false,
        error: 'Teach Me generation returned incomplete lesson content',
        incomplete: true,
        missingSections
      });
    }

    if (!global.TSM_TEACH_ME_CACHE) {
      global.TSM_TEACH_ME_CACHE = {};
    }

    global.TSM_TEACH_ME_CACHE[cacheKey] =
      normalized;

    return res.json({
      ok: true,
      providerId: data.providerId,
      domainId: domain.id,
      label: domain.label,
      verified: !!data.verified,
      content: normalized,
      cached: false
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: e.message || 'Teach Me generation failed'
    });
  }
});

// GET /api/training-intelligence/quiz/:providerId/:domainId
// Returns this domain's questions with `correct` and `explanation` stripped
// from every choice — the client only gets id/text. Grading happens in
// POST /submit below so answers are never sitting in a GET response.
router.get('/api/training-intelligence/quiz/:providerId/:domainId', (req, res) => {
  const bank = loadQuestionBank(req.params.providerId);
  if (!bank) return res.status(404).json({ ok: false, error: 'No question bank for this provider yet' });

  const questions = (bank.questions || []).filter(q => q.domainId === req.params.domainId);
  if (!questions.length) return res.status(404).json({ ok: false, error: 'No questions for this domain yet' });

  const stripped = questions.map(q => ({
    id: q.id,
    domainId: q.domainId,
    question: q.question,
    choices: q.choices.map(c => ({
      id: c.id,
      text: c.text
    }))
  }));

  res.json({ ok: true, providerId: req.params.providerId, domainId: req.params.domainId, verified: !!bank.verified, questions: stripped });
});

// POST /api/training-intelligence/quiz/:providerId/submit
// Body: { answers: [{ questionId, choiceId }] }. Grades against the server
// copy of the bank and returns per-question correctness + explanation, plus
// a domain score. Stateless — no attempt is persisted server-side; the
// client rolls attempts into its own local readiness/mastery report.
router.post('/api/training-intelligence/quiz/:providerId/submit', (req, res) => {
  const bank = loadQuestionBank(req.params.providerId);
  if (!bank) return res.status(404).json({ ok: false, error: 'No question bank for this provider yet' });

  const answers = Array.isArray(req.body && req.body.answers) ? req.body.answers : null;
  if (!answers || !answers.length) return res.status(400).json({ ok: false, error: 'answers array is required' });

  const byId = {};
  (bank.questions || []).forEach(q => { byId[q.id] = q; });

  let correctCount = 0;
  const results = answers.map(a => {
    const q = byId[a.questionId];
    if (!q) return { questionId: a.questionId, error: 'unknown question' };
    const choice = q.choices.find(c => c.id === a.choiceId);
    const correctChoice = q.choices.find(c => c.correct === true);
    const isCorrect = !!choice && choice.correct === true;
    if (isCorrect) correctCount++;
    return {
      questionId: q.id,
      domainId: q.domainId,
      correct: isCorrect,
      pickedChoiceId: a.choiceId || null,
      correctChoiceId: correctChoice ? correctChoice.id : null,
      choices: q.choices.map(c => ({
        id: c.id,
        text: c.text,
        correct: c.correct === true,
        explanation: c.explanation || null,
        knowledge: Array.isArray(c.knowledge) ? c.knowledge : []
      }))
    };
  });

  // Machine-readable knowledge exposure. Every option shown during
  // a graded attempt contributes its reusable knowledge, including incorrect
  // distractors. This is intentionally separate from mastery.
  const exposureByDomain = {};

  results.forEach(result => {
    if (!result || !result.domainId || !Array.isArray(result.choices)) return;

    if (!exposureByDomain[result.domainId]) {
      exposureByDomain[result.domainId] = {
        domainId: result.domainId,
        questionCount: 0,
        concepts: []
      };
    }

    exposureByDomain[result.domainId].questionCount++;

    result.choices.forEach(choice => {
      const knowledge = Array.isArray(choice.knowledge)
        ? choice.knowledge
        : [];

      knowledge.forEach(item => {
        if (!item || typeof item !== 'string') return;

        if (!exposureByDomain[result.domainId].concepts.includes(item)) {
          exposureByDomain[result.domainId].concepts.push(item);
        }
      });
    });
  });

  const knowledgeExposure = Object.values(exposureByDomain);

  res.json({
    ok: true,
    providerId: req.params.providerId,
    verified: !!bank.verified,
    score: results.length ? Math.round((correctCount / results.length) * 100) : 0,
    correctCount,
    total: results.length,
    knowledgeExposure,
    results
  });
});


// POST /api/training-intelligence/readiness/:providerId
// Calculates weighted certification readiness from domain mastery scores.
//
// Body:
// {
//   "attempts": [
//     { "domainId": "platform-overview-navigation", "score": 75 },
//     { "domainId": "database-management-platform-security", "score": 60 }
//   ]
// }
//
// Readiness is intentionally derived from the provider blueprint rather than
// guessed by the client. Official domain weights are only applied when the
// provider has been administratively verified. Until then, the endpoint
// returns the domain scores but does not present them as official weighted
// exam readiness.
router.post('/api/training-intelligence/readiness/:providerId', (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const domains = Array.isArray(data.domains) ? data.domains : [];
  if (!domains.length) {
    return res.status(400).json({ ok: false, error: 'Provider has no domains configured' });
  }

  const attempts = Array.isArray(req.body && req.body.attempts)
    ? req.body.attempts
    : null;

  if (!attempts || !attempts.length) {
    return res.status(400).json({
      ok: false,
      error: 'attempts array is required'
    });
  }

  const domainById = {};
  domains.forEach(d => {
    domainById[d.id] = d;
  });

  // Aggregate multiple attempts by domain using the average score.
  // This keeps the endpoint stateless while allowing the client to send
  // its complete local attempt history.
  const grouped = {};

  attempts.forEach(a => {
    if (!a || !domainById[a.domainId]) return;

    const rawScore = Number(a.score);
    if (!Number.isFinite(rawScore)) return;

    const score = Math.max(0, Math.min(100, rawScore));

    if (!grouped[a.domainId]) grouped[a.domainId] = [];
    grouped[a.domainId].push(score);
  });

  const domainResults = domains.map(d => {
    const scores = grouped[d.id] || [];
    const mastery = scores.length
      ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10
      : null;

    const verifiedWeight =
      data.verified && typeof d.weight === 'number'
        ? d.weight
        : null;

    const weightedContribution =
      mastery !== null && verifiedWeight !== null
        ? Math.round((mastery * verifiedWeight / 100) * 10) / 10
        : null;

    return {
      domainId: d.id,
      label: d.label,
      weight: verifiedWeight,
      mastery,
      attempts: scores.length,
      weightedContribution
    };
  });

  const scoredDomains = domainResults.filter(d => d.mastery !== null);

  let readiness = null;

  if (data.verified) {
    readiness = Math.round(
      domainResults.reduce(
        (sum, d) => sum + (d.weightedContribution || 0),
        0
      ) * 10
    ) / 10;
  }

  const coverage = Math.round(
    (scoredDomains.length / domains.length) * 1000
  ) / 10;

  res.json({
    ok: true,
    providerId: data.providerId,
    verified: !!data.verified,
    basis: data.verified
      ? 'verified-blueprint-weighted-mastery'
      : 'unverified-blueprint-readiness-withheld',
    readiness,
    coverage,
    domains: domainResults
  });
});

// GET /api/training-intelligence/lab/:providerId/:domainId
// Generates (or returns the cached) hands-on lab for a domain. The response
// never includes correctChoiceId, the knowledge-check explanation, or the
// practical-challenge guidance — those are held server-side and only
// revealed by POST /submit below.
router.get('/api/training-intelligence/lab/:providerId/:domainId', async (req, res) => {
  const data = loadProvider(req.params.providerId);
  if (!data) return res.status(404).json({ ok: false, error: 'Unknown provider' });

  const domain = (data.domains || []).find(d => d.id === req.params.domainId);
  if (!domain) return res.status(404).json({ ok: false, error: 'Unknown domain for this provider' });

  const cacheKey = `${req.params.providerId}:${req.params.domainId}`;
  const cached = global.TSM_LAB_CACHE[cacheKey];
  if (cached) return res.json({ ok: true, labId: cacheKey, ...cached });

  let lab;
  try {
    const raw = await groqChat(
      labSystemPrompt(data.displayName),
      `Write a hands-on lab for the "${domain.label}" domain.`,
      1800
    );
    lab = parseJsonLoose(raw);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Lab generation failed' });
  }

  if (!lab || !lab.knowledgeCheck || !Array.isArray(lab.knowledgeCheck.choices)) {
    return res.status(502).json({ ok: false, error: 'Lab generation returned an unexpected shape' });
  }

  global.TSM_LAB_ANSWER_CACHE[cacheKey] = {
    correctChoiceId: lab.knowledgeCheck.correctChoiceId,
    explanation: lab.knowledgeCheck.explanation,
    guidance: lab.practicalChallenge ? lab.practicalChallenge.guidance : null
  };

  const client = {
    providerId: data.providerId,
    domainId: domain.id,
    label: domain.label,
    title: lab.title,
    objective: lab.objective,
    tasks: lab.tasks || [],
    knowledgeCheck: {
      question: lab.knowledgeCheck.question,
      choices: lab.knowledgeCheck.choices.map(c => ({ id: c.id, text: c.text }))
    },
    practicalChallenge: {
      prompt: lab.practicalChallenge ? lab.practicalChallenge.prompt : null
    }
  };
  global.TSM_LAB_CACHE[cacheKey] = client;
  res.json({ ok: true, labId: cacheKey, ...client });
});

// POST /api/training-intelligence/lab/:providerId/:domainId/submit
// Body: { labId, choiceId }. Grades the knowledge-check pick against the
// server-side answer cache and returns correctness + explanation, plus the
// practical-challenge model guidance for self-review (the practical
// challenge is open-ended free response, so it's self-graded by the
// learner against this guidance rather than auto-scored).
router.post('/api/training-intelligence/lab/:providerId/:domainId/submit', (req, res) => {
  const cacheKey = `${req.params.providerId}:${req.params.domainId}`;
  const { labId, choiceId } = req.body || {};

  if (labId !== cacheKey) {
    return res.status(400).json({ ok: false, error: 'labId does not match this provider/domain, or the lab expired — fetch it again' });
  }
  const answer = global.TSM_LAB_ANSWER_CACHE[cacheKey];
  if (!answer) return res.status(404).json({ ok: false, error: 'No lab generated for this domain yet' });

  const isCorrect = !!choiceId && choiceId === answer.correctChoiceId;
  res.json({
    ok: true,
    labId: cacheKey,
    knowledgeCheck: {
      correct: isCorrect,
      correctChoiceId: answer.correctChoiceId,
      explanation: answer.explanation
    },
    practicalChallengeGuidance: answer.guidance
  });
});

// TSM FIX 2026-09-09: tsm-career-training-platform.html's GENERATE SCENARIO /
// GRADE ANSWER buttons, the Interview Q&A generator, and the "explain/quiz/
// interview" tutor buttons all POST to /api/career/ai-complete expecting an
// Anthropic-Messages-shaped response ({content:[{type:'text',text}]}) — the
// route never existed on the backend (every click just fell through to the
// fetch's catch and showed "Error."). Real fix, same pattern as
// /api/music/sweet/ai and this file's own groqChat() call sites above:
// backend proxies to Groq (browser has no key and would 401 against
// api.anthropic.com directly), then reshapes the plain string reply into the
// Anthropic-Messages shape so all four existing call sites work unmodified.
router.post('/api/career/ai-complete', async (req, res) => {
  const { messages, maxTokens } = req.body || {};
  const userMessage = Array.isArray(messages)
    ? messages.filter(m => m && m.role === 'user').map(m => m.content).join('\n\n')
    : '';
  if (!userMessage) {
    return res.status(400).json({ error: 'messages[] with at least one user message is required' });
  }
  const capped = Math.min(Number(maxTokens) || 1000, 2000);
  try {
    const text = await groqChat(
      'You are a helpful, direct study assistant for Microsoft AB-100/AI-103 certification and enterprise presales training. No markdown headers, no preamble.',
      userMessage,
      capped
    );
    if (!text) {
      return res.status(502).json({ error: 'Model returned an empty response.' });
    }
    res.json({ content: [{ type: 'text', text }] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'AI request failed.' });
  }
});

module.exports = router;