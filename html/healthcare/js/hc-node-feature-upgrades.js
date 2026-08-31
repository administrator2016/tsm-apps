(function(){
  if(window.__HC_REAL_NODE_FEATURE_UPGRADES__) return;
  window.__HC_REAL_NODE_FEATURE_UPGRADES__ = true;

  const FEATURES = {
    medical:{
      title:"MEDICAL NODE · Clinical Ops",
      kpis:[["No-Show Risk","14"],["Open Care Plans","32"],["Clinical Tasks","18"],["Provider Load","84%"]],
      features:["Patient Intake & Profile","Appointment Scheduling & Resource Calendar","Clinical Document Management","EHR / EMR Sync","Provider Daily Patient List","Predictive Clinical Insights"],
      actions:["Review today’s patient list","Check clinical task backlog","Upload visit summary / labs","Run no-show risk forecast"]
    },
    insurance:{
      title:"INSURANCE NODE · Eligibility + Prior Auth",
      kpis:[["Eligibility Checks","61"],["PA Aging","18"],["Denial Risk","HIGH"],["Payer SLA","72%"]],
      features:["Real-Time Eligibility Verification","Prior Authorization Management","PA SLA Timers","Predictive Denial Risk Scoring","Insurance Document Store","Payer Rules Engine"],
      actions:["Verify eligibility","Review prior auth aging","Run denial risk score","Attach payer policy PDF"]
    },
    billing:{
      title:"BILLING NODE · Claims + RCM",
      kpis:[["Claims Pending","247"],["Denial Rate","18.4%"],["Clean Claim","94.2%"],["Stalled Revenue","$48K"]],
      features:["Claim Creation & Scrubbing","CPT / ICD Validation","AR Aging Buckets","Payment Posting","EOB / Appeal Document Store","Auto-Tasks at Threshold"],
      actions:["Scrub claim batch","Review AR aging","Create appeal packet","Route payer inactivity alert"]
    },
    compliance:{
      title:"COMPLIANCE NODE · HIPAA + Audit",
      kpis:[["HIPAA Logs","ACTIVE"],["Policy Gaps","6"],["Audit Risk","HIGH"],["Access Review","OPEN"]],
      features:["HIPAA Logging & Monitoring","File Access Logs","Compliance Alerts","Role-Based Restrictions","Encryption Status Reporting","Record-Level Audit Trails"],
      actions:["Review PHI access logs","Check expired credentials","Generate audit packet","Escalate policy gap"]
    },
    financial:{
      title:"FINANCIAL NODE · Revenue + Forecasting",
      kpis:[["Revenue Risk","$2.1M"],["Margin Pressure","MED"],["Batch Recon","Open"],["Forecast","92%"]],
      features:["Revenue & Expense Dashboards","Provider Productivity","Cost-per-Encounter","Payment-to-Claim Reconciliation","Payer Deposit Tracking","Revenue Forecasting"],
      actions:["Run revenue forecast","Match payer deposits","Review margin contribution","Export finance summary"]
    },
    legal:{
      title:"LEGAL NODE · Contracts + Credentialing",
      kpis:[["Contracts","42"],["Renewals","7"],["Credentialing","11"],["Escalations","3"]],
      features:["Contract Document Repository","Provider Contracts","Payer Agreements","Credentialing Files","Renewal Timers","Compliance Sync to Legal Review"],
      actions:["Review expiring contract","Check credentialing queue","Open legal escalation","Sync compliance flag"]
    },
    pharmacy:{
      title:"PHARMACY NODE · Medication + Inventory",
      kpis:[["Refills","29"],["Medication PAs","12"],["Inventory Flags","5"],["Formulary Risk","MED"]],
      features:["Prescription Tracking","Refill Requests","Controlled-Substance Notifications","Medication Prior Auth","Formulary Lookup","Inventory Restock Alerts"],
      actions:["Review refill queue","Check formulary status","Run medication PA review","Flag restock need"]
    },
    vendors:{
      title:"VENDORS NODE · Supply + Contracts",
      kpis:[["Vendor SLAs","8"],["PO Requests","23"],["Spend Watch","$84K"],["Contract Gaps","4"]],
      features:["Vendor Profiles & Docs","Contracts / Certificates / Insurance","Supply Ordering","Approval Chains","Status Tracking","Invoice Sync to Financial Node"],
      actions:["Review vendor SLA","Create supply order","Check certificate expiry","Sync invoice to finance"]
    },
    grants:{
      title:"GRANTS NODE · Applications + Reporting",
      kpis:[["Open Grants","9"],["Reports Due","3"],["Eligibility","6"],["Renewals","2"]],
      features:["Grant Opportunity Search","Eligibility Criteria","Grant Applications","Upload Forms","Deadline Tracking","Compliance Reporting Requirements"],
      actions:["Search grant opportunity","Track application deadline","Upload grant form","Generate compliance report"]
    },
    taxprep:{
      title:"TAXPREP NODE · Filing Readiness",
      kpis:[["1099 Ready","78%"],["W-9 Gaps","11"],["Receipts","42"],["Tax Export","Ready"]],
      features:["Financial Export Tools","Provider Earnings Export","AR Summaries","1099 / W2 Storage","Expense Receipts","Deduction Worksheets"],
      actions:["Export revenue report","Check W-9 gaps","Prepare 1099 packet","Generate deduction worksheet"]
    },
    operations:{
      title:"OPERATIONS NODE · Frontline Throughput",
      kpis:[["Ops Queue","31"],["Staff Coverage","84%"],["Scheduling Backlog","12"],["Throughput","78/100"]],
      features:["Staffing Coverage","Scheduling Backlog","Intake Queue","Room / Equipment Scheduling","Automated Reminders","Operational Bottleneck Forecast"],
      actions:["Rebalance intake queue","Review staff coverage","Clear scheduling backlog","Run throughput BNCA"]
    }
  };

  function detectNode(){
    const path=location.pathname.toLowerCase();
    const txt=(document.body.innerText||"").toLowerCase();
    if(path.includes("taxprep") || txt.includes("tax prep")) return "taxprep";
    return Object.keys(FEATURES).find(k=>path.includes(k) || txt.includes(`hc ${k}`) || txt.includes(`${k} node`)) || "operations";
  }

  function askFeature(node, action){
    const out=document.getElementById("hc-feature-output");
    if(!out) return;
    out.style.display="block";
    out.textContent="TSM Neural Core running...";
    fetch("/api/hc/query",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        action:"HC_NODE_FEATURE_BNCA",
        agent:"HC_NODE_FRONTLINE",
        payload:{
          node:FEATURES[node].title,
          context:action,
          priority:"HIGH"
        }
      })
    }).then(r=>r.json()).then(d=>{
      out.textContent=d.reply||d.content||"No response";
    }).catch(()=>{
      out.textContent="Feature request failed. Check /api/hc/query.";
    });
  }

  function render(){
    const node=detectNode();
    const f=FEATURES[node];

    const old=document.getElementById("hc-real-feature-layer");
    if(old) old.remove();

    const panel=document.createElement("section");
    panel.id="hc-real-feature-layer";
    panel.style.cssText="margin:16px 18px;padding:18px;background:#07131d;border:1px solid rgba(0,255,198,.28);border-radius:14px;color:#dff7ff;font-family:Inter,system-ui,Arial";
    panel.innerHTML=`
      <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
        <div>
          <div style="color:#00ffc6;font-weight:950;letter-spacing:.16em">${f.title}</div>
          <div style="color:#8aa6b7;margin-top:6px">Frontline feature layer · built for daily work, ownership, and BNCA handoff</div>
        </div>
        <button onclick="document.getElementById('hc-real-feature-layer').scrollIntoView({behavior:'smooth'})" style="background:#00ffc6;color:#001;border:0;border-radius:10px;padding:10px 14px;font-weight:900">NODE READY</button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px">
        ${f.kpis.map(([a,b])=>`<div style="background:#0b1b28;border:1px solid rgba(255,255,255,.09);border-radius:12px;padding:13px"><small style="color:#8aa6b7;letter-spacing:.12em">${a}</small><b style="display:block;color:#00ffc6;font-size:24px;margin-top:6px">${b}</b></div>`).join("")}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px">
        <div style="background:#050b12;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px">
          <div style="color:#ffc400;font-weight:900;letter-spacing:.12em;margin-bottom:10px">FRONTLINE FEATURES</div>
          ${f.features.map(x=>`<div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)">✓ ${x}</div>`).join("")}
        </div>

        <div style="background:#050b12;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px">
          <div style="color:#00ffc6;font-weight:900;letter-spacing:.12em;margin-bottom:10px">AI ACTIONS FOR THIS NODE</div>
          ${f.actions.map(x=>`<button class="hc-feature-action" data-action="${x}" style="display:block;width:100%;margin:8px 0;padding:11px;border-radius:10px;border:1px solid rgba(0,255,198,.22);background:#0b1b28;color:#dff7ff;font-weight:850;text-align:left;cursor:pointer">⚡ ${x}</button>`).join("")}
          <pre id="hc-feature-output" style="display:none;white-space:pre-wrap;background:#061018;border:1px solid rgba(0,255,198,.18);border-radius:10px;padding:12px;margin-top:12px;color:#dff7ff;max-height:260px;overflow:auto"></pre>
        </div>
      </div>
    `;

    const anchor=document.querySelector("main,.content,.dashboard,.node-main") || document.body;
    anchor.prepend(panel);

    panel.querySelectorAll(".hc-feature-action").forEach(btn=>{
      btn.onclick=()=>askFeature(node,btn.dataset.action);
    });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",render);
  else render();

  console.log("HC Real Node Feature Upgrades installed");
})();
