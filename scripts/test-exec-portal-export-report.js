#!/usr/bin/env node
/**
 * test-exec-portal-export-report.js
 *
 * Proves the two fixes made to exportExecutiveReport()
 * (html/healthcare/executive-portal.html, the "📋 EXPORT REPORT" button
 * on the exec-portal escalation modal):
 *
 *   1. Engine findings (d.stratReports.*) are written to the exported
 *      .txt in full -- the old `text.slice(0, 500)` no longer clips real
 *      content off the actual report HonorHealth receives.
 *   2. If TSM_EXEC_RELAY is empty/missing (no war-room brief, engine
 *      findings, decisions, urgent alerts, exec notes, or denial pack),
 *      the function now alerts and returns instead of silently
 *      downloading a near-blank file that looks like a real export.
 *
 * Uses jsdom (same technique as test-evidence-ledger-audit-trail.js) --
 * this code attaches to document/sessionStorage/localStorage the way a
 * browser script tag does, not via module.exports.
 *
 * Rather than maintaining a hand-copied duplicate of the function (which
 * could silently drift out of sync with the real file and start testing
 * nothing), this test extracts the *actual* exportExecutiveReport source
 * straight out of html/healthcare/executive-portal.html via brace
 * matching, and evals that extracted text into the fake window. The
 * function under test is therefore always whatever the file currently
 * contains -- if it change in a way this test doesn't expect, the test
 * fails instead of quietly passing against stale code. The full
 * executive-portal.html <script> block isn't loaded wholesale because it
 * runs ~2000 lines of unrelated top-level side effects (event listeners,
 * checkForFreshRelay() auto-invocation, etc.) on load that aren't part of
 * what's under test here and would make the test fragile against
 * unrelated edits elsewhere in the file.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;

function check(label, cond) {
  if (cond) {
    passed++;
    console.log('  OK   ' + label);
  } else {
    failed++;
    console.log('  FAIL ' + label);
  }
}

const PORTAL_PATH = path.join(__dirname, '..', 'html', 'healthcare', 'executive-portal.html');

function extractBracedBlock(content, startMarker) {
  const start = content.indexOf(startMarker);
  if (start === -1) throw new Error('marker not found: ' + startMarker);
  const openBrace = content.indexOf('{', start);
  let depth = 0;
  let i = openBrace;
  for (; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return content.slice(start, i + 1);
}

function extractLineContaining(content, needle) {
  const line = content.split('\n').find(l => l.includes(needle));
  if (!line) throw new Error('line not found containing: ' + needle);
  return line.trim();
}

const portalSource = fs.readFileSync(PORTAL_PATH, 'utf8');
const noteNsLine = extractLineContaining(portalSource, "const NOTE_NS =");
const exportFnSource = extractBracedBlock(portalSource, 'async function exportExecutiveReport() {');

check('extracted exportExecutiveReport() source is non-trivial (real function, not a stub)',
  exportFnSource.length > 2000);
const engineLineMatch = exportFnSource.match(/engineEntries\.forEach\(\(\[label, text\]\) => lines\.push\([^\n]*\)\);/);
check('extracted source still contains the engine-findings push line',
  !!engineLineMatch);
check('that line pushes the full "text" variable, not "text.slice(0, 500)"',
  !!engineLineMatch && !engineLineMatch[0].includes('.slice('));
check('extracted source still contains the hasRealData empty-export guard',
  exportFnSource.includes('hasRealData'));

function freshWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.test/',
    runScripts: 'dangerously'
  });
  const win = dom.window;

  win.document.body.innerHTML = `
    <button id="esc-export-btn">📋 EXPORT REPORT</button>
    <div id="dp-content"></div>
  `;

  Object.defineProperty(win.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    set(v) { this.textContent = v; },
    configurable: true
  });

  win.__lastBlobText = null;
  win.Blob = function (parts) { win.__lastBlobText = parts.join(''); return { __fakeBlob: true }; };
  win.URL.createObjectURL = () => 'blob:fake-url';
  win.URL.revokeObjectURL = () => {};

  win.fetch = () => Promise.resolve({ ok: true, json: async () => ({}) });

  win.__alerts = [];
  win.alert = (msg) => { win.__alerts.push(msg); };

  // NOTE: must be a single eval() call -- jsdom's window.eval() does not
  // persist `const`/`let` bindings across separate calls (each string gets
  // its own top-level lexical scope), so NOTE_NS from a first eval() is
  // invisible inside a second eval()'d function that references it.
  win.eval(noteNsLine + '\n' + exportFnSource);

  return win;
}

(async () => {
  {
    const win = freshWindow();
    await win.exportExecutiveReport();

    check('empty relay: alert() was called (user is told, not left guessing)',
      win.__alerts.length === 1);
    check('empty relay: alert message explains what\'s missing',
      /Nothing to export yet/.test(win.__alerts[0] || ''));
    check('empty relay: no file was written (Blob never constructed)',
      win.__lastBlobText === null);
    check('empty relay: export button label is restored, not left on a stuck state',
      win.document.getElementById('esc-export-btn').innerHTML === '📋 EXPORT REPORT');
  }

  {
    const win = freshWindow();
    win.sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify({
      ts: Date.now(), sessionId: 'REL-EMPTY-1',
      kpi: {}, alerts: { decisions: [], urgent: [] }, stratReports: {}
    }));
    await win.exportExecutiveReport();

    check('relay present but empty of real content: guard still fires (a sessionId alone isn\'t "real data")',
      win.__alerts.length === 1 && win.__lastBlobText === null);
  }

  {
    const win = freshWindow();
    const longFinding = 'PR-96 and CO-29 denial codes concentrated at the Mesa office. ' +
      'Root cause traced to a payer-side pre-authorization requirement change effective ' +
      'last quarter that intake staff had not yet been briefed on. '.repeat(6);
    check('fixture sanity: longFinding is actually over 500 chars', longFinding.length > 500);

    win.sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify({
      ts: Date.now(),
      sessionId: 'REL-LONG-1',
      warRoomBrief: 'CLM-0334 timely-filing deadline in 48 hours, $3,800 exposure.',
      kpi: { totalAtRisk: '$48,000', denialRate: '18.4%' },
      alerts: { decisions: [], urgent: ['CLM-0334 48hr write-off deadline'] },
      stratReports: { denialSweep: longFinding }
    }));

    await win.exportExecutiveReport();

    check('long finding: no alert fired (real data present)',
      win.__alerts.length === 0);
    check('long finding: a report was actually downloaded',
      typeof win.__lastBlobText === 'string' && win.__lastBlobText.length > 0);
    check('long finding: the FULL finding text appears in the exported report, not truncated',
      win.__lastBlobText.includes(longFinding));
    check('long finding: report is not artificially cut at 500 chars for that section',
      !win.__lastBlobText.includes(longFinding.slice(0, 500) + '\n') || win.__lastBlobText.includes(longFinding));
    check('long finding: engine section header present with correct label',
      win.__lastBlobText.includes('DENIAL SWEEP:'));
    check('long finding: export button shows the success state',
      win.document.getElementById('esc-export-btn').innerHTML === '✓ EXPORTED');
  }

  {
    const win = freshWindow();
    win.document.body.innerHTML += `
      <div class="decision-item" data-note-key="dec-1">
        <div class="d-action">File CLM-0334 appeal</div>
      </div>
    `;
    win.sessionStorage.setItem('TSM_EXEC_NOTES_dec-1', 'Signed — forwarded to compliance 14:22. Follow up Monday.');
    win.sessionStorage.setItem('TSM_EXEC_RELAY', JSON.stringify({
      ts: Date.now(), sessionId: 'REL-NOTES-1',
      alerts: { decisions: [{ urgency: 'HIGH', action: 'File CLM-0334 appeal', value: '$3,800', deadline: '48h' }], urgent: [] },
      kpi: {}
    }));

    await win.exportExecutiveReport();

    check('exec note: no false-empty guard trip when only a decision + note is present',
      win.__alerts.length === 0);
    check('exec note text appears in the exported report',
      win.__lastBlobText.includes('Signed — forwarded to compliance 14:22. Follow up Monday.'));
  }

  console.log('\n' + (failed ? `${failed} FAILED, ${passed} passed` : `ALL ${passed} CHECKS PASSED`));
  process.exitCode = failed ? 1 : 0;
})().catch(err => {
  console.error('ERROR', err);
  process.exit(1);
});
