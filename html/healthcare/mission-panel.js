/**
 * TSM Mission Control Panel — patched for MissionBridge score reporting
 */

const DOMAIN_COLORS = {
  billing: "#00c896", denials: "#e84040", coding: "#00aaff",
  medical: "#00ffc6", payments: "#ffc400", ar: "#b56cff",
  operations: "#00aaff", compliance: "#ff4d6d", insurance: "#00aaff",
  pharmacy: "#ffc400", financial: "#00aaff", legal: "#b56cff",
  vendors: "#ff7a00", taxprep: "#d86cff", grants: "#4aa3ff"
};

const WORKFLOW_STAGES = ["INTAKE", "REVIEW", "ACTION", "CLOSE"];

const NODE_MAP = {
  "billing-queue":   "billing",
  "credentialing":   "billing",
  "denial-lab":      "compliance",
  "coding-review":   "medical",
  "ar-followup":     "billing",
  "medical-node":    "medical",
  "insurance-node":  "insurance",
  "operations-node": "operations",
  "pharmacy-node":   "pharmacy",
  "financial-node":  "financial",
  "legal-node":      "legal",
  "vendors-node":    "vendors",
  "taxprep-node":    "taxprep",
  "grants-node":     "grants"
};

const STATIC_MISSIONS = {
  billing: {
    title: "Prevent denial before payer adjudication",
    domain: "BILLING / CLAIMS",
    objectives: [
      { id: 0, label: "Review claim for all required fields", node: "billing-queue", domain: "billing", riskDelta: -8, strat: "Missing modifier on line 3 detected. Claim flagged for correction before submission.", workflow: 0 },
      { id: 1, label: "Verify NPI matches payer credentialing file", node: "credentialing", domain: "billing", riskDelta: -12, strat: "NPI mismatch resolved. Provider now active in payer network. Denial risk reduced.", workflow: 0 },
      { id: 2, label: "Check timely filing window for each payer", node: "denial-lab", domain: "denials", riskDelta: -15, strat: "Timely filing window: 90 days. 14 days remaining. Escalate to AR immediately.", workflow: 1 },
      { id: 3, label: "Submit via clearinghouse and monitor 277CA", node: "coding-review", domain: "coding", riskDelta: -20, strat: "277CA accepted. Claim in payer queue. Expected adjudication: 21 days.", workflow: 2 },
      { id: 4, label: "Post ERA payments and reconcile against fee schedule", node: "ar-followup", domain: "payments", riskDelta: -17, strat: "ERA posted. Variance of $42.10 identified. Secondary payer coordination initiated.", workflow: 3 }
    ]
  },
  denials: {
    title: "Resolve active denial before appeal deadline",
    domain: "DENIALS / AR",
    objectives: [
      { id: 0, label: "Identify denial reason code (CO/PR/OA)", node: "denial-lab", domain: "denials", riskDelta: -10, strat: "CO-197: Timely filing exceeded. Exception documentation required within 5 days.", workflow: 0 },
      { id: 1, label: "Pull clinical documentation for medical necessity", node: "medical-node", domain: "medical", riskDelta: -14, strat: "Clinical docs attached. Medical necessity criteria partially met — query physician.", workflow: 0 },
      { id: 2, label: "Draft appeal letter with supporting evidence", node: "denial-lab", domain: "denials", riskDelta: -18, strat: "Appeal drafted. External review option available if internal appeal fails.", workflow: 1 },
      { id: 3, label: "Submit appeal and log in AR tracker", node: "ar-followup", domain: "ar", riskDelta: -22, strat: "Appeal submitted. Payer response window: 30 days. Follow-up queued at day 20.", workflow: 2 }
    ]
  },
  coding: {
    title: "Ensure clean claim submission on first pass",
    domain: "CODING / CLAIMS",
    objectives: [
      { id: 0, label: "Validate CPT and ICD-10 code pairing", node: "coding-review", domain: "coding", riskDelta: -12, strat: "CPT 99213 with Z23 — valid pairing. Check modifier 25 requirement.", workflow: 0 },
      { id: 1, label: "Check modifier requirements by payer", node: "coding-review", domain: "coding", riskDelta: -15, strat: "Modifier 25 required for this payer. Added to claim line 1.", workflow: 0 },
      { id: 2, label: "Confirm authorization aligns with coded services", node: "billing-queue", domain: "billing", riskDelta: -20, strat: "Auth on file covers 3 visits. Coded visit 4 — obtain retro auth immediately.", workflow: 1 },
      { id: 3, label: "Release claim to billing queue", node: "billing-queue", domain: "billing", riskDelta: -18, strat: "Claim released. Clean claim rate improved. Expected first-pass acceptance: 94%.", workflow: 2 }
    ]
  },
  compliance: {
    title: "Close documentation gaps before billing handoff",
    domain: "COMPLIANCE / AUDIT",
    objectives: [
      { id: 0, label: "Review HIPAA authorization on file", node: "denial-lab", domain: "denials", riskDelta: -10, strat: "HIPAA auth expired. Obtain updated consent before billing.", workflow: 0 },
      { id: 1, label: "Audit OIG exclusion list for all providers", node: "coding-review", domain: "coding", riskDelta: -14, strat: "One provider flagged. Remove from active billing until cleared.", workflow: 0 },
      { id: 2, label: "Verify CMS conditions of participation", node: "billing-queue", domain: "billing", riskDelta: -18, strat: "CoP documentation complete. No deficiencies found.", workflow: 1 },
      { id: 3, label: "File audit trail and close compliance ticket", node: "ar-followup", domain: "ar", riskDelta: -20, strat: "Audit trail filed. Compliance score updated to 91%.", workflow: 2 }
    ]
  },
  medical: {
    title: "Prioritize clinical documentation gaps",
    domain: "MEDICAL / CLINICAL",
    objectives: [
      { id: 0, label: "Identify undocumented clinical encounters", node: "medical-node", domain: "medical", riskDelta: -12, strat: "3 encounters missing clinical notes. Provider query sent.", workflow: 0 },
      { id: 1, label: "Route blocked cases to correct owner", node: "coding-review", domain: "coding", riskDelta: -15, strat: "2 cases rerouted to attending physician for addendum.", workflow: 0 },
      { id: 2, label: "Validate medical necessity criteria", node: "denial-lab", domain: "denials", riskDelta: -18, strat: "Medical necessity confirmed for 4 of 5 cases. One requires peer review.", workflow: 1 },
      { id: 3, label: "Release to billing after documentation complete", node: "billing-queue", domain: "billing", riskDelta: -20, strat: "All cases released. Clean documentation rate: 87%.", workflow: 2 }
    ]
  },
  insurance: {
    title: "Resolve payer friction and authorization backlog",
    domain: "INSURANCE / AUTH",
    objectives: [
      { id: 0, label: "Confirm patient demographics match insurance", node: "billing-queue", domain: "billing", riskDelta: -8, strat: "DOB mismatch on 2 accounts. Corrected and resubmitted.", workflow: 0 },
      { id: 1, label: "Verify insurance ID formatting", node: "credentialing", domain: "billing", riskDelta: -6, strat: "ID format corrected for BlueCross prefix requirement.", workflow: 0 },
      { id: 2, label: "Obtain prior auth before scheduled procedure", node: "denial-lab", domain: "denials", riskDelta: -12, strat: "Auth obtained. Valid for 90 days. Procedure cleared.", workflow: 1 },
      { id: 3, label: "Run eligibility check and review 271 response", node: "coding-review", domain: "coding", riskDelta: -7, strat: "271 received. Coverage active. Copay $35. Deductible met.", workflow: 1 },
      { id: 4, label: "Flag intake errors for registration correction", node: "ar-followup", domain: "payments", riskDelta: -5, strat: "3 intake errors flagged. Front desk correction queue updated.", workflow: 2 }
    ]
  },
  operations: {
    title: "Rebalance intake and clear scheduling backlog",
    domain: "OPERATIONS / THROUGHPUT",
    objectives: [
      { id: 0, label: "Review intake queue for blocked registrations", node: "billing-queue", domain: "billing", riskDelta: -10, strat: "12 registrations blocked. Missing insurance info on 8.", workflow: 0 },
      { id: 1, label: "Identify scheduling gaps over 48 hours", node: "coding-review", domain: "coding", riskDelta: -8, strat: "Gap analysis complete. 3 provider slots underutilized.", workflow: 0 },
      { id: 2, label: "Escalate auth blockers older than 72 hours", node: "denial-lab", domain: "denials", riskDelta: -15, strat: "4 auths escalated to payer relations. Expected resolution: 24 hours.", workflow: 1 },
      { id: 3, label: "Align handoffs between intake, billing, scheduling", node: "ar-followup", domain: "ar", riskDelta: -12, strat: "Handoff protocol updated. Cross-lane drag reduced by 18%.", workflow: 2 }
    ]
  },
  pharmacy: {
    title: "Clear prior auth dependencies and medication access blockers",
    domain: "PHARMACY / RX",
    objectives: [
      { id: 0, label: "Review DEA schedule compliance", node: "coding-review", domain: "coding", riskDelta: -10, strat: "Schedule II prescriptions compliant. One Schedule III needs renewal.", workflow: 0 },
      { id: 1, label: "Escalate medication access blockers", node: "denial-lab", domain: "denials", riskDelta: -14, strat: "2 PA denials escalated. Step therapy exception filed.", workflow: 0 },
      { id: 2, label: "Verify drug interaction flags are resolved", node: "medical-node", domain: "medical", riskDelta: -12, strat: "Interaction flag cleared by attending. Medication approved.", workflow: 1 },
      { id: 3, label: "Confirm prior auth for high-cost medications", node: "billing-queue", domain: "billing", riskDelta: -18, strat: "Auth confirmed for biologics. Specialty pharmacy notified.", workflow: 2 }
    ]
  },
  financial: {
    title: "Prioritize high-value aging claims and cash flow",
    domain: "FINANCIAL / REVENUE CYCLE",
    objectives: [
      { id: 0, label: "Review AR aging over 90 days", node: "ar-followup", domain: "ar", riskDelta: -15, strat: "$340K in 90+ day AR. Top 10 accounts identified for immediate follow-up.", workflow: 0 },
      { id: 1, label: "Identify blocked payment workflows", node: "billing-queue", domain: "billing", riskDelta: -12, strat: "3 ERA files failed import. Manual posting required.", workflow: 0 },
      { id: 2, label: "Reconcile ERA payments against fee schedule", node: "coding-review", domain: "coding", riskDelta: -18, strat: "Variance of $12,400 identified. Underpayment appeal initiated.", workflow: 1 },
      { id: 3, label: "Escalate payer holds to payer relations", node: "denial-lab", domain: "denials", riskDelta: -20, strat: "Payer hold released. Payment expected within 14 days.", workflow: 2 }
    ]
  },
  legal: {
    title: "Review documentation and contract-risk exceptions",
    domain: "LEGAL / REGULATORY",
    objectives: [
      { id: 0, label: "Review HIPAA contract compliance", node: "denial-lab", domain: "denials", riskDelta: -10, strat: "Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed.", workflow: 0 },
      { id: 1, label: "Identify contract-risk exceptions", node: "coding-review", domain: "coding", riskDelta: -14, strat: "2 contract exceptions flagged for legal review.", workflow: 0 },
      { id: 2, label: "Escalate regulatory defense items", node: "medical-node", domain: "medical", riskDelta: -18, strat: "Defense memo prepared. Outside counsel notified.", workflow: 1 },
      { id: 3, label: "Close open compliance tickets", node: "ar-followup", domain: "ar", riskDelta: -16, strat: "4 compliance tickets closed. Regulatory risk score reduced.", workflow: 2 }
    ]
  },
  vendors: {
    title: "Escalate vendor SLA exceptions and confirm ownership",
    domain: "VENDORS / SUPPLY CHAIN",
    objectives: [
      { id: 0, label: "Review vendor SLA performance", node: "coding-review", domain: "coding", riskDelta: -10, strat: "2 vendors below SLA threshold. Escalation notices sent.", workflow: 0 },
      { id: 1, label: "Confirm next-action ownership for exceptions", node: "billing-queue", domain: "billing", riskDelta: -12, strat: "Ownership confirmed. Resolution deadline: 48 hours.", workflow: 0 },
      { id: 2, label: "Escalate supply chain blockers", node: "denial-lab", domain: "denials", riskDelta: -15, strat: "Supply chain blocker escalated to COO. Backup vendor activated.", workflow: 1 },
      { id: 3, label: "Review vendor contract ROI", node: "ar-followup", domain: "ar", riskDelta: -12, strat: "ROI analysis complete. 1 vendor contract recommended for renegotiation.", workflow: 2 }
    ]
  },
  taxprep: {
    title: "Clear filing windows and vendor tax documentation gaps",
    domain: "TAX PREP / FILING",
    objectives: [
      { id: 0, label: "Review 1099 filing readiness", node: "coding-review", domain: "coding", riskDelta: -12, strat: "14 of 18 vendors have W-9 on file. 4 requests sent.", workflow: 0 },
      { id: 1, label: "Identify missing W-9 forms", node: "billing-queue", domain: "billing", riskDelta: -10, strat: "4 W-9s outstanding. Payment hold applied until received.", workflow: 0 },
      { id: 2, label: "Confirm filing window deadlines", node: "denial-lab", domain: "denials", riskDelta: -15, strat: "1099 deadline: Jan 31. All forms must be filed within 9 days.", workflow: 1 },
      { id: 3, label: "Submit 1099s via IRS e-file system", node: "ar-followup", domain: "ar", riskDelta: -18, strat: "E-file submitted. Confirmation number received. APR risk cleared.", workflow: 2 }
    ]
  },
  grants: {
    title: "Track restricted funding and overdue grant documentation",
    domain: "GRANTS / COMPLIANCE",
    objectives: [
      { id: 0, label: "Review HRSA reporting deadlines", node: "coding-review", domain: "coding", riskDelta: -12, strat: "HRSA report due in 14 days. Data collection 60% complete.", workflow: 0 },
      { id: 1, label: "Identify overdue grant documentation", node: "billing-queue", domain: "billing", riskDelta: -10, strat: "2 grants have overdue deliverables. Program managers notified.", workflow: 0 },
      { id: 2, label: "Reconcile restricted funding usage", node: "denial-lab", domain: "denials", riskDelta: -15, strat: "Restricted funds reconciled. No unallowable costs identified.", workflow: 1 },
      { id: 3, label: "Submit grant compliance report", node: "ar-followup", domain: "ar", riskDelta: -18, strat: "Compliance report submitted. Grant in good standing.", workflow: 2 }
    ]
  }
};

class MissionPanel {
  constructor(container, missionKey) {
    this.container = typeof container === "string"
      ? document.getElementById(container)
      : container;
    this.missionKey = missionKey;
    this.mission = STATIC_MISSIONS[missionKey] || MISSIONS.billing;

    // Load saved progress from MissionBridge
    const saved = (typeof MissionBridge !== "undefined") ? MissionBridge.get() : {};
    if (saved && saved.missionKey === missionKey) {
      this.completed = saved.completed || [];
      this.currentRisk = saved.riskScore || 72;
    } else {
      this.completed = [];
      this.currentRisk = 72;
    }

    this.render();
  }

  setMission(missionKey) {
    this.missionKey = missionKey;
    this.mission = STATIC_MISSIONS[missionKey] || MISSIONS.billing;

    // Load saved progress for this mission
    const saved = (typeof MissionBridge !== "undefined") ? MissionBridge.get() : {};
    if (saved && saved.missionKey === missionKey) {
      this.completed = saved.completed || [];
      this.currentRisk = saved.riskScore || 72;
    } else {
      this.completed = [];
      this.currentRisk = 72;
    }

    this.render();
  }

  executeObjective(obj) {
    if (this.completed.includes(obj.id)) return;
    this.completed.push(obj.id);
    this.currentRisk = Math.max(4, this.currentRisk + obj.riskDelta);

    // Save progress to MissionBridge so crc-hc-practice.html gets updated
    if (typeof MissionBridge !== "undefined") {
      MissionBridge.set({
        missionKey: this.missionKey,
        completed: this.completed,
        riskScore: this.currentRisk,
        returnUrl: window.location.href
      });
    }

    this.updateMetrics();
    this.showStrategist(obj.strat);
    this.activateWorkflow(obj.workflow);
    this.renderObjectives();

    if (this.completed.length === this.mission.objectives.length) {
      this.onComplete();
    }

    // Navigate to the correct HC node on index.html
    const targetNode = NODE_MAP[obj.node] || obj.domain || obj.node;
    const returnUrl = window.location.href;

    setTimeout(() => {
      window.location.href = `/healthcare/index.html?node=${targetNode}&objective=${obj.node}&returnUrl=${encodeURIComponent(returnUrl)}&missionKey=${this.missionKey}&objectiveId=${obj.id}`;
    }, 800);
  }

  updateMetrics() {
    const pct = Math.round((this.completed.length / this.mission.objectives.length) * 100);
    const riskEl = this.container.querySelector(".mp-risk-bar");
    const riskScore = this.container.querySelector(".mp-risk-score");
    const progEl = this.container.querySelector(".mp-prog-bar");
    const progScore = this.container.querySelector(".mp-prog-score");
    if (riskEl) riskEl.style.width = this.currentRisk + "%";
    if (riskScore) riskScore.textContent = this.currentRisk;
    if (progEl) progEl.style.width = pct + "%";
    if (progScore) progScore.textContent = pct + "%";

    // Also update crc-hc-practice.html progress bar via MissionBridge storage event
    if (typeof MissionBridge !== "undefined") {
      MissionBridge.set({
        missionKey: this.missionKey,
        completed: this.completed,
        riskScore: this.currentRisk,
        returnUrl: window.location.href
      });
    }
  }

  showStrategist(text) {
    const box = this.container.querySelector(".mp-strat-box");
    const textEl = this.container.querySelector(".mp-strat-text");
    if (!box || !textEl) return;
    box.style.display = "block";
    textEl.textContent = "";
    let i = 0;
    const interval = setInterval(() => {
      textEl.textContent += text[i];
      i++;
      if (i >= text.length) clearInterval(interval);
    }, 16);
  }

  activateWorkflow(upTo) {
    const steps = this.container.querySelectorAll(".mp-wf-step");
    steps.forEach((el, i) => {
      if (i <= upTo) {
        el.style.color = "#00c896";
        el.style.borderColor = "#1a3d2a";
        el.style.background = "#0a1510";
      }
    });
  }

  onComplete() {
    const status = this.container.querySelector(".mp-status");
    if (status) {
      status.textContent = "● COMPLETE";
      status.style.color = "#00c896";
    }
    document.dispatchEvent(new CustomEvent("tsm:missionComplete", {
      detail: { mission: this.missionKey, completedAt: Date.now() }
    }));

    // Report completion back to crc-hc-practice.html
    if (typeof MissionBridge !== "undefined") {
      MissionBridge.set({
        missionKey: this.missionKey,
        completed: this.completed,
        riskScore: this.currentRisk,
        status: "complete",
        returnUrl: window.location.href
      });
    }
  }

  renderObjectives() {
    const list = this.container.querySelector(".mp-obj-list");
    if (!list) return;
    list.innerHTML = "";
    this.mission.objectives.forEach(obj => {
      const done = this.completed.includes(obj.id);
      const color = DOMAIN_COLORS[obj.domain] || "#555";
      const targetNode = NODE_MAP[obj.node] || obj.domain || obj.node;
      const el = document.createElement("div");
      el.className = "mp-objective" + (done ? " done" : "");
      el.style.cssText = `display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:${done ? "#0f1a14" : "#111"};border:1px solid ${done ? "#1a3d2a" : "#1e1e1e"};border-radius:5px;cursor:${done ? "default" : "pointer"};transition:border-color 0.15s;margin-bottom:5px;position:relative;z-index:10;`;
      el.innerHTML = `
        <div style="width:16px;height:16px;border:1px solid ${done ? "#00c896" : "#333"};border-radius:3px;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;background:${done ? "#00c896" : "transparent"};">
          ${done ? '<span style="font-size:10px;color:#000;font-weight:700;line-height:1;">✓</span>' : ""}
        </div>
        <div style="flex:1;">
          <div style="font-size:10px;line-height:1.5;color:${done ? "#444" : "#c0c0c0"};text-decoration:${done ? "line-through" : "none"};">${obj.label}</div>
          <div style="margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <span style="font-size:8px;color:${color};letter-spacing:1px;text-transform:uppercase;">${obj.domain}</span>
            ${!done ? `<span style="font-size:8px;color:#00aaff;letter-spacing:1px;cursor:pointer;">→ LAUNCH ${obj.node.toUpperCase()} · ${targetNode.toUpperCase()} NODE</span>` : ""}
          </div>
        </div>`;
      if (!done) {
        el.addEventListener("mouseenter", () => el.style.borderColor = "#333");
        el.addEventListener("mouseleave", () => el.style.borderColor = "#1e1e1e");
        el.addEventListener("click", (e) => {
  e.stopPropagation();
  e.preventDefault();
  this.executeObjective(obj);
});
      }
      list.appendChild(el);
    });
  }

  render() {
    const pct = Math.round((this.completed.length / this.mission.objectives.length) * 100);
    this.container.innerHTML = `
      <div class="mp-panel" style="background:#0d0d0d;border-left:1px solid #1e1e1e;height:100vh;overflow-y:auto;font-family:'JetBrains Mono','Courier New',monospace;position:fixed;right:0;top:0;width:340px;z-index:99999;">
        <div style="background:#111;border-bottom:1px solid #1e1e1e;padding:8px 14px;display:flex;align-items:center;justify-content:space-between;">
          <div style="font-size:9px;letter-spacing:2px;color:#555;">MISSION CONTROL</div>
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="mp-status" style="font-size:9px;letter-spacing:1px;color:#e84040;">● ACTIVE</div>
            <button onclick="this.closest('.mp-panel').style.display='none'" style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;line-height:1;">×</button>
          </div>
        </div>

        <div style="padding:14px;border-bottom:1px solid #1e1e1e;">
          <div style="font-size:8px;color:#555;letter-spacing:2px;margin-bottom:5px;">CURRENT MISSION</div>
          <div style="font-size:12px;font-weight:600;color:#e0e0e0;line-height:1.5;">${this.mission.title}</div>
          <div style="margin-top:10px;">
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
              <div style="font-size:8px;color:#555;width:72px;">RISK EXPOSURE</div>
              <div style="flex:1;height:3px;background:#1e1e1e;border-radius:2px;overflow:hidden;">
                <div class="mp-risk-bar" style="height:100%;width:${this.currentRisk}%;background:#e84040;border-radius:2px;transition:width 0.5s ease;"></div>
              </div>
              <div class="mp-risk-score" style="font-size:10px;color:#e84040;min-width:24px;text-align:right;">${this.currentRisk}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <div style="font-size:8px;color:#555;width:72px;">COMPLETION</div>
              <div style="flex:1;height:3px;background:#1e1e1e;border-radius:2px;overflow:hidden;">
                <div class="mp-prog-bar" style="height:100%;width:${pct}%;background:#00c896;border-radius:2px;transition:width 0.5s ease;"></div>
              </div>
              <div class="mp-prog-score" style="font-size:10px;color:#00c896;min-width:24px;text-align:right;">${pct}%</div>
            </div>
          </div>
        </div>

        <div style="padding:12px 14px;border-bottom:1px solid #1e1e1e;">
          <div style="font-size:8px;color:#555;letter-spacing:2px;margin-bottom:10px;">MISSION OBJECTIVES — CLICK TO EXECUTE IN HC NODES</div>
          <div class="mp-obj-list"></div>
        </div>

        <div class="mp-strat-box" style="padding:12px 14px;border-bottom:1px solid #1e1e1e;display:none;">
          <div style="font-size:8px;color:#555;letter-spacing:2px;margin-bottom:7px;">HC STRATEGIST</div>
          <div style="background:#0a1510;border:1px solid #1a3d2a;border-radius:5px;padding:10px 12px;">
            <div class="mp-strat-text" style="font-size:10px;color:#00c896;line-height:1.7;"></div>
          </div>
        </div>

        <div style="padding:10px 14px;border-bottom:1px solid #1e1e1e;">
          <div style="font-size:8px;color:#555;letter-spacing:2px;margin-bottom:7px;">WORKFLOW STATE</div>
          <div style="display:flex;gap:0;">
            ${WORKFLOW_STAGES.map((s, i) => `<div class="mp-wf-step" style="flex:1;text-align:center;font-size:8px;padding:6px 2px;border:1px solid #1e1e1e;${i > 0 ? "border-left:none;" : "border-radius:4px 0 0 4px;"}${i === WORKFLOW_STAGES.length - 1 ? "border-radius:0 4px 4px 0;" : ""}color:#333;letter-spacing:1px;transition:all 0.3s;">${s}</div>`).join("")}
          </div>
        </div>

        <div style="padding:10px 14px;">
          <a href="/healthcare/crc-hc-practice.html" style="display:block;text-align:center;background:#0a1510;border:1px solid #1a3d2a;color:#00c896;padding:8px;font-size:9px;letter-spacing:2px;text-decoration:none;border-radius:4px;">← RETURN TO PRACTICE</a>
          <button onclick="if(typeof MissionBridge!=='undefined'){MissionBridge.reset();}this.closest('.mp-panel').dispatchEvent(new Event('mp:reset'));location.reload();" style="margin-top:6px;width:100%;background:none;border:1px solid #1e1e1e;color:#333;padding:7px;font-size:9px;letter-spacing:2px;cursor:pointer;border-radius:4px;">RESET MISSION</button>
        </div>
      </div>`;

    this.renderObjectives();
  }

  static init(containerId, missionKey) {
    const instance = new MissionPanel(containerId, missionKey);
    return instance;
  }
}

// Expose globally
window.MissionPanel = MissionPanel;
window.TSM_MISSIONS = STATIC_MISSIONS;