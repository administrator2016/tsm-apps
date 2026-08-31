// hc-universal-tab-ai.js — HC Node Tab Content + AI Switching
(function(){
  if(window.__HC_UNIVERSAL_TAB_AI__) return;
  window.__HC_UNIVERSAL_TAB_AI__ = true;

  const NODE_DATA = {
    operations:{ title:"OPERATIONS",  color:"#00aaff", risk:"MED", owner:"Operations Lead",    sla:"Target: 35d AR",  queue:["Intake hold — 3 patients","Scheduling backlog — 14 slots","Staffing coverage gap","Throughput degradation alert"], ai:"Intake pressure elevated. Scheduling backlog at 14 slots — exceeds SLA threshold. Recommend: clear authorization holds before EOD." },
    medical:   { title:"MEDICAL",     color:"#00ffc6", risk:"MED", owner:"Clinical Lead",       sla:"CPT audit: 48h",  queue:["CPT mismatch — 6 claims","Clinical note gap — 3 charts","Provider escalation pending","Care-flow bottleneck"], ai:"CPT mismatch on 6 active claims. Clinical documentation gaps blocking 3 authorizations. Provider escalation required within 48h." },
    pharmacy:  { title:"PHARMACY",    color:"#ffc400", risk:"HIGH",owner:"Pharmacy Director",   sla:"Prior auth: 24h", queue:["Drug interaction alert","Prior auth dependency — 4","DEA schedule review due","Formulary exception pending"], ai:"Prior auth dependencies blocking 4 prescriptions. DEA schedule review overdue. Recommend: batch auth submission before formulary cutoff." },
    billing:   { title:"BILLING",     color:"#00ffc6", risk:"HIGH",owner:"Billing Lead",        sla:"Clean claim: 95%",queue:["Denial rate 18.4% vs 9% target","CO-197 appeal queue — 12","AR aging >30d — $189K","ENC-8821 prior auth missing"], ai:"Denial rate at 18.4% — double target. ENC-8821 appeal window closes in 30 days. Immediate action: file with auth reference. $4,200 recoverable." },
    compliance:{ title:"COMPLIANCE",  color:"#ff3366", risk:"HIGH",owner:"Compliance Lead",     sla:"HIPAA: 72h",      queue:["PHI transfer flag — review","HIPAA audit trail gap","Policy gap — 2 items","99214 upcoding — 14 instances"], ai:"14 upcoding instances flagged — CRITICAL. PHI transfer requires documentation within 72h. Audit trail gap must be resolved before CMS review." },
    insurance: { title:"INSURANCE",   color:"#00aaff", risk:"MED", owner:"Insurance Lead",      sla:"Auth SLA: 48h",   queue:["Prior auth aging — 8 claims","Payer rule conflict — Westside","Eligibility check — 22 pending","Appeal window — 30d"], ai:"8 prior auth claims aging past SLA. Westside payer rule conflict blocking $18.4K. Escalate to collections if unresolved by EOD." },
    financial: { title:"FINANCIAL",   color:"#00aaff", risk:"MED", owner:"Finance Lead",        sla:"P&L: Monthly",    queue:["Revenue cycle drag — $2.1M","P&L variance — Q2","Cash-flow exposure — $189K","WIP gap — unbilled 148"], ai:"148 unbilled services — $1.77M net recovery estimated. Cash-flow exposure $189K. BNCA batch submission recommended before month-end close." },
    legal:     { title:"LEGAL",       color:"#b56cff", risk:"MED", owner:"Legal Lead",          sla:"Response: 5d",    queue:["Contract exception — 2","Regulatory review pending","Escalation memo — Westside","Policy amendment due"], ai:"Contract exception requires legal review within 5 days. Westside escalation memo drafted. Regulatory review blocking 1 payer contract renewal." },
    vendors:   { title:"VENDORS",     color:"#ff7a00", risk:"MED", owner:"Vendor Operations",   sla:"SLA: 99.5%",      queue:["Vendor SLA breach — LabCorp","Contract renewal — 3 due","ROI review — 2 vendors","Supply chain — 1 flag"], ai:"LabCorp SLA breach detected. 3 vendor contracts up for renewal this quarter. ROI review on 2 underperforming vendors recommended." },
    grants:    { title:"GRANTS",      color:"#4aa3ff", risk:"LOW", owner:"Grant Program Dir",   sla:"Report: 30d",     queue:["HRSA report — 14 days","Budget restriction — Q3","Funding compliance check","Overdue report — 1 item"], ai:"HRSA reporting deadline in 14 days. Budget restriction on Q3 allocation. One overdue compliance report must be submitted before funding renewal." },
    taxprep:   { title:"TAX PREP",    color:"#d86cff", risk:"MED", owner:"Tax Operations Lead", sla:"Filing: APR",     queue:["APR filing window open","1099 readiness — 87%","W-9 gap — 6 vendors","Estimated payment due"], ai:"APR filing window open. 1099 readiness at 87% — 6 W-9 forms outstanding. Estimated payment due date approaching. Batch W-9 requests recommended." },
  };

  // ── RENDER NODE TAB CONTENT ────────────────────────────────────────────────
  function renderNodeContent(key) {
    const d = NODE_DATA[key] || NODE_DATA.operations;
    const riskColor = d.risk === 'HIGH' ? '#ff3d57' : d.risk === 'MED' ? '#ffb300' : '#00e676';

    return `
    <div style="padding:14px;display:flex;flex-direction:column;gap:10px">

      <!-- Header strip -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#07131d;border:1px solid rgba(255,255,255,.08);border-radius:8px">
        <div>
          <div style="font-size:11px;color:#4a6a7a;letter-spacing:.12em;text-transform:uppercase;margin-bottom:2px">${key} · active node</div>
          <div style="font-size:16px;font-weight:800;color:${d.color};letter-spacing:.08em">${d.title}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="font-size:10px;padding:3px 8px;background:${riskColor}22;border:1px solid ${riskColor}55;color:${riskColor};border-radius:3px;font-family:monospace;text-transform:uppercase">Risk: ${d.risk}</span>
          <span style="font-size:10px;padding:3px 8px;background:rgba(0,255,198,.08);border:1px solid rgba(0,255,198,.2);color:#00ffc6;border-radius:3px;font-family:monospace">${d.sla}</span>
        </div>
      </div>

      <!-- KPI row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
        <div style="background:#07131d;border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#4a6a7a;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Owner</div>
          <div style="font-size:11px;color:#c8d4e0;font-weight:600">${d.owner}</div>
        </div>
        <div style="background:#07131d;border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#4a6a7a;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Queue</div>
          <div style="font-size:14px;color:${riskColor};font-weight:800">${d.queue.length}</div>
        </div>
        <div style="background:#07131d;border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#4a6a7a;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Risk Level</div>
          <div style="font-size:11px;color:${riskColor};font-weight:700">${d.risk}</div>
        </div>
        <div style="background:#07131d;border:1px solid rgba(255,255,255,.07);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:9px;color:#4a6a7a;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Status</div>
          <div style="font-size:11px;color:#00ffc6;font-weight:700">● LIVE</div>
        </div>
      </div>

      <!-- Queue items -->
      <div style="background:#07131d;border:1px solid rgba(255,255,255,.07);border-radius:6px;overflow:hidden">
        <div style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06);font-family:monospace;font-size:9px;color:#4a6a7a;letter-spacing:.12em;text-transform:uppercase">Active Queue Items</div>
        ${d.queue.map((q,i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;color:#c8d4e0">
            <span style="font-family:monospace;font-size:9px;color:${riskColor};min-width:20px">${String(i+1).padStart(2,'0')}</span>
            <span>${q}</span>
          </div>`).join('')}
      </div>

      <!-- AI Synthesis -->
      <div style="background:rgba(0,255,198,.05);border:1px solid rgba(0,255,198,.2);border-radius:6px;padding:12px 14px">
        <div style="font-family:monospace;font-size:9px;color:#00ffc6;letter-spacing:.15em;text-transform:uppercase;margin-bottom:6px">⚡ BNCA AI Synthesis — ${d.title}</div>
        <div style="font-size:12px;color:#c8d4e0;line-height:1.6" id="ai-synthesis-${key}">${d.ai}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <button onclick="generateNodeNarrative('${key}')" style="padding:6px 14px;background:#00ffc6;color:#000;border:none;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:.08em;cursor:pointer;text-transform:uppercase;border-radius:3px">⚡ GENERATE FULL NARRATIVE</button>
          <button onclick="window.open('/healthcare/hc-${key}/index.html','_blank')" style="padding:6px 14px;background:transparent;border:1px solid rgba(0,255,198,.4);color:#00ffc6;font-family:monospace;font-size:10px;letter-spacing:.08em;cursor:pointer;text-transform:uppercase;border-radius:3px">OPEN NODE ↗</button>
        </div>
      </div>

    </div>`;
  }

  // ── WRITE MISSION TO QUEUE ─────────────────────────────────────────────────
  function writeMission(key, d, narrativeTxt) {
    const steps = d.queue.map((item, i) => 'Step ' + (i + 1) + ': ' + item);
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    if (window.TSMMission) {
      TSMMission.setActiveMission(key, label, steps);
    } else {
      // Fallback if TSMMission not loaded
      const mission = { vertical: key, label, progression_steps: steps, generated_at: Date.now() };
      localStorage.setItem('tsm_active_mission', JSON.stringify(mission));
      const queue = JSON.parse(localStorage.getItem('tsm_mission_queue') || '[]');
      const idx = queue.findIndex(q => q.vertical === key);
      const entry = { id: 'tsm-' + key + '-' + Date.now(), vertical: key, label, status: 'active', step_index: 0, completion_pct: 0 };
      if (idx === -1) queue.push(entry); else queue[idx] = entry;
      localStorage.setItem('tsm_mission_queue', JSON.stringify(queue));
    }
    console.log('[HC-TAB-AI] Mission written for vertical:', key);
  }

  // ── GENERATE FULL NARRATIVE via API ───────────────────────────────────────
  window.generateNodeNarrative = function(key) {
    const d = NODE_DATA[key] || NODE_DATA.operations;
    const el = document.getElementById('ai-synthesis-' + key);
    if(el) el.textContent = 'Generating narrative...';

    fetch('/api/hc/query', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        message: `Generate WIP executive narrative for ${key.toUpperCase()} node. Queue: ${d.queue.join(', ')}. Risk: ${d.risk}. Owner: ${d.owner}. Include HITL BNCA, owner lane, strategist relay, and CFO-ready next actions.`,
        system: 'You are a healthcare operations AI for TSM Command. Be precise and data-driven.'
      })
    })
    .then(r => r.json())
    .then(data => {
      const txt = data.reply || data.content || data.message || d.ai;
      if(el) el.textContent = txt;
      writeMission(key, d, txt);
    })
    .catch(() => {
      if(el) el.textContent = "Narrative generation failed. Check /api/hc/query.";
    });
  };

  // ── TAB / NODE SWITCHING ───────────────────────────────────────────────────
  function getContentPanel() {
    // Find or create the tab content panel
    let panel = document.getElementById('hc-node-tab-content');
    if(!panel) {
      panel = document.createElement('div');
      panel.id = 'hc-node-tab-content';
      panel.style.cssText = 'margin:14px;background:#07131d;border:1px solid rgba(0,255,198,.15);border-radius:12px;overflow:hidden;min-height:280px;transition:all .2s';
      // Insert after node grid
      const grid = document.getElementById('nodeGrid');
      if(grid && grid.parentNode) {
        grid.parentNode.insertBefore(panel, grid.nextSibling);
      } else {
        (document.querySelector('main,.content,.dashboard') || document.body).appendChild(panel);
      }
    }
    return panel;
  }

  function activateNode(key) {
    // Update active state on node cards
    document.querySelectorAll('.node-card,.play').forEach(el => {
      const elKey = el.dataset.node || (el.innerText||'').toLowerCase().replace(/\s/g,'');
      if(elKey === key) {
        el.classList.add('active');
        el.style.boxShadow = '0 0 20px rgba(0,255,198,.15)';
      } else {
        el.classList.remove('active');
        el.style.boxShadow = '';
      }
    });

    // Render content
    const panel = getContentPanel();
    panel.style.opacity = '0';
    setTimeout(() => {
      panel.innerHTML = renderNodeContent(key);
      panel.style.opacity = '1';
    }, 100);

    console.log('[HC-TAB-AI] Node activated:', key);
  }

  // ── WIRE NODE CARDS ────────────────────────────────────────────────────────
  function wireNodes() {
    // Wire existing node cards
    document.querySelectorAll('.node-card[data-node]').forEach(card => {
      if(card.dataset.tabWired) return;
      card.dataset.tabWired = '1';
      card.style.cursor = 'pointer';
      card.addEventListener('click', function(e) {
        // Don't intercept the OPEN button
        if(e.target.classList.contains('open-btn') || e.target.closest('.open-btn')) return;
        activateNode(card.dataset.node);
      });
    });

    // Wire sidebar playlist items
    document.querySelectorAll('.play').forEach(item => {
      if(item.dataset.tabWired) return;
      item.dataset.tabWired = '1';
      item.addEventListener('click', function() {
        const txt = (item.innerText||'').toLowerCase();
        const key = Object.keys(NODE_DATA).find(k => txt.includes(k)) || 'operations';
        activateNode(key);
        // Update active class
        document.querySelectorAll('.play').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
      });
    });

    // Wire any tab buttons
    document.querySelectorAll('[data-tab],[data-node-tab]').forEach(btn => {
      if(btn.dataset.tabWired) return;
      btn.dataset.tabWired = '1';
      btn.addEventListener('click', function() {
        const key = btn.dataset.tab || btn.dataset.nodeTab || btn.innerText.toLowerCase();
        activateNode(key);
      });
    });

    // Auto-activate first node or billing (highest risk for demo)
    activateNode('billing');
  }

  // ── OBSERVE for dynamically added nodes ───────────────────────────────────
  function init() {
    wireNodes();
    // Re-wire if nodeGrid gets populated after load
    const grid = document.getElementById('nodeGrid');
    if(grid) {
      const obs = new MutationObserver(() => { wireNodes(); obs.disconnect(); });
      obs.observe(grid, { childList: true });
    }
  }

  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 200); // slight delay to let node-enhance render cards
  }

  console.log('[HC-TAB-AI] Universal Tab AI online');
})();
