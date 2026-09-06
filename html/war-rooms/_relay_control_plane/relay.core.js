/**
 * TSM Relay Core (Runtime Enforcement + Audit Log)
 * Single write path for all war-room relay traffic.
 * Consolidates the three legacy control-plane scripts into one.
 */
(function (global) {
  const RELAY_REGISTRY = {
  CRM: "TSM_CRM_RELAY",
  CPQ: "TSM_CPQ_RELAY",
  BPO: "TSM_BPO_RELAY",
  O2C: "TSM_O2C_RELAY",
  MDM: "TSM_MDM_RELAY",
  APPROVAL: "TSM_APPROVAL_RELAY",
  CATALOG: "TSM_CATALOG_RELAY",
  GOVERNANCE: "TSM_GOVERNANCE_RELAY",
  DIGITAL_TWIN: "TSM_DIGITAL_TWIN_RELAY",
  HONEYWELL_CYBER:    "TSM_HONEYWELL_CYBER_RELAY",
  HONEYWELL_SUPPLIER: "TSM_HONEYWELL_SUPPLIER_RELAY",
  HONEYWELL_PLANT:    "TSM_HONEYWELL_PLANT_RELAY",
  // College vertical (Financial-Aid-centered) — same split-key pattern as the
  // three HONEYWELL_* domains above: each domain writes only its own key,
  // college-strategist.html reads all five and aggregates rather than
  // picking a single "latest" (Financial Aid ops needs simultaneous
  // visibility across domains, unlike Honeywell's one-incident-at-a-time use).
  COLLEGE_FINAID:      "TSM_COLLEGE_FINAID_RELAY",
  COLLEGE_BURSAR:      "TSM_COLLEGE_BURSAR_RELAY",
  COLLEGE_ENDOWMENT:   "TSM_COLLEGE_ENDOWMENT_RELAY",
  COLLEGE_RESEARCH_FA: "TSM_COLLEGE_RESEARCH_FA_RELAY",
  COLLEGE_ACCRED:      "TSM_COLLEGE_ACCRED_RELAY",
  // Insurance Command suite (2026-09-06) — 4 domains with real backend
  // wiring (routes/insurance-*-financial.js), same split-key pattern as
  // the COLLEGE_* domains above: each domain writes only its own key,
  // insurance-command-executive-portal.html reads all four and aggregates
  // rather than picking a single "latest". Distinct from the pre-existing
  // INSURANCE key below (ins-war-room -> insurance-strategist.html pipeline).
  INSURANCE_CLAIMS:     "TSM_INSURANCE_CLAIMS_RELAY",
  INSURANCE_PC:         "TSM_INSURANCE_PC_RELAY",
  INSURANCE_COMPLIANCE: "TSM_INSURANCE_COMPLIANCE_RELAY",
  INSURANCE_LICENSING:  "TSM_INSURANCE_LICENSING_RELAY",
  INTEGRATION: "TSM_INTEGRATION_HUB_RELAY",
  NOC: "TSM_NOC_RELAY",
  MORTGAGE: "TSM_MORTGAGE_RELAY",
  SCHOOLS: "TSM_SCHOOLS_RELAY",
  VMWARE_COPILOT: "TSM_VMWARE_COPILOT_RELAY",
  CLOUD_COPILOT: "TSM_CLOUD_COPILOT_RELAY",
  L1COPILOT: "TSM_L1_COPILOT_RELAY",
  FIX_VALIDATED_FROM_CC: "TSM_FIX_VALIDATED_FROM_CC_RELAY",
  CONSTRUCTION: "TSM_CONSTRUCTION_RELAY",
  FINOPS:       "TSM_FINOPS_RELAY",
  HEALTHCARE:   "TSM_HEALTHCARE_RELAY",
  LEGAL:        "TSM_LEGAL_RELAY",
  REALESTATE:   "TSM_REALESTATE_RELAY",
  INSURANCE:    "TSM_INSURANCE_RELAY",
  MISSION:      "TSM_MISSION_RELAY",
  LOGISTICS:    "TSM_LOGISTICS_WAR_RELAY",
  VENDOR:       "TSM_VENDOR_WAR_RELAY",
  HOTELOPS:     "TSM_HOTELOPS_STRATEGIST_RELAY",
  PM:           "TSM_PM_RELAY",
  CONCIERGE:    "TSM_CONCIERGE_RELAY",
  // TSM FIX: evidence-ledger.js (html/shared/runtime/trust-evidence/) calls
  // TSM.relay.write('TRUST_EVIDENCE', ...) on every record() so other tabs
  // can pick up new decision-evidence entries via the same storage-event
  // pattern used elsewhere -- but this domain was never registered, so
  // every single call threw "Unknown relay domain: TRUST_EVIDENCE" and got
  // swallowed by the caller's try/catch. The record itself always
  // persisted fine (it has its own dedicated localStorage store); this was
  // only breaking the cross-tab broadcast.
  TRUST_EVIDENCE: "TSM_TRUST_EVIDENCE_RELAY"
};
  const EVENT_LOG_KEY = "TSM_EVENT_LOG";
  const EVENT_LOG_MAX = 500;

  function now() { return new Date().toISOString(); }

  function appendEvent(domain, caseId, stage) {
    let log = [];
    try { log = JSON.parse(localStorage.getItem(EVENT_LOG_KEY) || "[]"); } catch (e) { log = []; }
    log.push({ ts: now(), domain, key: stage, id: caseId });
    if (log.length > EVENT_LOG_MAX) log = log.slice(log.length - EVENT_LOG_MAX);
    try { localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(log)); } catch (e) {}
  }

  function write(domain, payload, options) {
    const storageKey = RELAY_REGISTRY[domain];
    if (!storageKey) throw new Error("Unknown relay domain: " + domain);
    if (!payload) throw new Error("Relay payload missing for " + domain);

    options = options || {};
    payload.timestamp = payload.timestamp || now();
    payload.id = payload.id || Math.random().toString(36).slice(2);

    const json = JSON.stringify(payload);
    localStorage.setItem(storageKey, json);
    sessionStorage.setItem(storageKey, json);

    // Process-mining event log: real hops only exist if the caller supplies a
    // stable caseId that persists across a case's stages, plus a stage label
    // distinct from the domain's fixed storage key. Callers that omit options
    // keep today's behavior (random id, key=storageKey) — no hops, no change.
    const caseId = options.caseId || payload.id;
    const stage = options.stage || storageKey;
    appendEvent(domain, caseId, stage);

    try {
      global.dispatchEvent(new CustomEvent("TSM_RELAY_EVENT", { detail: { domain, payload } }));
    } catch (e) {}

    return payload;
  }

  function read(domain) {
    const key = RELAY_REGISTRY[domain];
    if (!key) return null;
    try {
      return JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || "null");
    } catch (e) { return null; }
  }

  function eventLog() {
    try { return JSON.parse(localStorage.getItem(EVENT_LOG_KEY) || "[]"); } catch (e) { return []; }
  }

  global.TSM = global.TSM || {};
  global.TSM.relay = { write, read, eventLog, domains: Object.keys(RELAY_REGISTRY) };

  console.log("[TSM RELAY CORE] Active");
})(window);