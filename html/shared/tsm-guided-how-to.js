(function () {
  'use strict';

  const registry = {
    schools: {
      title: 'How To Run Schools Command',
      subtitle:
        'Follow the operating path from school problem → evidence → decision → action → executive report.',
      steps: [
        ['START', 'Start with a mission or operational problem.', { selector: '[data-tab="grants"]' }],
        ['INPUT', 'Load the documents, records, or evidence.', { selector: '#schBtnLoadSample' }],
        ['ANALYZE', 'Run intelligence analysis.', { selector: '#schBtnRunAnalysis' }],
        ['REVIEW', 'Review findings, severity, and exposure.', { selector: '#schSnapGrid' }],
        ['DECIDE', 'Prioritize what requires action.', { selector: '#schBreachBody' }],
        ['EXECUTE', 'Assign and execute corrective work.', { selector: '#schBtnEnrich' }],
        ['REPORT', 'Generate the report leadership needs.', { selector: '#tsm-chain-exec' }],
        ['MEASURE', 'Track whether the problem is improving.', { selector: '#schKpiGrid' }],
        ['REPEAT', 'Run the workflow again as new work arrives.', { selector: '#schBtnRunAnalysis' }]
      ]
    },
    // HC OFFICE MANAGER · DOCUMENT INTAKE — mirrors the real page's own order
    // top-to-bottom (Classify a Case → Classify From File → Intake Queue).
    // Each step's 3rd array slot is a {selector} pointing at the exact real
    // element on hc-office-manager-doc-intake.html, so "Go To Control" always
    // lands on the actual control, not a best-guess text match — several of
    // these steps target a textarea/dropdown/tab strip rather than a single
    // button, which the schools workflow's label-search approach can't do.
    'healthcare-intake': {
      title: 'How To Run Document Intake',
      subtitle:
        'This page only produces routing suggestions — nothing is sent to a node until you click Route.',
      steps: [
        [
          'DESCRIBE',
          'Paste or type what the document/case is about in the Classify a Case box.',
          { selector: '#intake-desc' }
        ],
        [
          'CLASSIFY TEXT',
          'Click CLASSIFY to run it against the 11 HC nodes\u2019 keyword rules.',
          { selector: '#classify-btn' }
        ],
        [
          'OR: PICK A SAMPLE',
          'No text to paste? Choose one of the 6 healthcare sample documents from the dropdown.',
          { selector: '#sample-select' }
        ],
        [
          'CLASSIFY SAMPLE',
          'Click LOAD & CLASSIFY SAMPLE \u2014 the file\u2019s text is extracted and classified the same way.',
          { selector: '#sample-btn' }
        ],
        [
          'OR: UPLOAD YOUR OWN',
          'Choose your own PDF/DOCX/XLSX/XLS/CSV/TXT/MD (8MB max), then click CLASSIFY UPLOADED FILE.',
          { selector: '#upload-btn' }
        ],
        [
          'REVIEW THE SUGGESTION',
          'Read the suggested node, its confidence level, and the exact reasoning given.',
          { selector: '#suggestion' }
        ],
        [
          'ROUTE OR DISMISS',
          'Click ROUTE TO \u2026 to open that node (marks the suggestion routed), or DISMISS SUGGESTION to reject it.',
          ['route to', 'dismiss suggestion']
        ],
        [
          'TRACK IN THE QUEUE',
          'Use the ALL / SUGGESTED / ROUTED / DISMISSED tabs to see what\u2019s been decided so far.',
          { selector: '.qtabs' }
        ]
      ]
    },
    // COLLEGE FINANCIAL AID — TITLE IV WAR ROOM — this page has no "load
    // sample" button; init() fetches the finaid model + a financial-summary
    // POST automatically on load, so the tour starts straight at the KPI
    // row instead of an INPUT step. All 9 selectors below were read
    // directly out of college-finaid-command.html, not guessed.
    college: {
      title: 'How To Run College Financial Aid',
      subtitle:
        'R2T4, Verification, and Cohort Default cases load automatically \u2014 walk the exposure, analyze, then relay to the Strategist.',
      steps: [
        ['START', 'Cases load automatically on page open \u2014 no sample button needed here.', { selector: '#kpiRow' }],
        ['EXPOSURE', 'Check total dollar exposure across all open Title IV cases.', { selector: '#exposureBox' }],
        ['REVIEW R2T4', 'Scan Return to Title IV cases by severity and days late.', { selector: '#r2t4Table' }],
        ['REVIEW VERIFICATION', 'Scan Verification cases and see which have Pell held.', { selector: '#verTable' }],
        ['REVIEW CDR', 'Check Cohort Default Rate flags and trend by program.', { selector: '#cdrTable' }],
        ['ANALYZE', 'Run AI Analysis for a compliance read on the current caseload.', { selector: '#runAiBtn' }],
        ['READ ANALYSIS', 'Read the AI-generated compliance summary.', { selector: '#aiOut' }],
        ['ESCALATE', 'Relay this snapshot to the College Strategist for triage.', { selector: '#relayBtn' }],
        ['REFRESH', 'Pull the latest exposure numbers any time new cases come in.', { selector: '#refreshBtn' }]
      ]
    }
  };

  function getWorkflow(vertical) {
    return registry[vertical] || null;
  }

  function findControl(labels) {
    const wanted = labels.map(x => x.toLowerCase());

    const elements = Array.from(
      document.querySelectorAll(
        'button, a, input[type="button"], input[type="submit"], [role="button"]'
      )
    );

    return elements.find(el => {
      const text = (
        el.innerText ||
        el.value ||
        el.getAttribute('aria-label') ||
        el.title ||
        ''
      ).trim().toLowerCase();

      return wanted.some(label => text.includes(label));
    });
  }

  function inject(vertical) {
    const workflow = getWorkflow(vertical);
    if (!workflow || document.getElementById('tsm-guided-how-to')) return;

    const panel = document.createElement('aside');
    panel.id = 'tsm-guided-how-to';

    panel.innerHTML = `
      <div class="tsm-gh-header">
        <div>
          <div class="tsm-gh-eyebrow">TSM GUIDED WORKFLOW</div>
          <h2>${workflow.title}</h2>
          <p>${workflow.subtitle}</p>
        </div>
        <button type="button" id="tsm-gh-close" aria-label="Close How To">×</button>
      </div>

      <div class="tsm-gh-steps">
        ${workflow.steps.map((step, index) => `
          <button
            type="button"
            class="tsm-gh-step"
            data-step="${index}"
          >
            <span class="tsm-gh-number">${index + 1}</span>
            <span>
              <strong>${step[0]}</strong>
              <small>${step[1]}</small>
            </span>
          </button>
        `).join('')}
      </div>

      <div id="tsm-gh-help" class="tsm-gh-help">
        <strong>Start here</strong>
        <p>Select a step to see what to do and where to do it.</p>
      </div>
    `;

    document.body.appendChild(panel);

    document
      .getElementById('tsm-gh-close')
      .addEventListener('click', () => panel.remove());

    panel.querySelectorAll('.tsm-gh-step').forEach(button => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.step);
        const step = workflow.steps[index];

        panel.querySelectorAll('.tsm-gh-step')
          .forEach(x => x.classList.remove('active'));

        button.classList.add('active');

        const controls = {
          START: ['start', 'create mission', 'new mission', 'scenario'],
          INPUT: ['upload', 'load', 'import', 'add document'],
          ANALYZE: ['analyze', 'run analysis', 'process'],
          REVIEW: ['review', 'findings', 'exceptions', 'details'],
          DECIDE: ['prioritize', 'decision', 'escalate', 'approve', 'assign'],
          EXECUTE: ['execute', 'assign', 'update', 'resolve', 'complete'],
          REPORT: ['report', 'generate report', 'export', 'brief'],
          MEASURE: ['measure', 'metrics', 'dashboard', 'kpi'],
          REPEAT: ['refresh', 'next mission', 'new mission', 'run again']
        };

        // step[2] is optional: either an exact {selector} (used when the
        // real control isn't a plain button/link — a textarea, a <select>,
        // a tab strip) or a fresh label list overriding the legacy
        // hardcoded `controls` map below. Falls back to that map so the
        // pre-existing schools workflow (no step[2] at all) still works
        // unchanged.
        const stepConfig = step[2];
        const target = stepConfig && stepConfig.selector
          ? document.querySelector(stepConfig.selector)
          : findControl(Array.isArray(stepConfig) ? stepConfig : (controls[step[0]] || []));

        const help = document.getElementById('tsm-gh-help');

        help.innerHTML = `
          <div class="tsm-gh-phase">${step[0]}</div>
          <strong>${step[1]}</strong>
          <p>
            ${target
              ? 'TSM found the related control. Click “Go To Control” to locate it.'
              : 'No matching control was detected automatically on this page yet.'}
          </p>
          ${
            target
              ? '<button type="button" id="tsm-gh-go">Go To Control</button>'
              : ''
          }
        `;

        if (target) {
          document
            .getElementById('tsm-gh-go')
            .addEventListener('click', () => {
              target.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
              });

              target.focus?.();

              target.style.outline = '3px solid #38bdf8';

              setTimeout(() => {
                target.style.outline = '';
              }, 2500);
            });
        }
      });
    });
  }

  window.TSMGuidedHowTo = {
    inject,
    getWorkflow
  };
})();
