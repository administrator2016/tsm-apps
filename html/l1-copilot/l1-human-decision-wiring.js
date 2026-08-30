/**
 * TSM_L1_HUMAN_DECISION_WIRING
 * ------------------------------------------------------------------
 * Wires Decision Journey Step 5 (Human Decision) to the real,
 * server-persisted HITL gate at /api/exec-portal/l1-copilot/decide —
 * the same endpoint pattern PM Copilot and Mortgage use for their own
 * direct action buttons (server.js EXEC_PORTAL_HITL_GATES, now
 * including 'l1-copilot').
 *
 * Requires: server.js change registering 'l1-copilot' in
 * EXEC_PORTAL_VERTICALS / EXEC_PORTAL_GATE_PREFIX (already applied).
 *
 * Verdict mapping — three buttons onto the gate's two terminal outcomes
 * plus 'hold':
 *   ACCEPT RECOMMENDATION   -> 'approved'  (technician agrees with TSM)
 *   KEEP CURRENT PRIORITY   -> 'rejected'  (technician overrides TSM;
 *                                           NOT a claim TSM was wrong,
 *                                           just that the human's call
 *                                           differs — same deliberate
 *                                           mapping PM/Mortgage use)
 *   SEND FOR REVIEW         -> 'hold'      (deferred, not a final call;
 *                                           acknowledged but not written
 *                                           to the approval-rate stats,
 *                                           same as every other vertical)
 */

const L1_DECIDE_URL = '/api/exec-portal/l1-copilot/decide';
const L1_DECISIONS_URL = '/api/exec-portal/l1-copilot/decisions';

/**
 * @param {'accept'|'keep'|'review'} choice
 * @param {object} ctx - { incident, ticketPriority, aiSeverity, recommendedPriority }
 */
function recordHumanDecision(choice, ctx) {
  const verdictMap = { accept: 'approved', keep: 'rejected', review: 'hold' };
  const verdict = verdictMap[choice];
  if (!verdict) return Promise.reject(new Error(`Unknown choice: ${choice}`));

  const text = choice === 'accept'
    ? `Accepted AI recommendation: ${ctx.ticketPriority} -> ${ctx.recommendedPriority}`
    : choice === 'keep'
      ? `Technician kept ticket at ${ctx.ticketPriority} despite AI assessment of ${ctx.aiSeverity}`
      : `Sent for review: ${ctx.ticketPriority} vs AI ${ctx.aiSeverity} (${ctx.recommendedPriority} recommended)`;

  // index must be stable per-incident so re-deciding the same ticket (e.g.
  // technician changes their mind before closing) traces to one entity,
  // same requirement server.js documents for the shared entityId.
  const index = ctx.incident || Date.now();

  return fetch(L1_DECIDE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index, verdict, text, actor: 'Technician', meta: ctx, tenantId: (typeof TSMActiveMember !== 'undefined' && TSMActiveMember) ? TSMActiveMember.getId() : null })
  }).then(r => r.json());
}

/**
 * Renders the three-button Human Decision UI and wires each to a real
 * server call. Call this in Step 5 of the Decision Journey once
 * alignment.status is known (see priority-mismatch-logic.js).
 */
function renderHumanDecisionStep(container, ctx, alignment) {
  if (!alignment.requiresHumanReview) {
    container.innerHTML = `
      <div class="tsm-dj-brief">
        AI severity matches ticket priority — no discrepancy requiring review.
        Proceed with the recommended action.
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="tsm-dj-decision">
      <p>TSM recommends escalation to <strong>${ctx.recommendedPriority}</strong>.
      The technician retains final authority.</p>
      <div class="tsm-dj-actions">
        <button class="tsm-dj-next" data-choice="accept">ACCEPT RECOMMENDATION</button>
        <button class="tsm-dj-next" data-choice="keep">KEEP CURRENT PRIORITY</button>
        <button class="tsm-dj-next" data-choice="review">SEND FOR REVIEW</button>
      </div>
      <div class="tsm-dj-status" id="tsm-dj-decision-status"></div>
    </div>`;

  container.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = container.querySelector('#tsm-dj-decision-status');
      status.textContent = 'Recording decision…';
      recordHumanDecision(btn.dataset.choice, ctx)
        .then(res => {
          if (res && res.ok) {
            container.querySelectorAll('[data-choice]').forEach(b => b.disabled = true);
            status.textContent = `Decision recorded: ${btn.textContent}`;
            if (typeof loadL1ApprovalRate === 'function') loadL1ApprovalRate();
          } else {
            status.textContent = `Server rejected the decision${res && res.error ? ': ' + res.error : ''}.`;
          }
        })
        .catch(() => { status.textContent = 'Decision saved locally — server unreachable, will not appear in the rate panel this session.'; });
    });
  });
}

/**
 * Optional: Approval Improvement Rate panel for L1, same shape as PM's
 * loadApprovalRate()/renderApprovalRateStats(). Drop this near the
 * Decision Journey or in a small "L1 Decision History" section.
 */
function loadL1ApprovalRate(targetEl) {
  const body = targetEl || document.getElementById('l1-rate-panel');
  if (!body) return;
  fetch(L1_DECISIONS_URL)
    .then(r => r.json())
    .then(res => {
      if (!res || !res.ok) throw new Error('bad response');
      const s = res.stats;
      if (!s || !s.total) {
        body.innerHTML = '<div class="no-items">No decisions recorded yet.</div>';
        return;
      }
      body.innerHTML = `
        <div class="tsm-rate-grid">
          <div class="tsm-rate-card"><div class="tsm-rate-val green">${s.approvalRate}%</div><div class="tsm-rate-lbl">Acceptance Rate</div></div>
          <div class="tsm-rate-card"><div class="tsm-rate-val cyan">${s.total}</div><div class="tsm-rate-lbl">Total Decisions</div></div>
          <div class="tsm-rate-card"><div class="tsm-rate-val green">${s.approved}</div><div class="tsm-rate-lbl">Accepted</div></div>
          <div class="tsm-rate-card"><div class="tsm-rate-val red">${s.rejected}</div><div class="tsm-rate-lbl">Overridden</div></div>
        </div>`;
    })
    .catch(() => { body.innerHTML = '<div class="no-items">Decision history unavailable this session.</div>'; });
}

if (typeof module !== 'undefined') module.exports = { recordHumanDecision, renderHumanDecisionStep, loadL1ApprovalRate };
