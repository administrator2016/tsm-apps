(function(){
  if(window.__TSM_MEMORY_ENGINE__) return;
  window.__TSM_MEMORY_ENGINE__ = true;

  // v4: fixes a broken merge that left this file syntactically invalid
  // (two competing TSMMemory definitions, the richer one orphaned inside
  // an unused function and never executing). Same storage key as v3 so
  // any memory already written by a working v3 build is preserved.
  const STORAGE_KEY = "TSM_OPERATIONAL_MEMORY_V3";

  const path = location.pathname.toLowerCase();

  // Pages that live outside a vertical-named folder (e.g. shared war rooms
  // under /html/war-rooms/<tool>/ used by multiple verticals) can't be
  // path-sniffed reliably. Let them declare their sector explicitly via
  // ?vertical=<key>, checked before path matching. Falls through to path
  // matching if absent or not a recognized sector key.
  function detectSector(){
    const qp = new URLSearchParams(location.search).get("vertical");
    const KNOWN_SECTORS = ["construction","healthcare","insurance","finops","legal","tax","bpo","reo","rrd","music","mortgage","schools","honeywell","executive"];
    if(qp && KNOWN_SECTORS.includes(qp)) return qp;
    if(path.includes("construction")) return "construction";
    if(path.includes("healthcare") || path.includes("hc-")) return "healthcare";
    if(path.includes("insurance") || path.includes("az-ins")) return "insurance";
    if(path.includes("finops") || path.includes("financial") || path.includes("supplier-vendor") || path.includes("logistics")) return "finops";
    if(path.includes("legal")) return "legal";
    if(path.includes("tax")) return "tax";
    if(path.includes("bpo")) return "bpo";
    if(path.includes("reo") || path.includes("realty") || path.includes("re-war") || path.includes("re-exec")) return "reo";
    if(path.includes("rrd")) return "rrd";
    if(path.includes("music")) return "music";
    if(path.includes("mortgage")) return "mortgage";
    if(path.includes("schools")) return "schools";
    if(path.includes("honeywell") || path.includes("plant-incident") || path.includes("supplier-shutdown") || path.includes("cyber-incident")) return "honeywell";
    return "executive";
  }

  // Stay aligned with TSMSectorIntelligence's sector keys when that script
  // is present, so the two systems never disagree about what a sector is called.
  function normalizeSector(s){
    if(window.TSMSectorIntelligence && typeof window.TSMSectorIntelligence.normalizeSector === "function"){
      try{ return window.TSMSectorIntelligence.normalizeSector(s); }catch(e){}
    }
    return s;
  }

  const sector = normalizeSector(detectSector());

  const DEFAULTS = {
    construction:{
      exposure:"$182K",
      strategist:"HIGH",
      narrative:"Permit delays and subcontractor exposure are impacting billing timing and operational readiness."
    },
    healthcare:{
      exposure:"$189K",
      strategist:"HIGH",
      narrative:"Denial pressure and payer delays are increasing reimbursement exposure and operational escalation."
    },
    insurance:{
      exposure:"$144K",
      strategist:"MEDIUM",
      narrative:"Insurance qualification and payer pressure are impacting approval throughput and denial posture."
    },
    finops:{
      exposure:"$480K",
      strategist:"HIGH",
      narrative:"Close-readiness and reconciliation pressure continue to impact executive financial visibility."
    },
    legal:{
      exposure:"$22.5K",
      strategist:"MEDIUM",
      narrative:"Legal filing dependencies and WIP exposure remain operationally sensitive."
    },
    tax:{
      exposure:"$39K",
      strategist:"LOW",
      narrative:"Tax evidence collection and filing readiness are being actively monitored."
    },
    bpo:{
      exposure:"$2.9M",
      strategist:"CRITICAL",
      narrative:"Backlog pressure, SLA breaches, and cross-client operational disruptions are actively threatening revenue continuity."
    },
    reo:{
      exposure:"$346K",
      strategist:"MEDIUM",
      narrative:"Appraisal gap exposure, title issues, and REO disposition timelines are driving pull-through risk."
    },
    rrd:{
      exposure:"$220K",
      strategist:"HIGH",
      narrative:"Recovery pressure and unresolved charge-off exposure remain elevated."
    },
    executive:{
      exposure:"ACTIVE",
      strategist:"ACTIVE",
      narrative:"Cross-sector operational pressure is actively being coordinated through the strategist mesh."
    },
    mortgage:{
      exposure:"$310K",
      strategist:"HIGH",
      narrative:"Closing-delay and compliance exception exposure across the loan pipeline are driving board-level escalation risk."
    },
    schools:{
      exposure:"$95K",
      strategist:"MEDIUM",
      narrative:"Grant funding-delay and compliance exception exposure across the award portfolio are being monitored for deobligation risk."
    },
    honeywell:{
      exposure:"$260K",
      strategist:"HIGH",
      narrative:"Plant incident, supplier shutdown, and cyber containment exposure across the operations mesh are driving escalation risk."
    }
  };

  function nowISO(){
    return new Date().toISOString();
  }

  function loadMemory(){
    try{
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    }catch(e){
      return {};
    }
  }

  function saveMemory(m){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
    }catch(e){}
  }

  const mem = loadMemory();

  // Additive shape patch: if older memory exists for this sector but predates
  // anomaly/case tracking, fill in the missing pieces without touching
  // whatever exposure/strategist/timeline/owner/relay data is already there.
  function ensureSector(){
    if(!mem[sector]){
      mem[sector] = {
        exposure: DEFAULTS[sector]?.exposure || "ACTIVE",
        strategist: DEFAULTS[sector]?.strategist || "MEDIUM",
        narrative: DEFAULTS[sector]?.narrative || "Operational pressure detected.",
        pressure: 50,
        timeline: [],
        owners: [],
        relays: []
      };
    }

    const s = mem[sector];
    if(!s.anomalies) s.anomalies = [];
    if(!s.cases) s.cases = {};
    if(!s.fieldMemory) s.fieldMemory = {};
    if(!s.executiveQueue) s.executiveQueue = [];
    if(!s.stats) s.stats = { anomaliesDetected:0, anomaliesResolved:0, autoPopulatedFields:0, relayCount:0 };

    return s;
  }

  function makeFieldKey(entityType, entityId, field){
    return `${String(entityType || "unknown").toLowerCase()}:${String(entityId || "unknown")}:${String(field || "").trim()}`;
  }

  function getCaseKey(entityType, entityId){
    return `${String(entityType || "case").toUpperCase()}:${String(entityId || "UNKNOWN")}`;
  }

  function ensureCase(entityType, entityId, extra = {}){
    const s = ensureSector();
    const caseKey = getCaseKey(entityType, entityId);

    if(!s.cases[caseKey]){
      s.cases[caseKey] = {
        caseKey,
        entityType: entityType || "case",
        entityId: entityId || "UNKNOWN",
        createdAt: nowISO(),
        lastSeenAt: nowISO(),
        fields: {},
        anomalies: [],
        relays: [],
        notes: [],
        meta: extra.meta || {}
      };
    } else {
      s.cases[caseKey].lastSeenAt = nowISO();
      if(extra.meta){
        s.cases[caseKey].meta = { ...(s.cases[caseKey].meta || {}), ...extra.meta };
      }
    }

    return s.cases[caseKey];
  }

  // ───────────────────────── PUBLIC API ─────────────────────────

  window.TSMMemory = {

    get(){
      return ensureSector();
    },

    /**
     * Cross-module read: RCM OS's Executive tab (and any other rollup
     * view) needs to see anomalies registered by EVERY vertical, not just
     * whatever sector the current page happens to be on. get()/ensureSector()
     * intentionally stay page-scoped for everything else in this engine —
     * this is the one deliberately cross-sector read.
     *
     * Re-reads localStorage fresh (not the module-level `mem` cache) because
     * each vertical runs in its own page/tab; another tab's writes since
     * this page loaded would otherwise be invisible here.
     *
     * @param {Object} opts
     * @param {string[]} [opts.sectors] - restrict to these sector keys (default: all)
     * @param {string}   [opts.status]  - 'open' | 'resolved' | null for all (default: 'open')
     * @returns {Array} anomaly records, each tagged with its source `sector`,
     *                   sorted by severity (CRITICAL first) then recency.
     */
    getCrossModuleAnomalies({ sectors = null, status = "open" } = {}){
      const SEV_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
      let all;
      try {
        all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      } catch(e) {
        return [];
      }

      const out = [];
      Object.keys(all).forEach(sectorKey => {
        if(sectors && !sectors.includes(sectorKey)) return;
        const sectorData = all[sectorKey];
        if(!sectorData || !Array.isArray(sectorData.anomalies)) return;

        sectorData.anomalies.forEach(a => {
          if(status && a.status !== status) return;
          out.push({ ...a, sector: sectorKey });
        });
      });

      out.sort((a, b) => {
        const sevDiff = (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0);
        if(sevDiff !== 0) return sevDiff;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      return out;
    },

    getCase(entityType, entityId){
      const s = ensureSector();
      return s.cases[getCaseKey(entityType, entityId)] || null;
    },

    timeline(msg, meta = {}){
      const s = ensureSector();

      s.timeline.unshift({ at:new Date().toLocaleTimeString(), iso:nowISO(), message:msg, meta });
      s.timeline = s.timeline.slice(0, 50);

      saveMemory(mem);
      renderTimeline();
    },

    exposure(val){
      const s = ensureSector();
      s.exposure = val;
      saveMemory(mem);
      renderState();
    },

    strategist(val){
      const s = ensureSector();
      s.strategist = val;
      saveMemory(mem);
      renderState();
    },

    owner(val){
      const s = ensureSector();
      s.owners.unshift({ at:new Date().toLocaleTimeString(), iso:nowISO(), owner:val });
      s.owners = s.owners.slice(0, 25);
      saveMemory(mem);
      renderOwners();
    },

    narrative(val){
      const s = ensureSector();
      s.narrative = val;
      saveMemory(mem);
      renderNarrative();
    },

    relay(val, meta = {}){
      const s = ensureSector();

      s.relays.unshift({ at:new Date().toLocaleTimeString(), iso:nowISO(), relay:val, meta });
      s.relays = s.relays.slice(0, 30);
      s.stats.relayCount = (s.stats.relayCount || 0) + 1;

      saveMemory(mem);
      renderRelays();
    },

    /**
     * Registers a detected anomaly against a case. If TSMSectorIntelligence
     * is loaded and the caller didn't supply severity/owner, the playbook
     * for this sector + anomalyCode is used to fill them in.
     */
    registerAnomaly({
      entityType = "case",
      entityId = "UNKNOWN",
      anomalyCode,
      title,
      severity,
      missingFields = [],
      source = "war-room",
      detectedFrom = null,
      meta = {}
    } = {}){
      if(!anomalyCode) return null;

      const s = ensureSector();
      const caseRef = ensureCase(entityType, entityId, { meta });

      const SI = window.TSMSectorIntelligence;
      const rule = SI && typeof SI.getRule === "function" ? SI.getRule(sector, anomalyCode) : null;

      const record = {
        id: `an_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        anomalyCode,
        title: title || rule?.label || anomalyCode,
        severity: severity || rule?.pressure || "MEDIUM",
        status: "open",
        source,
        detectedFrom,
        entityType,
        entityId,
        missingFields: [...missingFields],
        createdAt: nowISO(),
        resolvedAt: null,
        resolvedBy: null,
        relayTargets: rule?.relayTargets || [],
        recommendedApps: rule?.recommendedApps || [],
        meta
      };

      s.anomalies.unshift(record);
      s.anomalies = s.anomalies.slice(0, 250);

      caseRef.anomalies.unshift({
        anomalyId: record.id,
        anomalyCode,
        title: record.title,
        severity: record.severity,
        status: "open",
        createdAt: record.createdAt
      });

      s.stats.anomaliesDetected = (s.stats.anomaliesDetected || 0) + 1;
      saveMemory(mem);

      window.TSMMemory.timeline(
        `Anomaly detected: ${record.title}${missingFields.length ? " | Missing: " + missingFields.join(", ") : ""}`,
        { anomalyCode, entityType, entityId }
      );

      renderAnomalies();
      return record;
    },

    rememberField({
      entityType = "case",
      entityId = "UNKNOWN",
      field,
      value,
      source = "manual",
      confidence = 1,
      anomalyCode = null,
      meta = {}
    } = {}){
      if(!field || value === undefined || value === null || value === "") return null;

      const s = ensureSector();
      const caseRef = ensureCase(entityType, entityId, { meta });
      const key = makeFieldKey(entityType, entityId, field);

      const payload = { value, source, confidence, updatedAt: nowISO(), anomalyCode, meta };

      s.fieldMemory[key] = payload;
      caseRef.fields[field] = payload;

      saveMemory(mem);
      return payload;
    },

    lookupField({ entityType = "case", entityId = "UNKNOWN", field } = {}){
      if(!field) return null;

      const s = ensureSector();
      const key = makeFieldKey(entityType, entityId, field);
      const result = s.fieldMemory[key] || null;

      if(result){
        s.stats.autoPopulatedFields = (s.stats.autoPopulatedFields || 0) + 1;
        saveMemory(mem);
      }

      return result;
    },

    resolveAnomaly({
      anomalyId = null,
      anomalyCode = null,
      entityType = "case",
      entityId = "UNKNOWN",
      resolvedBy = "unknown",
      values = {},
      status = "resolved",
      relay = null
    } = {}){
      const s = ensureSector();
      const caseRef = ensureCase(entityType, entityId);

      let target = null;
      if(anomalyId){
        target = s.anomalies.find(a => a.id === anomalyId) || null;
      } else if(anomalyCode){
        target = s.anomalies.find(a => a.anomalyCode === anomalyCode && a.status !== "resolved") || null;
      }

      if(target){
        target.status = status;
        target.resolvedAt = nowISO();
        target.resolvedBy = resolvedBy;
      }

      caseRef.anomalies = (caseRef.anomalies || []).map(a => {
        if((anomalyId && a.anomalyId === anomalyId) || (!anomalyId && anomalyCode && a.anomalyCode === anomalyCode)){
          return { ...a, status, resolvedBy, resolvedAt: nowISO() };
        }
        return a;
      });

      Object.entries(values || {}).forEach(([field, value]) => {
        window.TSMMemory.rememberField({
          entityType, entityId, field, value,
          source: resolvedBy, confidence: 0.95,
          anomalyCode: target?.anomalyCode || anomalyCode
        });
      });

      s.stats.anomaliesResolved = (s.stats.anomaliesResolved || 0) + 1;
      saveMemory(mem);

      window.TSMMemory.timeline(
        `Anomaly resolved: ${(target?.title || anomalyCode || "unknown")} by ${resolvedBy}`,
        { anomalyId, anomalyCode, entityType, entityId }
      );

      if(relay){
        window.TSMMemory.relay(relay, {
          anomalyId: target?.id || anomalyId || null,
          anomalyCode: target?.anomalyCode || anomalyCode || null,
          entityType, entityId
        });
      }

      renderAnomalies();
      return target;
    },

    /**
     * Bridges into TSMSectorIntelligence's real playbook API (buildCaseTemplate),
     * merges in anything already known about this entity from field memory, and
     * attaches cross-upload insight so the caller knows what's been learned from
     * every prior upload that hit this same anomaly type.
     */
    getSuggestedAppPayload({
      sectorName = sector,
      anomalyCode,
      entityType = "case",
      entityId = "UNKNOWN",
      payload = {}
    } = {}){
      if(!anomalyCode) return null;

      const SI = window.TSMSectorIntelligence;
      const template = SI && typeof SI.buildCaseTemplate === "function"
        ? SI.buildCaseTemplate(sectorName, anomalyCode, payload)
        : null;

      const requiredFields = template?.requiredFields || [];
      const recoveredFields = {};
      const missingStill = [];

      requiredFields.forEach(field => {
        const remembered = window.TSMMemory.lookupField({ entityType, entityId, field });
        if(remembered && remembered.value !== undefined && remembered.value !== null && remembered.value !== ""){
          recoveredFields[field] = remembered.value;
        } else {
          missingStill.push(field);
        }
      });

      return {
        anomalyCode,
        label: template?.label || anomalyCode,
        owner: template?.owner || null,
        pressure: template?.pressure || "MEDIUM",
        exposure: template?.exposure || 0,
        recommendedApps: template?.appConfigs || [],
        recommendedActions: template?.recommendedActions || [],
        bestAction: template?.bestAction || null,
        relayTargets: template?.relayTargets || [],
        executiveSummary: template?.executiveSummary || "",
        requiredFields,
        recoveredFields,
        missingStill,
        autoPopulateReady: Object.keys(recoveredFields).length > 0,
        crossUploadInsight: window.TSMMemory.getCrossUploadInsight({ sectorName, anomalyCode, entityType, entityId })
      };
    },

    /**
     * "What do we already know from previous uploads that can fix this faster?"
     * Looks across every case this sector has ever seen for the same anomaly
     * code and surfaces: how many times it's happened, who's resolved it
     * before, and a best-guess prefill built from the most recent value
     * remembered for each field — regardless of which case it came from.
     */
    getCrossUploadInsight({ sectorName = sector, anomalyCode, entityType = "case", entityId = null } = {}){
      const s = sectorName === sector ? ensureSector() : (mem[sectorName] || null);

      if(!s || !anomalyCode){
        return { priorOccurrences:0, resolvedCount:0, suggestedPrefill:{}, relatedCases:[], repeatEntity:false };
      }

      const matches = (s.anomalies || []).filter(a => a.anomalyCode === anomalyCode);
      const resolved = matches.filter(a => a.status === "resolved");

      const repeatEntity = !!(entityId && matches.some(a =>
        a.entityType === entityType && a.entityId === entityId && a.id
      ) && matches.filter(a => a.entityType === entityType && a.entityId === entityId).length > 1);

      // Most recent known value per field across every case that ever hit this anomaly code.
      const prefillRecords = {};
      Object.entries(s.fieldMemory || {}).forEach(([key, rec]) => {
        if(rec.anomalyCode !== anomalyCode) return;
        const field = key.split(":").pop();
        if(!prefillRecords[field] || new Date(rec.updatedAt) > new Date(prefillRecords[field].updatedAt)){
          prefillRecords[field] = rec;
        }
      });

      const relatedCases = matches.slice(0, 5).map(a => ({
        id: a.id,
        title: a.title,
        status: a.status,
        entityId: a.entityId,
        createdAt: a.createdAt,
        resolvedAt: a.resolvedAt,
        resolvedBy: a.resolvedBy
      }));

      return {
        priorOccurrences: matches.length,
        resolvedCount: resolved.length,
        lastResolvedAt: resolved[0]?.resolvedAt || null,
        lastResolvedBy: resolved[0]?.resolvedBy || null,
        repeatEntity,
        suggestedPrefill: Object.fromEntries(Object.entries(prefillRecords).map(([k,v]) => [k, v.value])),
        relatedCases
      };
    },

    queueExecutiveRelay({
      type = "strategist",
      title,
      summary,
      sectorName = sector,
      anomalyCode = null,
      entityType = "case",
      entityId = "UNKNOWN",
      exposure = null,
      owner = null
    } = {}){
      const s = ensureSector();

      const item = {
        id: `relay_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
        type,
        title: title || "Executive relay",
        summary: summary || "",
        sector: sectorName,
        anomalyCode, entityType, entityId, exposure, owner,
        createdAt: nowISO(),
        status: "queued"
      };

      s.executiveQueue.unshift(item);
      s.executiveQueue = s.executiveQueue.slice(0, 100);
      saveMemory(mem);

      window.TSMMemory.relay(
        `${type.toUpperCase()} relay queued${title ? ": " + title : ""}`,
        { anomalyCode, entityType, entityId, exposure, owner }
      );

      return item;
    },

    // Portals were flipping the on-screen badge/button to "approved" without
    // ever writing the status back here, so a reload (or any re-render off
    // TSMMemory.get()) silently reverted the item to "queued" -- same dead-end
    // shape as the BPO case-approval bug. Keyed by the item's stable `id`
    // rather than array index, since callers usually render a sliced subset.
    updateExecutiveQueueStatus(id, status){
      const s = ensureSector();
      const item = (s.executiveQueue || []).find(q => q.id === id);
      if(!item) return null;

      item.status = status;
      item.statusUpdatedAt = nowISO();
      saveMemory(mem);

      return item;
    }
  };

  // ───────────────────────── UI ─────────────────────────

  function css(){
    if(document.getElementById("tsm-memory-css")) return;

    const st=document.createElement("style");
    st.id="tsm-memory-css";

    st.textContent=`
      #tsm-memory-tab{
        position:fixed;right:18px;bottom:18px;z-index:600;
        background:#00ffc6;color:#001;font-weight:900;font-size:11px;
        letter-spacing:.08em;padding:10px 16px;border-radius:999px;cursor:pointer;
        box-shadow:0 4px 18px rgba(0,255,198,.35);font-family:Inter,system-ui;
        border:0;
      }
      .tsm-memory-layer{
        position:fixed;right:18px;bottom:66px;width:400px;max-height:72vh;overflow-y:auto;
        padding:16px;background:rgba(5,12,20,.97);border:1px solid rgba(0,255,198,.14);
        border-radius:16px;color:#dff7ff;font-family:Inter,system-ui;z-index:599;
        box-shadow:0 12px 40px rgba(0,0,0,.5);opacity:0;
        transform:translateY(16px) scale(.97);pointer-events:none;
        transition:opacity .18s ease, transform .18s ease;
      }
      .tsm-memory-layer.open{ opacity:1;transform:translateY(0) scale(1);pointer-events:auto; }
      .tsm-memory-layer h2{ color:#00ffc6;margin:0 0 2px;font-size:14px; }
      .tsm-memory-layer .tsm-mem-sub{ color:#7c9aaa;font-size:10px;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px; }
      .memory-grid{ display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-top:8px; }
      .memory-card{ background:#07131d;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px; }
      .memory-card small{ display:block;color:#7c9aaa;letter-spacing:.1em;text-transform:uppercase;font-size:9px; }
      .memory-card b{ display:block;color:#00ffc6;margin-top:6px;font-size:15px; }
      .memory-actions{ display:flex;gap:8px;flex-wrap:wrap;margin:12px 0; }
      .memory-actions button{ border:0;border-radius:999px;padding:7px 12px;font-size:10.5px;background:#00ffc6;color:#001;font-weight:900;cursor:pointer; }
      .memory-actions button.alt{ background:#0b1722;color:#dff7ff;border:1px solid rgba(255,255,255,.15); }
      .memory-panel{ margin-top:10px;background:#020913;border-left:3px solid #00ffc6;border-radius:10px;padding:12px;white-space:pre-wrap;line-height:1.5;font-size:12.5px; }
      .memory-section-label{ margin-top:14px;color:#7c9aaa;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase; }
      .memory-timeline{ margin-top:6px;background:#031019;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;max-height:140px;overflow:auto;font-size:12px; }
      .memory-event{ border-bottom:1px solid rgba(255,255,255,.05);padding:7px 0;color:#cbe3ef; }
      .memory-event:last-child{ border-bottom:0; }
      .memory-event b{ color:#00ffc6; }
      .memory-anomaly{ border-bottom:1px solid rgba(255,255,255,.05);padding:8px 0;color:#cbe3ef; }
      .memory-anomaly:last-child{ border-bottom:0; }
      .memory-anomaly .ma-title{ color:#dff7ff;font-weight:700;font-size:12px; }
      .memory-anomaly .ma-meta{ color:#7c9aaa;font-size:10.5px;margin-top:2px; }
      .memory-anomaly .ma-insight{ color:#00ffc6;font-size:10.5px;margin-top:3px; }
      .ma-badge{ display:inline-block;border-radius:999px;padding:2px 7px;font-size:9px;font-weight:900;letter-spacing:.06em;margin-right:6px; }
      .ma-badge.open{ background:rgba(245,166,35,.18);color:#f5a623; }
      .ma-badge.resolved{ background:rgba(0,255,198,.15);color:#00ffc6; }
    `;

    document.head.appendChild(st);
  }

  function build(){
    css();
    if(document.getElementById("tsm-memory-tab")) return;

    const tab = document.createElement("button");
    tab.id = "tsm-memory-tab";
    tab.type = "button";
    tab.textContent = "🧠 MEMORY";
    tab.onclick = toggleMemoryLayer;

    const layer = document.createElement("div");
    layer.className = "tsm-memory-layer";
    layer.id = "tsmMemoryLayer";
    layer.innerHTML = `
      <h2>TSM Operational Memory</h2>
      <div class="tsm-mem-sub">${sector.toUpperCase()} · CROSS-UPLOAD INTELLIGENCE</div>

      <div class="memory-grid">
        <div class="memory-card"><small>Exposure</small><b id="tsmMemoryExposure"></b></div>
        <div class="memory-card"><small>Strategist Pressure</small><b id="tsmMemoryStrategist"></b></div>
      </div>

      <div class="memory-panel" id="tsmMemoryNarrative"></div>

      <div class="memory-actions">
        <button onclick="window.TSMMemory.timeline('Manual check-in logged')">Log Check-in</button>
        <button class="alt" onclick="window.TSMMemory.timeline('Operator reviewed memory state')">Mark Reviewed</button>
      </div>

      <div class="memory-section-label">Anomaly Memory (What We Already Know)</div>
      <div class="memory-timeline" id="tsmMemoryAnomalies"></div>

      <div class="memory-section-label">Recent Timeline</div>
      <div class="memory-timeline" id="tsmMemoryTimeline"></div>

      <div class="memory-section-label">Ownership Log</div>
      <div class="memory-timeline" id="tsmMemoryOwners"></div>

      <div class="memory-section-label">Relay Log</div>
      <div class="memory-timeline" id="tsmMemoryRelays"></div>
    `;

    document.body.appendChild(tab);
    document.body.appendChild(layer);

    renderState();
    renderNarrative();
    renderTimeline();
    renderOwners();
    renderRelays();
    renderAnomalies();
  }

  function toggleMemoryLayer(){
    const layer = document.getElementById("tsmMemoryLayer");
    if(layer) layer.classList.toggle("open");
  }

  function renderState(){
    const m = ensureSector();
    const exp=document.getElementById("tsmMemoryExposure");
    const strat=document.getElementById("tsmMemoryStrategist");
    if(exp) exp.textContent = m.exposure;
    if(strat) strat.textContent = m.strategist;
  }

  function renderNarrative(){
    const el=document.getElementById("tsmMemoryNarrative");
    if(!el) return;
    const m=ensureSector();
    el.textContent =
`PERSISTENT OPERATIONAL MEMORY · ${sector.toUpperCase()}

CURRENT EXPOSURE
${m.exposure}

STRATEGIST PRESSURE
${m.strategist}

EXECUTIVE CONTINUITY
${m.narrative}

CROSS-UPLOAD LEARNING
${m.stats.anomaliesDetected || 0} anomalies detected · ${m.stats.anomaliesResolved || 0} resolved · ${m.stats.autoPopulatedFields || 0} fields auto-recovered from memory.`;
  }

  function renderTimeline(){
    const wrap=document.getElementById("tsmMemoryTimeline");
    if(!wrap) return;
    const items=ensureSector().timeline || [];
    wrap.innerHTML = items.length
      ? items.map(x=>`<div class="memory-event"><b>${x.at}</b><br>${x.message}</div>`).join("")
      : `<div class="memory-event" style="color:#7c9aaa">No timeline activity yet.</div>`;
  }

  function renderOwners(){
    const el=document.getElementById("tsmMemoryOwners");
    if(!el) return;
    const owners = ensureSector().owners || [];
    el.innerHTML = owners.length
      ? owners.map(x=>`<div class="memory-event"><b>${x.at}</b><br>${x.owner}</div>`).join("")
      : `<div class="memory-event" style="color:#7c9aaa">No ownership changes logged.</div>`;
  }

  function renderRelays(){
    const el=document.getElementById("tsmMemoryRelays");
    if(!el) return;
    const relays = ensureSector().relays || [];
    el.innerHTML = relays.length
      ? relays.map(x=>`<div class="memory-event"><b>${x.at}</b><br>${x.relay}</div>`).join("")
      : `<div class="memory-event" style="color:#7c9aaa">No relays logged.</div>`;
  }

  function renderAnomalies(){
    const el=document.getElementById("tsmMemoryAnomalies");
    if(!el) return;
    const s = ensureSector();
    const anomalies = s.anomalies || [];

    if(!anomalies.length){
      el.innerHTML = `<div class="memory-anomaly" style="color:#7c9aaa">No anomalies recorded yet for this sector.</div>`;
      return;
    }

    el.innerHTML = anomalies.slice(0, 12).map(a => {
      const insight = window.TSMMemory.getCrossUploadInsight({ anomalyCode: a.anomalyCode, entityType:a.entityType, entityId:a.entityId });
      const seenBefore = insight.priorOccurrences > 1
        ? `💡 Seen ${insight.priorOccurrences}x before${insight.lastResolvedBy ? " · last resolved by " + insight.lastResolvedBy : ""}`
        : "";

      return `
        <div class="memory-anomaly">
          <span class="ma-badge ${a.status === 'resolved' ? 'resolved' : 'open'}">${a.status.toUpperCase()}</span>
          <span class="ma-title">${a.title}</span>
          <div class="ma-meta">${a.entityId} · ${a.severity} · ${a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</div>
          ${seenBefore ? `<div class="ma-insight">${seenBefore}</div>` : ''}
        </div>
      `;
    }).join("");
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }

})();
