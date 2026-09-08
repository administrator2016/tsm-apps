'use strict';
// Generates html/l1-copilot/servicenow-study-guide.html by extracting the
// REAL content already hand-authored in:
//   - servicenow-fundamentals.html (const modules = [...])
//   - servicenow-scenarios.html    (const scenarios = [...])
//   - servicenow-exam-sim.html     (const bank = [...] question bank)
// Nothing here is invented — this script parses the actual JS array
// literals out of those three files and re-renders them into one
// consolidated reference page. Re-run this script any time those source
// pages change; do not hand-edit the generated output file.
//
// Usage: node scripts/generate-servicenow-study-guide.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const L1_DIR = path.join(ROOT, 'html', 'l1-copilot');

const SRC = {
  fundamentals: path.join(L1_DIR, 'servicenow-fundamentals.html'),
  scenarios: path.join(L1_DIR, 'servicenow-scenarios.html'),
  examSim: path.join(L1_DIR, 'servicenow-exam-sim.html')
};

const OUT_FILE = path.join(L1_DIR, 'servicenow-study-guide.html');

// Fundamentals module id -> the domain label used in scenarios.html /
// servicenow-exam-sim.html. Fundamentals has 6 modules; exam/scenarios use
// 6 domain labels, with 'incident' fanning out to two exam domains since
// Incident and Problem Management are one combined fundamentals module but
// two separate exam domains.
// 'nav' has no dedicated exam/scenario domain of its own — the one
// PLATFORM & AUTOMATION question that touches navigation (Global Search)
// is grouped with 'scripting' below instead of duplicated in both
// sections, since 3 of its 4 questions (UI Policy/Business Rule, Flow
// Designer, Client Scripts) are scripting-module content.
const MODULE_TO_EXAM_DOMAINS = {
  nav: [],
  access: ['ACCESS CONTROL'],
  incident: ['INCIDENT MANAGEMENT', 'PROBLEM MANAGEMENT'],
  change: ['CHANGE ENABLEMENT'],
  cmdb: ['CMDB & ASSETS'],
  scripting: ['PLATFORM & AUTOMATION']
};

function extractArrayLiteral(source, varName) {
  const startMarker = `const ${varName} = [`;
  const startIdx = source.indexOf(startMarker);
  if (startIdx === -1) {
    throw new Error(`Could not find "${startMarker}" in source`);
  }
  const arrayStart = source.indexOf('[', startIdx);
  let depth = 0;
  let i = arrayStart;
  let inString = null; // ' " ` currently open, or null
  let escaped = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  const literal = source.slice(arrayStart, i);
  // Evaluate the literal in an isolated sandbox — it's our own repo's
  // source, not user input, and this is strictly safer/more faithful than
  // trying to hand-reparse arbitrary JS object/template-literal syntax
  // with regex.
  const sandbox = {};
  vm.createContext(sandbox);
  const script = new vm.Script(`__RESULT__ = (${literal});`);
  script.runInContext(sandbox);
  return sandbox.__RESULT__;
}

function stripHtmlToText(html) {
  return html
    .replace(/<span class="term">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTerms(html) {
  const terms = [];
  const re = /<span class="term">([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    if (!terms.includes(m[1])) terms.push(m[1]);
  }
  return terms;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function build() {
  const fundamentalsSrc = fs.readFileSync(SRC.fundamentals, 'utf8');
  const scenariosSrc = fs.readFileSync(SRC.scenarios, 'utf8');
  const examSimSrc = fs.readFileSync(SRC.examSim, 'utf8');

  const modules = extractArrayLiteral(fundamentalsSrc, 'modules');
  const scenarios = extractArrayLiteral(scenariosSrc, 'scenarios');

  // servicenow-exam-sim.html names its full 24-question bank
  // QUESTION_BANK as of this repo state; fall back to a couple of other
  // plausible names if the source page is renamed later.
  let examBank;
  let lastErr;
  for (const name of ['QUESTION_BANK', 'bank', 'questions']) {
    try {
      examBank = extractArrayLiteral(examSimSrc, name);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!examBank) throw lastErr;

  const scenariosByDomain = {};
  scenarios.forEach(s => {
    (scenariosByDomain[s.domain] = scenariosByDomain[s.domain] || []).push(s);
  });
  const examByDomain = {};
  examBank.forEach(q => {
    (examByDomain[q.domain] = examByDomain[q.domain] || []).push(q);
  });

  let totalTerms = 0, totalChecks = 0, totalScenarios = 0, totalQuestions = 0;

  const sections = modules.map((m, i) => {
    const terms = extractTerms(m.content);
    totalTerms += terms.length;
    totalChecks += m.checks.length;
    const examDomains = MODULE_TO_EXAM_DOMAINS[m.id] || [];
    const relatedScenarios = examDomains.flatMap(d => scenariosByDomain[d] || []);
    const relatedQuestions = examDomains.flatMap(d => examByDomain[d] || []);
    totalScenarios += relatedScenarios.length;
    totalQuestions += relatedQuestions.length;

    const termsHtml = terms.length
      ? `<div class="terms-row">${terms.map(t => `<span class="term-chip">${esc(t)}</span>`).join('')}</div>`
      : '';

    const checksHtml = `<div class="checklist">
        <div class="checklist-title">CONCEPT CHECKLIST</div>
        ${m.checks.map(c => `<div class="check-row">☐ ${esc(c[0])}</div>`).join('')}
      </div>`;

    const scenariosHtml = relatedScenarios.length
      ? `<div class="applied-block">
          <div class="applied-title">APPLY IT — WORKED SCENARIO${relatedScenarios.length > 1 ? 'S' : ''}</div>
          ${relatedScenarios.map(s => {
            const correct = s.options.find(o => o.correct);
            return `<div class="scenario-mini">
              <div class="sc-domain">${esc(s.domain)}</div>
              <div class="sc-text">${esc(s.text)}</div>
              <div class="sc-answer"><strong>Correct approach:</strong> ${esc(correct.text)}</div>
              <div class="sc-note">${esc(correct.note)}</div>
            </div>`;
          }).join('')}
        </div>`
      : '';

    const questionsHtml = relatedQuestions.length
      ? `<div class="quick-check">
          <div class="applied-title">QUICK-CHECK QUESTIONS (from the exam bank — try before flipping to the sim)</div>
          <ol>
            ${relatedQuestions.map(q => `<li>${esc(q.q)}</li>`).join('')}
          </ol>
        </div>`
      : '';

    return `<section class="module-section" id="sec-${esc(m.id)}">
      <div class="module-num">MODULE ${i + 1} of ${modules.length}</div>
      <h2>${esc(m.name)}</h2>
      <div class="module-body">${m.content}</div>
      ${termsHtml}
      ${checksHtml}
      ${scenariosHtml}
      ${questionsHtml}
    </section>`;
  }).join('\n');

  const tocHtml = modules.map((m, i) =>
    `<a href="#sec-${esc(m.id)}" class="toc-link">${i + 1}. ${esc(m.name)}</a>`
  ).join('');

  const generatedAt = new Date().toISOString();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ServiceNow CSA / ITIL Study Guide · TSM Career Training</title>
<style>
:root {
  --bg: #0a0c10; --surface: #111318; --surface2: #181b22; --surface3: #1e2230;
  --border: #1e2230; --border2: #2a2f42;
  --text: #e8eaf0; --text2: #8890a8; --text3: #4a5068;
  --green: #00d4aa; --green-dim: rgba(0,212,170,0.08); --green-border: rgba(0,212,170,0.2);
  --cyan: #00d4d4; --cyan-dim: rgba(0,212,212,0.07); --cyan-border: rgba(0,212,212,0.2);
  --amber: #f59e0b; --amber-dim: rgba(245,158,11,0.08); --amber-border: rgba(245,158,11,0.2);
  --red: #ef4444; --red-dim: rgba(239,68,68,0.08);
  --purple: #a78bfa; --purple-dim: rgba(167,139,250,0.08); --purple-border: rgba(167,139,250,0.2);
  --mono: 'Courier New', monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--mono); min-height: 100vh; }
header {
  border-bottom: 1px solid var(--border); padding: 0 2rem; display: flex; align-items: center;
  justify-content: space-between; height: 56px; position: sticky; top: 0; background: var(--bg); z-index: 200;
}
.logo { font-size: 11px; letter-spacing: .18em; color: var(--text2); }
.logo span { color: var(--green); }
.back-link { font-size: 10px; letter-spacing: .08em; color: var(--cyan); text-decoration: none; border: 1px solid var(--cyan-border); padding: 6px 12px; }
.back-link:hover { background: var(--cyan-dim); }
.wrap { max-width: 980px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }
.eyebrow { font-size: 10px; letter-spacing: .14em; color: var(--cyan); margin-bottom: 8px; }
.title { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
.sub { font-size: 12.5px; color: var(--text2); max-width: 720px; margin-bottom: 8px; line-height: 1.6; }
.gen-note { font-size: 10px; color: var(--text3); margin-bottom: 24px; }

.stat-row { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 28px; }
.stat-chip { background: var(--surface); border: 1px solid var(--border); padding: 8px 14px; font-size: 11px; color: var(--text2); }
.stat-chip b { color: var(--green); }

.toc { background: var(--surface); border: 1px solid var(--border); padding: 1.2rem 1.4rem; margin-bottom: 2rem; }
.toc-title { font-size: 10px; letter-spacing: .1em; color: var(--amber); margin-bottom: 10px; }
.toc-link { display: block; font-size: 12.5px; color: var(--cyan); text-decoration: none; padding: 4px 0; }
.toc-link:hover { text-decoration: underline; }

.module-section { margin-bottom: 2.5rem; padding-bottom: 2rem; border-bottom: 1px solid var(--border); }
.module-section:last-of-type { border-bottom: none; }
.module-num { font-size: 10px; letter-spacing: .1em; color: var(--text3); margin-bottom: 6px; }
.module-section h2 { font-size: 17px; color: var(--cyan); margin-bottom: 14px; }
.module-body h3 { font-size: 14px; color: var(--text); margin: 14px 0 8px; }
.module-body p { font-size: 12.5px; color: var(--text2); line-height: 1.7; margin-bottom: 10px; }
.module-body ul { margin: 0 0 10px 18px; }
.module-body li { font-size: 12.5px; color: var(--text2); line-height: 1.8; }

.terms-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 16px; }
.term-chip { font-size: 10.5px; background: var(--purple-dim); border: 1px solid var(--purple-border); color: var(--purple); padding: 4px 9px; }

.checklist { background: var(--surface2); border: 1px solid var(--border); padding: 1rem 1.2rem; margin-bottom: 1rem; }
.checklist-title { font-size: 10px; letter-spacing: .08em; color: var(--amber); margin-bottom: 10px; }
.check-row { font-size: 12px; color: var(--text2); padding: 4px 0; }

.applied-block, .quick-check { background: var(--surface); border: 1px solid var(--border); padding: 1rem 1.2rem; margin-bottom: 1rem; }
.applied-title { font-size: 10px; letter-spacing: .08em; color: var(--green); margin-bottom: 12px; }
.scenario-mini { margin-bottom: 14px; }
.scenario-mini:last-child { margin-bottom: 0; }
.sc-domain { font-size: 9.5px; letter-spacing: .08em; color: var(--text3); margin-bottom: 4px; }
.sc-text { font-size: 12px; color: var(--text); line-height: 1.6; margin-bottom: 6px; }
.sc-answer { font-size: 12px; color: var(--green); line-height: 1.6; margin-bottom: 4px; }
.sc-note { font-size: 11.5px; color: var(--text2); line-height: 1.6; }
.quick-check ol { margin-left: 18px; }
.quick-check li { font-size: 12px; color: var(--text2); line-height: 1.9; }

.footer-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--border); }
.footer-links a {
  font-size: 10px; letter-spacing: .06em; color: var(--text2); text-decoration: none;
  border: 1px solid var(--border2); padding: 8px 14px;
}
.footer-links a:hover { color: var(--cyan); border-color: var(--cyan-border); }

@media print {
  header, .toc, .footer-links, .back-link { display: none; }
  body { background: #fff; color: #000; }
  .module-body p, .module-body li, .sc-text, .sc-note, .check-row { color: #222; }
}
</style>
</head>
<body>
<header>
  <div class="logo">TSM <span>SHELL</span> · SERVICENOW STUDY GUIDE</div>
  <a class="back-link" href="/html/tsm-career-training-platform.html">← BACK TO PLATFORM</a>
</header>

<div class="wrap">
  <div class="eyebrow">IT · SERVICE DESK · CONSOLIDATED REFERENCE</div>
  <div class="title">ServiceNow CSA / ITIL Study Guide</div>
  <div class="sub">One printable reference pulling together all 6 Fundamentals modules, their key terms, concept checklists, and the matching scenario + exam-bank questions — generated directly from the real training modules, scenario engine, and exam bank already in this app. Nothing on this page is separately authored; it's a consolidated view of the same source content.</div>
  <div class="gen-note">Generated ${esc(generatedAt)} from servicenow-fundamentals.html, servicenow-scenarios.html, servicenow-exam-sim.html. Re-run scripts/generate-servicenow-study-guide.js after editing those source pages — do not hand-edit this file.</div>

  <div class="stat-row">
    <div class="stat-chip"><b>${modules.length}</b> modules</div>
    <div class="stat-chip"><b>${totalTerms}</b> key terms</div>
    <div class="stat-chip"><b>${totalChecks}</b> checklist items</div>
    <div class="stat-chip"><b>${totalScenarios}</b> worked scenarios</div>
    <div class="stat-chip"><b>${totalQuestions}</b> quick-check questions</div>
  </div>

  <div class="toc">
    <div class="toc-title">JUMP TO A MODULE</div>
    ${tocHtml}
  </div>

  ${sections}

  <div class="footer-links">
    <a href="/html/l1-copilot/servicenow-fundamentals.html">← FUNDAMENTALS WALKTHROUGH</a>
    <a href="/html/l1-copilot/servicenow-scenarios.html">SCENARIO ENGINE →</a>
    <a href="/html/l1-copilot/servicenow-exam-sim.html">TIMED EXAM SIM →</a>
    <a href="/html/l1-copilot/l1-ticket-copilot.html">L1 TICKET COPILOT →</a>
  </div>
</div>
</body>
</html>
`;

  fs.writeFileSync(OUT_FILE, html);
  console.log('Wrote', OUT_FILE);
  console.log(`${modules.length} modules, ${totalTerms} terms, ${totalChecks} checklist items, ${totalScenarios} scenarios, ${totalQuestions} quick-check questions`);
}

build();
