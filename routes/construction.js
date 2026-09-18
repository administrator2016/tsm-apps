'use strict';
const express = require('express');
const router  = express.Router();
const { groqChat, SP } = require('./_shared');
const { requireAnyAuth } = require('../middleware/require-auth');

// =====================================================
// CONSTRUCTION DOC UPLOADER — drag/drop analysis intake
// Extracts real text from an uploaded doc/contract so BNCA analysis
// (via /api/ai/query) is grounded in the actual file, not a generic
// canned prompt. Mirrors the extraction approach already proven in
// routes/finops.js (upload-doc) — same libraries, same guardrails.
// =====================================================
const multer = require('multer');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// File types where extractConstructionDocText() returns REAL file content,
// not an empty/placeholder string. Classification and downstream grounding
// must only ever run against these.
const REAL_TEXT_EXTENSIONS = ['.txt', '.csv', '.md', '.json', '.pdf', '.docx', '.xlsx', '.xls'];
function hasRealTextContent(filename) {
  const name = (filename || '').toLowerCase();
  return REAL_TEXT_EXTENSIONS.some(ext => name.endsWith(ext));
}

async function extractConstructionDocText(file) {
  const name = (file.originalname || 'uploaded-document').toLowerCase();
  const raw = file.buffer || Buffer.from('');
  let text = '';

  try {
    if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.md') || name.endsWith('.json')) {
      text = raw.toString('utf8');
    } else if (name.endsWith('.pdf')) {
      const parser = new PDFParse({ data: raw });
      try {
        const result = await parser.getText();
        text = result.text || '';
      } finally {
        await parser.destroy();
      }
    } else if (name.endsWith('.docx')) {
      const result = await mammoth.extractRawText({ buffer: raw });
      text = result.value || '';
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const workbook = XLSX.read(raw, { type: 'buffer' });
      text = workbook.SheetNames.map(sheetName =>
        XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])
      ).join('\n\n');
    } else {
      text = '';
    }
  } catch (err) {
    console.error(`extractConstructionDocText failed for ${file.originalname}:`, err.message);
    text = '';
  }

  return String(text || '').slice(0, 6000);
}

function classifyConstructionDoc(text) {
  const t = text.toLowerCase();
  if (t.includes('permit') || t.includes('municipal') || t.includes('inspection')) return 'Permit / Municipal Document';
  if (t.includes('change order')) return 'Change Order';
  if (t.includes('lien') || t.includes('bond claim')) return 'Lien / Bond Document';
  if (t.includes('subcontract') || t.includes('sub-contract')) return 'Subcontractor Agreement';
  if (t.includes('osha') || t.includes('incident report') || t.includes('safety')) return 'Safety / OSHA Document';
  if (t.includes('swppp') || t.includes('stormwater') || t.includes('nepa')) return 'Environmental Compliance Document';
  if (t.includes('bid') || t.includes('proposal') || t.includes('estimate')) return 'Bid / Proposal';
  if (t.includes('retainage') || t.includes('pay application') || t.includes('draw request')) return 'Pay Application / Draw Request';
  if (t.includes('contract') || t.includes('indemnif') || t.includes('agreement')) return 'Contract';
  return 'Uploaded Construction Document';
}


// TSM FIX 2026-08-27: this handler is the one that actually runs on every
// real request (it's mounted via app.use(require('./routes/construction'))
// in server.js *before* server.js's own inline app.post('/api/construction/
// query', ...), and this handler always terminates the response without
// calling next() — so Express never reaches that later, more complete
// definition; it's dead code). This version was silently dropping
// `req.body.system` and hardcoding SP.construction instead, which meant
// CON_ENGINE_SYSTEM_GUARD — the deadline/date-honesty guard
// construction-war-room.html sends on every one of its 6 engine calls
// (never infer a lien-filing/abatement date not stated in the source doc;
// never claim a notice was sent unless the document confirms it) — never
// reached the model. Restored the system-passthrough the dead code already
// had, and added the same recent-activity memory logging every other live
// vertical query endpoint does (see recordVerticalMemory in server.js;
// mirrored here directly against global.__TSM_MEMORY__ since routers don't
// have access to server.js's module-scope function).
const TSM_VERTICAL_MEMORY_CAP = 5;
function recordConstructionMemory(prompt, answer) {
  try {
    const mem = global.__TSM_MEMORY__;
    if (!mem || !answer) return;
    if (!mem.construction) mem.construction = { recent: [] };
    if (!Array.isArray(mem.construction.recent)) mem.construction.recent = [];
    mem.construction.recent.push({
      ts: new Date().toISOString(),
      prompt: (prompt || '').toString().slice(0, 300),
      answer: (answer || '').toString().slice(0, 500)
    });
    if (mem.construction.recent.length > TSM_VERTICAL_MEMORY_CAP) {
      mem.construction.recent = mem.construction.recent.slice(-TSM_VERTICAL_MEMORY_CAP);
    }
    mem.construction.lastUpdated = new Date().toISOString();
  } catch (e) { /* non-fatal — memory logging must never break the response */ }
}

// TSM FIX: this route had no auth guard at all, unlike /api/hc/* and
// /api/finops/report (as of c41fccc6) — and unlike FinOps's report route,
// this one is genuinely live (construction-war-room.html and other pages
// call it directly). Adding requireAnyAuth here doesn't require any
// front-end change: same-origin fetch() already carries the tsm_session
// cookie automatically for logged-in users.
router.post('/api/construction/query', requireAnyAuth, async function(req, res) {
  var body = req.body || {};
  var question = body.question || body.query || '';
  var systemPrompt = body.system || SP.construction;
  try {
    var a = await groqChat(systemPrompt, question, body.maxTokens || 1024);
    recordConstructionMemory(question, a);
    return res.json({ ok:true, answer:a, createdAt:new Date().toISOString() });
  }
  catch(e) {
    // TSM FIX: groqChat() throws when GROQ_API_KEY is unset, which
    // previously surfaced as a raw 500 with no graceful degradation —
    // unlike /api/construction/report and /api/finops/report, which both
    // fall back to a safe canned response instead of erroring out.
    // Distinguishes "no key configured" (service simply not enabled here)
    // from a genuine upstream failure so the client/UI can tell them apart,
    // rather than treating both as the same opaque 500.
    const noKeyConfigured = /GROQ_API_KEY not configured/i.test(e.message || '');
    return res.status(200).json({
      ok: true,
      fallback: true,
      degraded: true,
      reason: noKeyConfigured ? 'ai_not_configured' : 'ai_call_failed',
      answer: 'AI analysis is temporarily unavailable. Please try again shortly or route this question to a project manager for manual review.',
      createdAt: new Date().toISOString()
    });
  }
});

router.post('/api/construction/report', requireAnyAuth, async (req,res) => {
  const workflow = req.body?.workflow || 'Job Cost Report';
  const content = (req.body?.content || '').trim();

  // Only attempt a real, content-grounded analysis when there's actually
  // enough submitted text to analyze. A handful of words isn't a document.
  const hasRealContent = content.length >= 40;

  if (hasRealContent && process.env.GROQ_API_KEY) {
    try {
      const userMessage = `Workflow: ${workflow}

Document content:
${content.slice(0, 6000)}

Analyze this specific content. Return JSON only, no markdown fences:
{
  "risk_level": "LOW|MEDIUM|HIGH",
  "summary": "1-2 sentences grounded in the actual content above",
  "findings": ["specific findings drawn from the content, not generic boilerplate"],
  "actions": ["specific next actions grounded in the findings"],
  "project_note": "...",
  "confidence": 0-100
}`;
      const raw = await groqChat(SP.construction, userMessage, 700);
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return res.json({
        ok: true,
        report: {
          workflow,
          risk_level: parsed.risk_level || 'MEDIUM',
          summary: parsed.summary || 'Document reviewed.',
          findings: parsed.findings || [],
          actions: parsed.actions || [],
          project_note: parsed.project_note || '',
          business_outcome: 'Construction document converted into project-ready actions.',
          confidence: parsed.confidence ?? 70,
          grounded: true
        },
        ts: new Date().toISOString()
      });
    } catch (e) {
      console.error('[construction report] Groq analysis failed, using generic fallback:', e.message);
      // fall through to generic template below
    }
  }

  // Generic fallback — used when there's no real content to analyze, or the
  // AI call failed. Explicitly labeled `grounded: false` so callers/UI can
  // show "generic template" rather than presenting this as document analysis.
  res.json({
    ok:true,
    report:{
      workflow,
      risk_level: hasRealContent ? 'MEDIUM' : 'UNKNOWN',
      summary: hasRealContent
        ? 'Document content was submitted but could not be analyzed automatically; manual PM/controller review recommended.'
        : 'No document content was submitted — this is a generic checklist, not an analysis of a specific document.',
      findings:[
        'Cost or schedule variance requires PM/controller review.',
        'Subcontractor/vendor exposure should be validated.',
        'Project delivery risk should be converted into an owner action lane.'
      ],
      actions:[
        'Assign PM to validate variance and supporting documentation.',
        'Route cost exposure to controller for budget impact review.',
        'Prepare BNCA summary for construction strategist.'
      ],
      project_note:'Prioritize project cost exposure, schedule blockers, and subcontractor risk before next owner update.',
      business_outcome:'Construction document converted into project-ready actions.',
      confidence: hasRealContent ? 50 : 0,
      grounded: false
    },
    ts:new Date().toISOString()
  });
});

// POST /api/construction/upload-doc — drag/drop or file-picker intake.
// Extracts text from the uploaded doc/contract and returns it so the
// front end can ground its BNCA prompt (via /api/ai/query) in the real
// file content instead of a generic canned prompt. No AI call happens
// here — this route only extracts + classifies; analysis is a separate,
// user-triggered step.
router.post('/api/construction/upload-doc', requireAnyAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: 'No file uploaded (expected multipart field "file").' });
    }

    if (!hasRealTextContent(file.originalname)) {
      return res.status(400).json({
        ok: false,
        error: `Unsupported file type: ${file.originalname}. Use .txt, .csv, .md, .json, .pdf, .docx, .xlsx, or .xls.`
      });
    }

    const text = await extractConstructionDocText(file);
    const docType = classifyConstructionDoc(text);

    res.json({
      ok: true,
      filename: file.originalname,
      docType,
      text,
      charCount: text.length,
      truncated: text.length >= 6000
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Upload failed' });
  }
});

module.exports = router;