// ═══════════════════════════════════════════════════════════════════════════
// TSM DOC ANOMALY BRIDGE — tsm-doc-anomaly-bridge.js
// Drop before </body> on every HC node page.
// Reads 'tsm-doc-anomaly' from localStorage (written by multi.html or
// healthcare/index.html Analysis Hub) and renders a lit-up remediation
// banner if the payload targets this node.
//
// 2026-08-31: also fed by hc-office-manager-doc-intake.html's routeIntake()
// (source: 'office-manager-intake') — previously routing a classified case
// from that page handed the destination node nothing at all, so it opened
// showing its own hardcoded demo scenario with zero connection to what was
// just classified. Rather than build a second, parallel banner/contract,
// office-manager routing now writes into this exact same key/shape, just
// with checkStatus:'OFFICE_MANAGER_ROUTED' (falls through to the default
// ACTIVE/cyan severity — a routing suggestion isn't a detected compliance
// issue, so it doesn't borrow the CRITICAL/HIGH styling meant for real
// anomaly findings) plus the two optional overrides below. Both are
// additive: any payload that doesn't set them (every existing HC Academy
// payload) renders byte-for-byte as before.
//   bannerLabel  — overrides the literal "DOC ANOMALY DETECTED" header text
//   sourceBadge  — overrides the "FROM HUB"/"FROM DOC SEARCH" badge text
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── 1. WHICH NODE AM I? ─────────────────────────────────────────────────
  // Each node page must declare window.TSM_NODE_ID before this script,
  // OR we infer it from the URL path segment (hc-billing → "billing").
  function resolveNodeId() {
    if (window.TSM_NODE_ID) return window.TSM_NODE_ID;
    const m = window.location.pathname.match(/hc-([^\/]+)\//);
    return m ? m[1] : null;
  }

  // ── 2. DOC-TYPE → HC NODE AFFINITY MAP ──────────────────────────────────
  // Maps (documentType keyword OR exclusionCode prefix) → array of relevant
  // node IDs. A doc's anomaly banner shows on ANY node in its affinity list.
  const DOC_NODE_AFFINITY = {
    // Billing / claims
    'DENIAL':         ['billing', 'denial'],
    'CLAIM APPEAL':   ['billing', 'denial'],
    'REMITTANCE':     ['billing', 'financial'],
    '835':            ['billing', 'financial'],
    'ERA':            ['billing', 'financial'],
    'EOB':            ['billing', 'financial'],
    // Prior auth / insurance
    'PRIOR AUTH':     ['insurance', 'billing'],
    'PA-PEND':        ['insurance', 'billing'],
    'AUTH':           ['insurance'],
    'ELIGIBILITY':    ['insurance'],
    // Clinical / medical
    'CLINICAL':       ['medical'],
    'MEDICAL RECORD': ['medical'],
    'OPERATIVE':      ['medical'],
    'ADDENDUM':       ['medical'],
    // Compliance
    'HIPAA':          ['compliance'],
    'AUDIT':          ['compliance'],
    'OIG':            ['compliance'],
    'POLICY':         ['compliance'],
    // Pharmacy
    'PHARMACY':       ['pharmacy'],
    'RX':             ['pharmacy'],
    'DEA':            ['pharmacy'],
    'BIOLOGIC':       ['pharmacy'],
    // Financial
    'AR ':            ['financial'],
    'UNDERPAYMENT':   ['financial'],
    'PAYER HOLD':     ['financial'],
    // Operations
    'INTAKE':         ['operations'],
    'SCHEDULING':     ['operations'],
    'STAFFING':       ['operations'],
    // Legal
    'BAA':            ['legal'],
    'CONTRACT':       ['legal'],
    'AKS':            ['legal'],
    // Vendor / Tax / Grants — less common on node pages but included
    'VENDOR':         ['vendor'],
    'W-9':            ['tax'],
    'GRANT':          ['grants'],
    // Fallback: if no type match, show on billing (most common HC entry point)
    '_DEFAULT':       ['billing', 'denial'],
  };

  // CARC/RARC/exclusion code → node
  const CODE_NODE_MAP = {
    'CO-':    ['billing', 'denial'],
    'PR-':    ['billing', 'insurance'],
    'OA-':    ['billing', 'financial'],
    'CO-197': ['insurance', 'billing'],
    'CO-50':  ['billing', 'medical'],
    'CO-11':  ['medical', 'billing'],
    'CO-4':   ['billing'],
    'CO-29':  ['billing'],
    'PA-':    ['insurance'],
    'LIEN':   ['legal'],
    'PRIV':   ['legal'],
    'AKS':    ['legal'],
  };

  // ── 3. AFFINITY CHECK ───────────────────────────────────────────────────
  function getAffinityNodes(payload) {
    const nodes = new Set();
    const docType  = (payload.documentType || '').toUpperCase();
    const excCode  = (payload.exclusionCode || '').toUpperCase();
    const fileName = (payload.fileName     || '').toUpperCase();
    const combined = docType + ' ' + excCode + ' ' + fileName;

    // Check doc type affinity
    for (const [key, nodeList] of Object.entries(DOC_NODE_AFFINITY)) {
      if (key === '_DEFAULT') continue;
      if (combined.includes(key)) nodeList.forEach(n => nodes.add(n));
    }

    // Check exclusion/CARC code affinity
    for (const [prefix, nodeList] of Object.entries(CODE_NODE_MAP)) {
      if (excCode.startsWith(prefix) || fileName.includes(prefix)) {
        nodeList.forEach(n => nodes.add(n));
      }
    }

    // Explicit nodeId override from payload
    if (payload.targetNodeIds && Array.isArray(payload.targetNodeIds)) {
      payload.targetNodeIds.forEach(n => nodes.add(n));
    }

    // Fallback
    if (nodes.size === 0) {
      DOC_NODE_AFFINITY['_DEFAULT'].forEach(n => nodes.add(n));
    }

    return nodes;
  }

  // ── 4. SEVERITY BADGE ───────────────────────────────────────────────────
  function severityMeta(checkStatus) {
    const s = (checkStatus || '').toUpperCase();
    if (['DENIAL_RISK','COMPLIANCE_BLOCK','AUTH_BLOCK','PAYMENT_BLOCK','LEGAL_HOLD'].includes(s))
      return { label:'CRITICAL', color:'#ff4d6d', bg:'rgba(255,77,109,.12)', glow:'0 0 18px rgba(255,77,109,.45)' };
    if (['DOCUMENTATION_BLOCK','THROUGHPUT_BLOCK','DISPENSE_BLOCK','VENDOR_BLOCK','GRANT_HOLD'].includes(s))
      return { label:'HIGH',     color:'#f59e0b', bg:'rgba(245,158,11,.10)', glow:'0 0 14px rgba(245,158,11,.35)' };
    if (['FILING_BLOCK'].includes(s))
      return { label:'MEDIUM',   color:'#a78bfa', bg:'rgba(167,139,250,.10)', glow:'0 0 12px rgba(167,139,250,.3)' };
    return    { label:'ACTIVE',  color:'#00e5ff', bg:'rgba(0,229,255,.08)',   glow:'0 0 12px rgba(0,229,255,.25)' };
  }

  // ── 4b. STEP STRUCTURE PARSER ───────────────────────────────────────────
  // The Anomaly Advisor prompt (hc-denial-war-room.html) guarantees each
  // step string is formatted: "⚠ [FIELD NAME] — what is wrong — exact fix
  // instruction (which tab, which field, what to enter or change)."
  // Not every step source follows this (doc-search's generative playbook
  // endpoint may return plain strings) — fall back to unstructured display
  // when the split doesn't cleanly produce 3 parts.
  function parseStep(raw) {
    const s = String(raw || '').replace(/^\s*⚠\s*/, '').trim();
    const parts = s.split(/\s+—\s+/).map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return { field: parts[0], issue: parts[1], fix: parts.slice(2).join(' — ') };
    }
    return null; // unstructured — caller renders as plain text
  }

  // ── 5. RENDER BANNER ────────────────────────────────────────────────────
  function renderBanner(payload, nodeId) {
    const sev = severityMeta(payload.checkStatus);
    const narr = (payload.narrative || '').replace(/<[^>]*>/g, '');
    const findings = Array.isArray(payload.findings) ? payload.findings : [];
    const steps    = Array.isArray(payload.steps)    ? payload.steps    : [];

    const findingsHtml = findings.map(f => `
      <li style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <span style="flex-shrink:0;margin-top:1px">${f.startsWith('❌') ? '❌' : f.startsWith('✓') ? '✅' : '⚠️'}</span>
        <span style="color:#cbd5e1;font-size:.72rem;line-height:1.5">${f.replace(/^[❌✓⚠️]\s*/,'')}</span>
      </li>`).join('');

    const stepsHtml = steps.map((s, i) => {
      const parsed = parseStep(s);
      const body = parsed ? `
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
            <strong style="color:${sev.color};font-variant-numeric:tabular-nums">${String(i+1).padStart(2,'0')}.</strong>
            <span style="background:${sev.color}22;color:${sev.color};font-size:.62rem;font-weight:700;letter-spacing:.04em;padding:1px 6px;border-radius:2px">${parsed.field}</span>
          </div>
          <div style="color:#94a3b8;font-size:.68rem;line-height:1.5;margin:0 0 3px 20px"><span style="color:#64748b">ISSUE</span> ${parsed.issue}</div>
          <div style="color:#e2e8f0;font-size:.72rem;line-height:1.55;margin:0 0 0 20px"><span style="color:#4ade80;font-weight:700">→ ENTER</span> ${parsed.fix}</div>
        ` : `
          <span class="tsm-anb-step-text" style="color:#e2e8f0;font-size:.72rem;line-height:1.6">
            <strong style="color:${sev.color};font-variant-numeric:tabular-nums">${String(i+1).padStart(2,'0')}.</strong> ${s}
          </span>
        `;
      return `
      <li class="tsm-anb-step" style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;width:100%">
          <input type="checkbox" class="tsm-anb-check"
            style="margin-top:2px;accent-color:${sev.color};flex-shrink:0;width:14px;height:14px"
            onchange="TSM_ANB.stepToggle(this,${i})">
          <span class="tsm-anb-step-text" style="width:100%">${body}</span>
        </label>
      </li>`;
    }).join('');

    const docInfo = [
      payload.fileName  ? `<span><span style="color:#64748b">FILE</span> ${payload.fileName}</span>` : '',
      payload.docType   ? `<span><span style="color:#64748b">TYPE</span> ${payload.docType}</span>` : '',
      payload.ref       ? `<span><span style="color:#64748b">REF</span> ${payload.ref}</span>` : '',
      payload.client    ? `<span><span style="color:#64748b">CLIENT</span> ${payload.client}</span>` : '',
      payload.financialImpact ? `<span><span style="color:#64748b">EXPOSURE</span> <strong style="color:${sev.color}">$${Number(payload.financialImpact).toLocaleString()}</strong></span>` : '',
    ].filter(Boolean).join('<span style="color:#334155;margin:0 8px">·</span>');

    const html = `
<div id="tsm-anb-root" style="
  position:relative;
  margin:0 0 22px 0;
  border:1px solid ${sev.color}55;
  border-radius:6px;
  background:${sev.bg};
  box-shadow:${sev.glow};
  font-family:'Courier New',Courier,monospace;
  overflow:hidden;
  animation:tsm-anb-slidein .4s ease;
">
  <style>
    @keyframes tsm-anb-slidein{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}
    .tsm-anb-step.done .tsm-anb-step-text{text-decoration:line-through;opacity:.45}
    #tsm-anb-progress-bar{transition:width .35s ease}
    .tsm-anb-cta{display:inline-block;padding:6px 14px;border-radius:3px;font-family:'Courier New',monospace;font-size:.65rem;font-weight:700;letter-spacing:.08em;cursor:pointer;border:1px solid;text-decoration:none;margin:4px 6px 4px 0}
    .tsm-anb-cta:hover{filter:brightness(1.2)}
  </style>

  <!-- Header bar -->
  <div style="
    display:flex;align-items:center;justify-content:space-between;
    padding:10px 14px;
    background:rgba(0,0,0,.35);
    border-bottom:1px solid ${sev.color}33;
  ">
    <div style="display:flex;align-items:center;gap:10px">
      <span style="
        background:${sev.color};color:#000;
        font-size:.6rem;font-weight:900;letter-spacing:.12em;
        padding:3px 8px;border-radius:2px;
      ">⚠ ${sev.label}</span>
      <span style="color:${sev.color};font-size:.75rem;font-weight:700;letter-spacing:.1em">
        ${payload.bannerLabel || 'DOC ANOMALY DETECTED'} — ${(payload.checkStatus||'ACTIVE').replace(/_/g,' ')}
      </span>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:.6rem;color:#475569">${payload.sourceBadge || (payload.source === 'analysis-hub' ? '📊 FROM HUB' : '📄 FROM DOC SEARCH')}</span>
      <button onclick="TSM_ANB.dismiss()" style="
        background:transparent;border:1px solid #334155;color:#64748b;
        font-family:'Courier New',monospace;font-size:.6rem;letter-spacing:.06em;
        padding:3px 8px;border-radius:2px;cursor:pointer;
      ">✕ DISMISS</button>
    </div>
  </div>

  <!-- Doc metadata strip -->
  <div style="
    padding:7px 14px;
    background:rgba(0,0,0,.2);
    border-bottom:1px solid rgba(255,255,255,.06);
    font-size:.62rem;color:#94a3b8;
    display:flex;flex-wrap:wrap;gap:4px 0;letter-spacing:.04em;
  ">${docInfo || `Node: ${nodeId.toUpperCase()}`}</div>

  <!-- Body -->
  <div style="padding:14px;display:grid;grid-template-columns:1fr 1fr;gap:16px">

    <!-- Left: narrative + findings -->
    <div>
      <div style="color:#94a3b8;font-size:.6rem;letter-spacing:.1em;margin-bottom:8px">EXECUTIVE NARRATIVE</div>
      <p style="color:#cbd5e1;font-size:.72rem;line-height:1.6;margin:0 0 14px">${narr}</p>

      ${findings.length ? `
      <div style="color:#94a3b8;font-size:.6rem;letter-spacing:.1em;margin-bottom:6px">COMPLIANCE FINDINGS</div>
      <ul style="list-style:none;margin:0;padding:0">${findingsHtml}</ul>
      ` : ''}
    </div>

    <!-- Right: remediation checklist -->
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px">
        <div style="color:#94a3b8;font-size:.6rem;letter-spacing:.1em">REMEDIATION CHECKLIST</div>
        <span id="tsm-anb-counter" style="font-size:.6rem;color:${sev.color}">0 / ${steps.length} tracked</span>
      </div>
      <div style="color:#475569;font-size:.6rem;letter-spacing:.02em;margin-bottom:8px;display:flex;align-items:center;gap:5px">
        <span style="flex-shrink:0">ℹ</span>
        <span>Manual tracking only — checking a step confirms <em>you</em> made the correction in the source system. Nothing here submits or edits claims data automatically.</span>
      </div>

      <!-- Progress bar -->
      <div style="height:3px;background:rgba(255,255,255,.08);border-radius:2px;margin-bottom:10px;overflow:hidden">
        <div id="tsm-anb-progress-bar" style="height:100%;width:0%;background:${sev.color};border-radius:2px"></div>
      </div>

      ${steps.length ? `
      <ul id="tsm-anb-steps" style="list-style:none;margin:0;padding:0">${stepsHtml}</ul>
      ` : '<p style="color:#475569;font-size:.7rem">No remediation steps loaded.</p>'}

      <!-- CTA buttons -->
      <div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)">
        ${payload.warRoomUrl ? `
        <a class="tsm-anb-cta" href="${payload.warRoomUrl}"
          style="color:${sev.color};border-color:${sev.color}55;background:${sev.bg}">
          ⚡ OPEN WAR ROOM
        </a>` : ''}
        <a class="tsm-anb-cta" href="/html/healthcare/index.html"
          style="color:#00e5ff;border-color:#00e5ff44;background:rgba(0,229,255,.06)">
          📊 HC HUB
        </a>
        <button class="tsm-anb-cta" onclick="TSM_ANB.exportChecklist()"
          style="color:#a78bfa;border-color:#a78bfa44;background:rgba(167,139,250,.06)">
          📋 EXPORT
        </button>
      </div>

      <!-- Completion flash -->
      <div id="tsm-anb-complete" style="display:none;margin-top:10px;padding:8px 10px;border-radius:3px;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);color:#10b981;font-size:.68rem;font-weight:700;letter-spacing:.08em;text-align:center">
        ✓ ALL STEPS TRACKED — ESCALATE TO STRATEGIST
      </div>
    </div>
  </div>
</div>`;

    // Inject at top of page body — before first child of main content container
    const target = (
      document.querySelector('.main-content') ||
      document.querySelector('.node-main') ||
      document.querySelector('main') ||
      document.querySelector('.content') ||
      document.body
    );

    const wrapper = document.createElement('div');
    wrapper.id = 'tsm-anb-wrapper';
    wrapper.innerHTML = html;
    target.insertBefore(wrapper, target.firstChild);

    // ── 6. CONTROLLER ─────────────────────────────────────────────────────
    const total = steps.length;
    let completed = 0;

    window.TSM_ANB = {
      payload,
      nodeId,

      stepToggle(checkbox, idx) {
        const li = checkbox.closest('.tsm-anb-step');
        if (checkbox.checked) {
          li.classList.add('done');
          completed++;
        } else {
          li.classList.remove('done');
          completed--;
        }
        completed = Math.max(0, Math.min(total, completed));
        document.getElementById('tsm-anb-counter').textContent = `${completed} / ${total} tracked`;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        document.getElementById('tsm-anb-progress-bar').style.width = pct + '%';
        if (completed === total && total > 0) {
          document.getElementById('tsm-anb-complete').style.display = 'block';
          // Write self-reported tracking status back to localStorage for the HC hub to see.
          // NOTE: this records that the operator manually checked every step in this UI —
          // it is NOT confirmation that the underlying claim was actually corrected in the
          // source system. Key/event names kept as-is (_nodeCompleted / node-checklist-complete)
          // since tsm-hc-workflow-guide.js matches this exact stage id to advance the guided tour.
          try {
            const rec = JSON.parse(localStorage.getItem('tsm-doc-anomaly') || '{}');
            rec._nodeCompleted = rec._nodeCompleted || {};
            rec._nodeCompleted[nodeId] = { ts: new Date().toISOString(), pct: 100, source: 'manual-self-report' };
            localStorage.setItem('tsm-doc-anomaly', JSON.stringify(rec));
          } catch(e) {}
          try { if (window.TSMWorkflowStage) TSMWorkflowStage.write('node-checklist-complete', { nodeId: nodeId, source: 'manual-self-report' }); } catch(e) {}
        } else {
          document.getElementById('tsm-anb-complete').style.display = 'none';
        }
      },

      dismiss() {
        const el = document.getElementById('tsm-anb-wrapper');
        if (el) { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }
        // Mark dismissed so it won't re-appear on page reload this session
        try { sessionStorage.setItem('tsm-anb-dismissed-' + nodeId, '1'); } catch(e) {}
      },

      exportChecklist() {
        const lines = [
          'TSM DOC ANOMALY REMEDIATION EXPORT',
          '====================================',
          `Node:      ${nodeId.toUpperCase()}`,
          `File:      ${payload.fileName || '—'}`,
          `Status:    ${payload.checkStatus || '—'}`,
          `Exposure:  $${Number(payload.financialImpact||0).toLocaleString()}`,
          `Exported:  ${new Date().toLocaleString()}`,
          '',
          'NARRATIVE',
          '---------',
          narr,
          '',
          'FINDINGS',
          '--------',
          ...findings.map(f => f.replace(/^[❌✓⚠️]\s*/,'')),
          '',
          'REMEDIATION STEPS',
          '-----------------',
          ...steps.map((s,i)=>`${i+1}. ${s}`),
        ].join('\n');
        const blob = new Blob([lines], { type:'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `tsm-anomaly-${nodeId}-${Date.now()}.txt`;
        a.click();
      }
    };

    // Let guide-panel-engine.js (loaded earlier in page order, so it may
    // already have run updateGuide() once with generic fallback text before
    // this script's own init() got here) know a live checklist just landed.
    try {
      window.dispatchEvent(new CustomEvent('tsm-anomaly-ready', { detail: { payload, nodeId } }));
    } catch (e) {}
  }

  // ── 6b. AUTO-APPLY ROUTED CLIENT DATA ───────────────────────────────────
  // If the office-manager routing extracted structured client/claim fields
  // from the source document (see extractClientData() in
  // hc-office-manager-doc-intake.html), fill this node's own "SET CLIENT
  // MISSION" intake fields with them and apply the mission automatically —
  // no operator click required. Without this, the data sits in the payload
  // but the operator still has to retype it by hand into the exact same
  // fields it was just extracted from.
  //
  // Each node page that wants this declares, before this script tag:
  //   window.TSM_CLIENT_INTAKE_MAP = { patient:'intake-patient', claim:'intake-claim', ... }
  //   window.TSM_CLIENT_INTAKE_APPLY_FN = 'applyIntake'   // the page's own apply function name
  // Pages that don't declare these (or whose field schema doesn't match a
  // billing/claims mission — e.g. hc-financial, hc-legal) are left alone;
  // nothing here runs for them.
  function autoApplyClientData(payload) {
    if (!payload || !payload.clientData || payload.source !== 'office-manager-intake') return;
    const map = window.TSM_CLIENT_INTAKE_MAP;
    const applyFnName = window.TSM_CLIENT_INTAKE_APPLY_FN;
    if (!map || !applyFnName || typeof window[applyFnName] !== 'function') return;
    const cd = payload.clientData;
    Object.keys(map).forEach(function (key) {
      if (cd[key] == null) return;
      const el = document.getElementById(map[key]);
      if (el) el.value = cd[key];
    });
    try { window[applyFnName](); } catch (e) { /* leave fields filled even if apply itself throws */ }
  }

  // ── 7. MAIN INIT ────────────────────────────────────────────────────────
  function init() {
    const nodeId = resolveNodeId();
    if (!nodeId) return;

    // Skip if user already dismissed this session
    try {
      if (sessionStorage.getItem('tsm-anb-dismissed-' + nodeId)) return;
    } catch(e) {}

    let payload;
    try {
      const raw = localStorage.getItem('tsm-doc-anomaly');
      if (!raw) return;
      payload = JSON.parse(raw);
    } catch(e) { return; }

    if (!payload || !payload.checkStatus) return;
    // Don't show PASSED banners
    if (payload.checkStatus === 'PASSED') return;
    // Stale check — ignore if older than 4 hours
    if (payload.ts && (Date.now() - payload.ts) > 4 * 3600 * 1000) return;

    // Check affinity: does this doc belong on THIS node page?
    const affinity = getAffinityNodes(payload);
    if (!affinity.has(nodeId)) return;

    renderBanner(payload, nodeId);
    autoApplyClientData(payload);
  }

  // Run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();