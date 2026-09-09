/**
 * TSM Executive Portal Upgrade v1.0
 * Injects into every canonical exec portal:
 *   - Decision Center  (approve/reject with audit trail)
 *   - KPI Chart Panel  (SVG-based, no external deps)
 *   - Execution Tracker (live progress from Event Bus)
 *   - Control Plane wiring (TSMBus subscriptions)
 *
 * Self-contained. Drop one <script> tag before </body>.
 * Pattern-matched to HC portal dark terminal aesthetic.
 */

(function (global) {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────
  const VERTICAL_MAP = {
    healthcare:   { relay: ['TSM_HC_WAR_RELAY','tsm_hc_war_relay'],         label: 'Revenue Cycle Command' },
    finops:       { relay: ['tsm_war_relay_finops-suite','TSM_FINOPS_WAR_RELAY'], label: 'FinOps Command' },
    insurance:    { relay: ['TSM_INS_WAR_RELAY','tsm_ins_war_relay'],        label: 'Insurance Command' },
    construction: { relay: ['TSM_CONSTRUCTION_WAR_RELAY','tsm_construction_war_relay'], label: 'Construction Command' },
    legal:        { relay: ['TSM_LEGAL_WAR_RELAY','tsm_legal_war_relay'],    label: 'Legal Command' },
    realestate:   { relay: ['TSM_RE_WAR_RELAY','tsm_re_war_relay'],          label: 'Real Estate Command' },
    bpo:          { relay: ['TSM_BPO_WAR_RELAY','tsm_bpo_war_relay'],        label: 'BPO Command' },
    concierge:    { relay: ['TSM_CONCIERGE_RELAY'],                          label: 'Concierge Transport Command' },
    collegecommand: { relay: ['TSM_COLLEGE_EXEC_RELAY'],                     label: 'College Command' },
  };

  const CSS_VARS = `
    --tsm-bg:      #0a0a0a;
    --tsm-surface: #111;
    --tsm-border:  #1e1e1e;
    --tsm-green:   #00ff88;
    --tsm-cyan:    #00d4ff;
    --tsm-amber:   #ffb300;
    --tsm-red:     #ff3b3b;
    --tsm-text:    #e0e0e0;
    --tsm-muted:   #666;
    --tsm-font:    'IBM Plex Mono', 'Share Tech Mono', monospace;
  `;

  // ── Detect vertical from URL ───────────────────────────────────────────────
  function detectVertical() {
    const p = window.location.pathname.toLowerCase();
    if (p.includes('healthcare') || p.includes('hc-') || p.includes('/healthcare/')) return 'healthcare';
    if (p.includes('finops'))                                                          return 'finops';
    if (p.includes('insurance'))                                                       return 'insurance';
    if (p.includes('construction'))                                                    return 'construction';
    if (p.includes('legal'))                                                           return 'legal';
    if (p.includes('reo') || p.includes('re-exec'))                                   return 'realestate';
    if (p.includes('bpo'))                                                             return 'bpo';
    if (p.includes('concierge'))                                                       return 'concierge';
    if (p.includes('college'))                                                         return 'collegecommand';
    return 'healthcare'; // fallback
  }

  const VERTICAL_DOMAIN_MAP = {
    healthcare: 'Healthcare',
    finops: 'FinOps',
    insurance: 'Insurance',
    construction: 'Construction',
    legal: 'Legal',
    concierge: 'Concierge',
    realestate: 'Real Estate',
    bpo: 'BPO',
    collegecommand: 'College Command'
  };

  function domainLabelFor(vertical) {
    return VERTICAL_DOMAIN_MAP[vertical] || vertical;
  }

  // ── Read relay ────────────────────────────────────────────────────────────
  function readRelay(keys) {
    for (const k of keys) {
      const v = sessionStorage.getItem(k) || localStorage.getItem(k);
      if (v) { try { return JSON.parse(v); } catch {} }
    }
    return null;
  }

  // ── SVG Spark Chart ───────────────────────────────────────────────────────
  function sparkLine(values, color, w = 120, h = 36) {
    if (!values || values.length < 2) return `<svg width="${w}" height="${h}"></svg>`;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
      <circle cx="${(values.length-1)/(values.length-1)*w}" cy="${h - ((values[values.length-1]-min)/range)*(h-4)-2}" r="2.5" fill="${color}"/>
    </svg>`;
  }

  function donutChart(pct, color, size = 56) {
    const r = 22; const c = 2 * Math.PI * r;
    const dash = (pct / 100) * c;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#1e1e1e" stroke-width="6"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="6"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
        stroke-dashoffset="${(c * 0.25).toFixed(1)}"
        stroke-linecap="round"/>
      <text x="${size/2}" y="${size/2+5}" text-anchor="middle" fill="${color}"
        font-size="11" font-family="IBM Plex Mono,monospace" font-weight="bold">${pct}%</text>
    </svg>`;
  }

  // ── Build KPI data from relay ─────────────────────────────────────────────
  function buildKPIs(relay, vertical) {
    const kpis = {
      healthcare: [
        { label: 'Denial Rate',     value: relay?.denialRate    || '18%',  trend: [22,20,19,18,18], color: 'var(--tsm-amber)', unit: '' },
        { label: 'Recovery Rate',   value: relay?.recoveryRate  || '74%',  trend: [68,70,71,73,74], color: 'var(--tsm-green)', unit: '' },
        { label: 'Exposure',        value: relay?.exposure      || '$42K', trend: [55,50,47,44,42], color: 'var(--tsm-red)',   unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '81%',  trend: [72,75,78,80,81], color: 'var(--tsm-cyan)', unit: '' },
      ],
      finops: [
        { label: 'Budget Variance', value: relay?.variance      || '-8%',  trend: [12,10,9,8,8],   color: 'var(--tsm-amber)', unit: '' },
        { label: 'Burn Rate',       value: relay?.burnRate      || '$12K', trend: [15,14,13,12,12], color: 'var(--tsm-red)',   unit: '' },
        { label: 'Savings Found',   value: relay?.savings       || '$31K', trend: [10,18,24,28,31], color: 'var(--tsm-green)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '79%',  trend: [70,73,76,78,79], color: 'var(--tsm-cyan)', unit: '' },
      ],
      insurance: [
        { label: 'Fraud Score',     value: relay?.fraudScore    || '3.2',  trend: [4.1,3.8,3.5,3.3,3.2], color: 'var(--tsm-amber)', unit: '' },
        { label: 'Claim Exposure',  value: relay?.exposure      || '$88K', trend: [110,100,95,90,88],     color: 'var(--tsm-red)',   unit: '' },
        { label: 'Recovery',        value: relay?.recovery      || '62%',  trend: [50,54,58,60,62],       color: 'var(--tsm-green)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '84%',  trend: [74,77,80,82,84],       color: 'var(--tsm-cyan)', unit: '' },
      ],
      construction: [
        { label: 'Cost Overrun',    value: relay?.overrun       || '14%',  trend: [22,19,17,15,14], color: 'var(--tsm-amber)', unit: '' },
        { label: 'Schedule Risk',   value: relay?.scheduleRisk  || 'HIGH', trend: [5,4,4,3,3],      color: 'var(--tsm-red)',   unit: '' },
        { label: 'RFI Backlog',     value: relay?.rfiBacklog    || '7',    trend: [14,12,10,8,7],   color: 'var(--tsm-amber)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '77%',  trend: [65,69,72,75,77], color: 'var(--tsm-cyan)', unit: '' },
      ],
      legal: [
        { label: 'Liability Exp.',  value: relay?.liability     || '$120K',trend: [200,160,140,130,120], color: 'var(--tsm-red)',   unit: '' },
        { label: 'Settlement Prob', value: relay?.settlementPct || '68%',  trend: [45,52,58,64,68],     color: 'var(--tsm-green)', unit: '' },
        { label: 'Deadlines',       value: relay?.deadlines     || '3',    trend: [6,5,4,3,3],          color: 'var(--tsm-amber)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '82%',  trend: [70,74,77,80,82],     color: 'var(--tsm-cyan)', unit: '' },
      ],
      realestate: [
        { label: 'Portfolio Risk',  value: relay?.portfolioRisk || 'MED',  trend: [4,4,3,3,3],      color: 'var(--tsm-amber)', unit: '' },
        { label: 'Equity Exposure', value: relay?.exposure      || '$215K',trend: [280,255,235,220,215], color: 'var(--tsm-red)', unit: '' },
        { label: 'Recovery Rate',   value: relay?.recovery      || '71%',  trend: [60,64,67,69,71], color: 'var(--tsm-green)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence    || '80%',  trend: [68,72,75,78,80], color: 'var(--tsm-cyan)', unit: '' },
      ],
      bpo: [
        { label: 'SLA Breach Risk', value: relay?.slaRisk       || '23%',  trend: [35,30,27,24,23], color: 'var(--tsm-amber)', unit: '' },
        { label: 'Volume Backlog',  value: relay?.backlog        || '142',  trend: [210,180,165,150,142], color: 'var(--tsm-red)', unit: '' },
        { label: 'Resolution Rate', value: relay?.resolution     || '78%',  trend: [65,70,73,76,78], color: 'var(--tsm-green)', unit: '' },
        { label: 'Confidence',      value: relay?.confidence     || '76%',  trend: [64,68,71,74,76], color: 'var(--tsm-cyan)', unit: '' },
      ],
      concierge: [
        { label: 'Open Missions',   value: relay?.open          ?? '3',    trend: [6,5,4,4,3],      color: 'var(--tsm-amber)', unit: '' },
        { label: 'Completed',       value: relay?.completed     ?? '18',   trend: [10,13,15,17,18], color: 'var(--tsm-green)', unit: '' },
        { label: 'Exceptions',      value: relay?.exceptions    ?? '1',    trend: [3,2,2,1,1],      color: 'var(--tsm-red)',   unit: '' },
        { label: 'Total Spend',     value: relay?.totalSpend != null ? ('$' + Number(relay.totalSpend).toFixed(2)) : '$4,120.00', trend: [2200,2900,3400,3800,4120], color: 'var(--tsm-cyan)', unit: '' },
      ],
      collegecommand: (() => {
        const domains = relay?.domains || [];
        const activeDomains = domains.length || 5;
        const exposure = domains.length
          ? domains.reduce((sum, d) => sum + ((d.payload && d.payload.financials && d.payload.financials.total_exposure) || 0), 0)
          : 480000;
        return [
          { label: 'Active Domains',  value: String(activeDomains), trend: [2,3,4,4,5],       color: 'var(--tsm-cyan)',  unit: '' },
          { label: 'Combined Exposure', value: '$' + Number(exposure).toLocaleString(), trend: [610,560,520,500,Math.round(exposure/1000)], color: 'var(--tsm-red)', unit: '' },
          { label: 'Domains Relayed', value: domains.length ? `${domains.length}/5` : '0/5', trend: [1,2,3,4,domains.length || 0], color: 'var(--tsm-amber)', unit: '' },
          { label: 'Confidence',      value: relay?.confidence || '—',  trend: [70,74,77,80,82], color: 'var(--tsm-green)', unit: '' },
        ];
      })(),
    };
    return kpis[vertical] || kpis.healthcare;
  }

  // ── Inject Styles ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('tsm-upgrade-styles')) return;
    const style = document.createElement('style');
    style.id = 'tsm-upgrade-styles';
    style.textContent = `
      :root { ${CSS_VARS} }

      #tsm-upgrade-panel {
        font-family: var(--tsm-font);
        color: var(--tsm-text);
        margin: 0;
        padding: 0 16px 32px;
      }

      /* ── Section headers ── */
      .tsm-sec-header {
        display: flex; align-items: center; gap: 10px;
        border-bottom: 1px solid var(--tsm-border);
        padding: 18px 0 10px;
        margin-bottom: 14px;
        font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
        color: var(--tsm-muted);
      }
      .tsm-sec-header .tsm-dot {
        width: 7px; height: 7px; border-radius: 50%;
        animation: tsm-pulse 1.4s infinite;
      }
      @keyframes tsm-pulse {
        0%,100% { opacity: 1; } 50% { opacity: 0.3; }
      }

      /* ── KPI Grid ── */
      .tsm-kpi-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
        margin-bottom: 28px;
      }
      .tsm-kpi-card {
        background: var(--tsm-surface);
        border: 1px solid var(--tsm-border);
        border-radius: 6px;
        padding: 14px 16px;
        display: flex; flex-direction: column; gap: 8px;
        position: relative; overflow: hidden;
      }
      .tsm-kpi-card::before {
        content: ''; position: absolute; top: 0; left: 0;
        width: 3px; height: 100%;
        background: var(--kpi-color, var(--tsm-cyan));
      }
      .tsm-kpi-label {
        font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase;
        color: var(--tsm-muted);
      }
      .tsm-kpi-row {
        display: flex; align-items: flex-end; justify-content: space-between;
      }
      .tsm-kpi-value {
        font-size: 22px; font-weight: bold;
        color: var(--kpi-color, var(--tsm-cyan));
        line-height: 1;
      }

      /* ── Decision Center ── */
      .tsm-decision-panel {
        background: var(--tsm-surface);
        border: 1px solid var(--tsm-border);
        border-radius: 6px;
        padding: 18px;
        margin-bottom: 28px;
      }
      .tsm-decision-item {
        display: flex; align-items: center; gap: 14px;
        padding: 12px 0;
        border-bottom: 1px solid var(--tsm-border);
      }
      .tsm-decision-item:last-child { border-bottom: none; }
      .tsm-decision-urgency {
        font-size: 9px; font-weight: bold; letter-spacing: 1px;
        padding: 3px 8px; border-radius: 3px;
        white-space: nowrap; flex-shrink: 0;
      }
      .tsm-u-critical { background: #ff3b3b22; color: var(--tsm-red); border: 1px solid var(--tsm-red); }
      .tsm-u-high     { background: #ffb30022; color: var(--tsm-amber); border: 1px solid var(--tsm-amber); }
      .tsm-u-medium   { background: #00d4ff22; color: var(--tsm-cyan); border: 1px solid var(--tsm-cyan); }
      .tsm-decision-text { flex: 1; font-size: 12px; line-height: 1.5; }
      .tsm-decision-meta { font-size: 10px; color: var(--tsm-muted); margin-top: 2px; }
      .tsm-decision-actions { display: flex; gap: 8px; flex-shrink: 0; }
      .tsm-btn {
        font-family: var(--tsm-font); font-size: 10px; font-weight: bold;
        letter-spacing: 1px; padding: 6px 14px;
        border-radius: 4px; border: none; cursor: pointer;
        text-transform: uppercase; transition: opacity .15s;
      }
      .tsm-btn:hover { opacity: 0.85; }
      .tsm-btn-approve { background: var(--tsm-green); color: #000; }
      .tsm-btn-reject  { background: transparent; color: var(--tsm-red); border: 1px solid var(--tsm-red); }
      .tsm-btn-hold    { background: transparent; color: var(--tsm-amber); border: 1px solid var(--tsm-amber); }
      .tsm-decision-status {
        font-size: 10px; padding: 3px 10px; border-radius: 3px;
        font-weight: bold; letter-spacing: 1px;
      }
      .tsm-status-approved { background: #00ff8822; color: var(--tsm-green); }
      .tsm-status-rejected { background: #ff3b3b22; color: var(--tsm-red); }
      .tsm-status-hold     { background: #ffb30022; color: var(--tsm-amber); }

      /* ── Execution Tracker ── */
      .tsm-exec-tracker {
        background: var(--tsm-surface);
        border: 1px solid var(--tsm-border);
        border-radius: 6px;
        padding: 18px;
        margin-bottom: 28px;
      }
      .tsm-exec-log {
        font-size: 10px; color: var(--tsm-muted);
        max-height: 120px; overflow-y: auto;
        margin-top: 10px;
        border-top: 1px solid var(--tsm-border);
        padding-top: 8px;
      }
      .tsm-log-entry {
        padding: 2px 0;
        display: flex; gap: 10px;
      }
      .tsm-log-ts { color: #444; flex-shrink: 0; }
      .tsm-log-ok    { color: var(--tsm-green); }
      .tsm-log-warn  { color: var(--tsm-amber); }
      .tsm-log-err   { color: var(--tsm-red); }
      .tsm-log-muted { color: var(--tsm-muted); }

      /* ── Audit Trail ── */
      .tsm-audit-table {
        width: 100%; border-collapse: collapse;
        font-size: 10px;
      }
      .tsm-audit-table th {
        text-align: left; padding: 6px 10px;
        color: var(--tsm-muted); font-weight: normal;
        letter-spacing: 1px; text-transform: uppercase;
        border-bottom: 1px solid var(--tsm-border);
      }
      .tsm-audit-table td {
        padding: 7px 10px;
        border-bottom: 1px solid #161616;
      }
      .tsm-audit-table tr:hover td { background: #151515; }

      /* ── Improvement Rate ── */
      .tsm-rate-panel {
        background: var(--tsm-surface);
        border: 1px solid var(--tsm-border);
        border-radius: 6px;
        padding: 18px;
        margin-bottom: 28px;
      }
      .tsm-rate-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 12px;
      }
      .tsm-rate-card {
        background: var(--tsm-bg);
        border: 1px solid var(--tsm-border);
        border-radius: 6px;
        padding: 14px;
        text-align: center;
      }
      .tsm-rate-val { font-size: 20px; font-weight: bold; }
      .tsm-rate-val.green { color: var(--tsm-green); }
      .tsm-rate-val.red   { color: var(--tsm-red); }
      .tsm-rate-val.cyan  { color: var(--tsm-cyan); }
      .tsm-rate-val.muted { color: var(--tsm-muted); }
      .tsm-rate-lbl {
        font-size: 9px; letter-spacing: 1px; text-transform: uppercase;
        color: var(--tsm-muted); margin-top: 6px;
      }
      .tsm-rate-empty {
        font-size: 11px; color: var(--tsm-muted); text-align: center; padding: 8px 0;
      }
    `;
    document.head.appendChild(style);
  }

  // ── Build Decision Items from relay ───────────────────────────────────────
  function buildDecisionItems(relay, vertical) {
    const defaults = {
      healthcare:   [
        { urgency: 'critical', text: 'Authorize CMS Penalty Response', meta: 'Compliance package ready · Missing exec signature', value: '$24K' },
        { urgency: 'high',     text: 'Approve Denial Recovery Bundle — Payer Group A', meta: '47 claims · 90-day window closing', value: '$38K' },
        { urgency: 'medium',   text: 'Ratify Prior Auth Escalation Protocol', meta: 'Clinical team standing by', value: '$12K' },
      ],
      finops:       [
        { urgency: 'critical', text: 'Approve Emergency Budget Reallocation', meta: 'Q4 burn rate exceeds threshold', value: '$85K' },
        { urgency: 'high',     text: 'Authorize Vendor Contract Renegotiation', meta: '3 contracts flagged for savings', value: '$31K' },
      ],
      insurance:    [
        { urgency: 'critical', text: 'Authorize SIU Investigation — Claim #4471', meta: 'Fraud score 3.2 · Pattern match detected', value: '$88K' },
        { urgency: 'high',     text: 'Approve Subrogation Filing Deadline Extension', meta: 'Statute expires in 14 days', value: '$42K' },
      ],
      construction: [
        { urgency: 'critical', text: 'Authorize Change Order #17 — Foundation Revision', meta: 'Structural engineer sign-off pending exec', value: '$127K' },
        { urgency: 'high',     text: 'Approve Subcontractor Penalty Waiver', meta: 'Weather delay documented · legal reviewed', value: '$18K' },
      ],
      legal:        [
        { urgency: 'critical', text: 'Approve Settlement Offer — Martinez v. TSM', meta: 'Opposing counsel deadline: 48hrs', value: '$120K' },
        { urgency: 'high',     text: 'Authorize Outside Counsel Engagement', meta: 'IP dispute requires specialist', value: '$35K' },
      ],
      realestate:   [
        { urgency: 'critical', text: 'Authorize REO Portfolio Disposition Strategy', meta: '12 properties flagged · Market window open', value: '$215K' },
        { urgency: 'high',     text: 'Approve Short Sale Exception — Property #7', meta: 'Buyer committed · 10-day close', value: '$48K' },
      ],
      bpo:          [
        { urgency: 'critical', text: 'Authorize SLA Breach Recovery Plan', meta: 'Client escalation received · 24hr window', value: '$22K' },
        { urgency: 'high',     text: 'Approve Staffing Surge Authorization', meta: 'Volume spike projected — next 7 days', value: '$14K' },
      ],
      concierge:    [
        { urgency: 'high',     text: 'Approve Driver Reassignment — Cancelled Mission', meta: 'Cancelled-by-driver exception open · client awaiting new ETA', value: '$1.2K' },
        { urgency: 'medium',   text: 'Ratify Vendor Rate Adjustment — Peak Window', meta: 'Recurring surcharge flagged across 3 missions', value: '$650' },
      ],
      collegecommand: [
        { urgency: 'critical', text: 'Authorize Financial Aid Disbursement Hold Review', meta: 'Bursar/FinAid domains report exposure above threshold', value: '$210K' },
        { urgency: 'high',     text: 'Approve Endowment Compliance Response', meta: 'Accreditation domain flagged pending documentation', value: '$75K' },
      ],
    };

    // Merge relay data if available
    const items = (relay?.decisions || defaults[vertical] || defaults.healthcare);
    return items;
  }

  // ── Render Decision Center ─────────────────────────────────────────────────
  function renderDecisionCenter(items, container) {
    const auditLog = [];

    const panel = document.createElement('div');
    panel.innerHTML = `
      <div class="tsm-sec-header">
        <div class="tsm-dot" style="background:var(--tsm-red)"></div>
        Decision Center — Actions Required
      </div>
      <div class="tsm-decision-panel" id="tsm-decision-panel">
        ${items.map((item, i) => `
          <div class="tsm-decision-item" id="tsm-dec-${i}">
            <div class="tsm-decision-urgency tsm-u-${item.urgency}">${item.urgency.toUpperCase()}</div>
            <div class="tsm-decision-text">
              ${item.text}
              <div class="tsm-decision-meta">${item.meta}${item.value ? ` · <span style="color:var(--tsm-amber)">${item.value}</span>` : ''}</div>
            </div>
            <div class="tsm-decision-actions" id="tsm-dec-actions-${i}">
              <button class="tsm-btn tsm-btn-approve" onclick="TSMExecPortal.decide(${i},'approved')">✓ Approve</button>
              <button class="tsm-btn tsm-btn-hold"    onclick="TSMExecPortal.decide(${i},'hold')">⏸ Hold</button>
              <button class="tsm-btn tsm-btn-reject"  onclick="TSMExecPortal.decide(${i},'rejected')">✕ Reject</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(panel);
    return auditLog;
  }

  // ── Render KPI Charts ──────────────────────────────────────────────────────
  function renderKPIs(kpis, container) {
    const grid = document.createElement('div');
    grid.innerHTML = `
      <div class="tsm-sec-header">
        <div class="tsm-dot" style="background:var(--tsm-cyan)"></div>
        KPI Intelligence
      </div>
      <div class="tsm-kpi-grid">
        ${kpis.map(k => `
          <div class="tsm-kpi-card" style="--kpi-color:${k.color}">
            <div class="tsm-kpi-label">${k.label}</div>
            <div class="tsm-kpi-row">
              <div class="tsm-kpi-value">${k.value}</div>
              ${sparkLine(k.trend, k.color)}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(grid);
  }

  // ── Render Execution Tracker ───────────────────────────────────────────────
  function renderExecutionTracker(container) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="tsm-sec-header">
        <div class="tsm-dot" style="background:var(--tsm-green)"></div>
        Execution Tracker
      </div>
      <div class="tsm-exec-tracker">
        <div class="tsm-exec-log" id="tsm-exec-log">
          <div class="tsm-log-entry"><span class="tsm-log-ts">${_ts()}</span><span style="color:var(--tsm-muted)">Awaiting executive decision...</span></div>
        </div>
      </div>
    `;
    container.appendChild(wrap);
  }

  // ── Render Audit Trail ─────────────────────────────────────────────────────
  function renderAuditTrail(container) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="tsm-sec-header">
        <div class="tsm-dot" style="background:var(--tsm-amber)"></div>
        Audit Trail
      </div>
      <div style="background:var(--tsm-surface);border:1px solid var(--tsm-border);border-radius:6px;padding:4px 0;margin-bottom:28px;">
        <table class="tsm-audit-table">
          <thead><tr>
            <th>Timestamp</th><th>Event</th><th>Actor</th><th>Detail</th>
          </tr></thead>
          <tbody id="tsm-audit-tbody">
            <tr><td colspan="4" style="color:var(--tsm-muted);text-align:center;padding:16px;">No decisions recorded yet.</td></tr>
          </tbody>
        </table>
      </div>
    `;
    container.appendChild(wrap);
  }

  // ── Render Improvement Rate ─────────────────────────────────────────────────
  // Independent of the relay-driven KPI cards above: reads straight from the
  // server's HITL decision log for this vertical (POST /api/exec-portal/
  // :vertical/decide writes it, this reads it back), so it reflects real
  // approve/reject history rather than a relay snapshot.
  function renderImprovementRate(container) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="tsm-sec-header">
        <div class="tsm-dot" style="background:var(--tsm-green)"></div>
        Approval Improvement Rate
      </div>
      <div class="tsm-rate-panel" id="tsm-rate-panel">
        <div class="tsm-rate-empty">Loading decision history&hellip;</div>
      </div>
    `;
    container.appendChild(wrap);
  }

  async function loadImprovementRate(vertical) {
    const panel = document.getElementById('tsm-rate-panel');
    if (!panel) return;
    try {
      const r = await fetch(`/api/exec-portal/${vertical}/decisions`);
      const data = await r.json();
      if (!data || !data.ok) throw new Error('bad response');
      renderRateStats(data.stats, panel);
    } catch (e) {
      panel.innerHTML = `<div class="tsm-rate-empty">Decision history unavailable this session.</div>`;
    }
  }

  function renderRateStats(stats, panel) {
    if (!stats || !stats.total) {
      panel.innerHTML = `<div class="tsm-rate-empty">No decisions recorded yet &mdash; approve or reject an item above to start tracking trend.</div>`;
      return;
    }
    let deltaVal = '&mdash;', deltaCls = 'muted';
    if (stats.improvementRate !== null && stats.improvementRate !== undefined) {
      const dir = stats.improvementRate > 0 ? 'up' : (stats.improvementRate < 0 ? 'down' : 'flat');
      const arrow = dir === 'up' ? '&#9650;' : (dir === 'down' ? '&#9660;' : '&#9679;');
      const sign = stats.improvementRate > 0 ? '+' : '';
      deltaCls = dir === 'up' ? 'green' : (dir === 'down' ? 'red' : 'muted');
      deltaVal = `${arrow} ${sign}${stats.improvementRate}pp`;
    }
    panel.innerHTML = `
      <div class="tsm-rate-grid">
        <div class="tsm-rate-card"><div class="tsm-rate-val green">${stats.approvalRate}%</div><div class="tsm-rate-lbl">Approval Rate (All-Time)</div></div>
        <div class="tsm-rate-card"><div class="tsm-rate-val ${deltaCls}">${deltaVal}</div><div class="tsm-rate-lbl">Improvement vs Prior Period</div></div>
        <div class="tsm-rate-card"><div class="tsm-rate-val cyan">${stats.total}</div><div class="tsm-rate-lbl">Total Decisions</div></div>
        <div class="tsm-rate-card"><div class="tsm-rate-val green">${stats.approved}</div><div class="tsm-rate-lbl">Approved</div></div>
        <div class="tsm-rate-card"><div class="tsm-rate-val red">${stats.rejected}</div><div class="tsm-rate-lbl">Rejected</div></div>
      </div>
    `;
  }

  // ── Decision handler ──────────────────────────────────────────────────────
  function decide(index, verdict) {
    const actionsEl = document.getElementById(`tsm-dec-actions-${index}`);
    const itemEl    = document.getElementById(`tsm-dec-${index}`);
    if (!actionsEl) return;

    const statusMap = {
      approved: { cls: 'tsm-status-approved', label: '✓ APPROVED' },
      rejected: { cls: 'tsm-status-rejected', label: '✕ REJECTED' },
      hold:     { cls: 'tsm-status-hold',     label: '⏸ ON HOLD' },
    };
    const s = statusMap[verdict];
    actionsEl.innerHTML = `<div class="tsm-decision-status ${s.cls}">${s.label}</div>`;

    // Audit log entry
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${_ts(true)}</td>
      <td style="color:${verdict==='approved'?'var(--tsm-green)':verdict==='rejected'?'var(--tsm-red)':'var(--tsm-amber)'}">${verdict.toUpperCase()}</td>
      <td>Executive</td>
      <td>${itemEl?.querySelector('.tsm-decision-text')?.firstChild?.textContent?.trim() || '—'}</td>
    `;
    const tbody = document.getElementById('tsm-audit-tbody');
    if (tbody) {
      if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
      tbody.prepend(row);
    }

    // Emit to Control Plane
    const bus = global.TSMBus || global.TSMEventBus;
    if (bus) {
      bus.emit('EXECUTIVE_' + verdict.toUpperCase(), {
        index, verdict,
        vertical: detectVertical(),
        ts: Date.now(),
      });
    }

    // Update TSMState
    if (global.TSMState) {
      global.TSMState.update('executive', {
        approved: verdict === 'approved',
        reviewedAt: Date.now(),
      });
      global.TSMState.push('audit', { event: 'EXECUTIVE_DECISION', verdict, index, ts: Date.now() });
    }

    // Persist to the server-side HITL gate for this vertical (POST /api/
    // exec-portal/:vertical/decide) so the decision survives a reload and
    // feeds the Approval Improvement Rate panel. Fire-and-forget from the
    // UI's perspective -- the status pill above already updated optimistically,
    // this just makes sure the audit trail is real, not just DOM state.
    const vertical = detectVertical();
    const text = itemEl?.querySelector('.tsm-decision-text')?.firstChild?.textContent?.trim() || null;
    // TSMActiveMember is read-mostly and never guesses (see
    // tsm-active-member.js): getId() returns the tenantId only when a
    // Member was explicitly selected (URL param or command-center pick),
    // else null. Passed through so the server can resolve a real,
    // non-guessed clientId for the BPO relay below -- omitted entirely on
    // pages that haven't loaded tsm-active-member.js, same as before.
    const tenantId = (typeof global.TSMActiveMember !== 'undefined' && global.TSMActiveMember)
      ? global.TSMActiveMember.getId()
      : null;

    _logExec(`Persisting ${verdict} decision to server…`, 'tsm-log-muted');

    fetch(`/api/exec-portal/${vertical}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, verdict, text, actor: 'Executive', tenantId })
    }).then(async r => {
      const data = await r.json().catch(() => null);
      if (!r.ok || !data || data.ok === false) {
        _logExec(`Server rejected the decision${data && data.error ? ': ' + data.error : ` (HTTP ${r.status})`}`, 'tsm-log-err');
        return;
      }
      if (data.recorded) {
        _logExec(`Server confirmed — decision recorded (id: ${data.decision?.id || 'n/a'})`, 'tsm-log-ok');
        loadImprovementRate(vertical);
        if (typeof global.TSM !== 'undefined' && global.TSM.evidenceLedger) {
          global.TSM.evidenceLedger.record({
            domain: domainLabelFor(vertical),
            decisionId: String(data.decision?.id || `${vertical}-${index}-${Date.now()}`),
            summary: text ? `${verdict} — ${text}` : verdict,
            actor: 'Executive'
          });
        }
      } else {
        _logExec(`Server acknowledged the ${verdict} verdict but did not log it (not a terminal decision)`, 'tsm-log-warn');
      }
    }).catch(err => {
      _logExec(`Could not reach server — decision only reflected locally (${err.message || 'network error'})`, 'tsm-log-err');
    });
  }

  // Writes one real, timestamped line to the execution log — used for actual
  // fetch outcomes only, never a simulated/canned sequence.
  function _logExec(msg, cls) {
    const log = document.getElementById('tsm-exec-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'tsm-log-entry';
    entry.innerHTML = `<span class="tsm-log-ts">${_ts()}</span><span class="${cls}">${msg}</span>`;
    log.prepend(entry);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _ts(full = false) {
    const d = new Date();
    if (full) return d.toLocaleString();
    return d.toTimeString().slice(0,8);
  }

  // ── Wire Event Bus subscriptions ──────────────────────────────────────────
  function wireBus() {
    const bus = global.TSMBus || global.TSMEventBus;
    if (!bus) return;

    bus.on('AUDIT_ENTRY', (entry) => {
      const tbody = document.getElementById('tsm-audit-tbody');
      if (!tbody) return;
      if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
      const row = document.createElement('tr');
      row.innerHTML = `<td>${_ts(true)}</td><td>${entry.action || entry.event || '—'}</td><td>System</td><td>${JSON.stringify(entry.data || {}).slice(0,60)}</td>`;
      tbody.prepend(row);
    });
  }

  // ── Main init ─────────────────────────────────────────────────────────────
  function init() {
    const vertical = detectVertical();
    const config   = VERTICAL_MAP[vertical];
    const relay    = readRelay(config.relay);

    injectStyles();

    // Find injection point — after last existing section, or before </body>
    let target = document.querySelector('.main') ||
                 document.querySelector('main')  ||
                 document.querySelector('#main') ||
                 document.body;

    const panel = document.createElement('div');
    panel.id = 'tsm-upgrade-panel';
    target.appendChild(panel);

    const kpis      = buildKPIs(relay, vertical);
    const decisions = buildDecisionItems(relay, vertical);

    renderKPIs(kpis, panel);
    renderDecisionCenter(decisions, panel);
    renderExecutionTracker(panel);
    renderImprovementRate(panel);
    renderAuditTrail(panel);
    wireBus();
    loadImprovementRate(vertical);

    // Update TSMState with vertical context
    if (global.TSMState) {
      global.TSMState.update('executive', { sector: vertical });
    }

    console.info(`[TSM ExecPortal] Upgrade v1.0 initialized — ${vertical}`);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  global.TSMExecPortal = { init, decide, detectVertical };

  // Auto-init
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window);