/**
 * TSM Universal Guide Engine
 * Automatically detects Vertical (RE, Concierge, Legal, Construction, Healthcare, 
 * Mortgage, Schools, FinOps, Insurance, NOC, Honeywell, Plant Incident, Cyber Incident, 
 * Supplier Shutdown) and Page Role (War Room, Strategist, Exec Portal) to render dynamic step trackers.
 */
(function () {
  // 1. Detect Context from DOM attributes or URL path fallbacks
  function detectContext() {
    const body = document.body;
    const path = window.location.pathname.toLowerCase();

    // Determine specific App (page-level override). When a page has been
    // hand-verified (real DOM ids/functions read from source, not guessed),
    // it gets its own entry in APP_CONFIGS/APP_STATE_CHECKERS and that takes
    // priority over the generic vertical/role config below — those generic
    // configs describe a DIFFERENT page's fields and won't match this one.
    let app = null;
    if (path.includes("finops-accounting")) app = "finops-accounting";
    else if (path.includes("finops-operations")) app = "finops-operations";
    else if (path.includes("hc-denial-war-room")) app = "hc-denial-war-room";
    else if (path.includes("l1-ticket-copilot")) app = "l1-ticket-copilot";

    // Determine Vertical
    let vertical = body.getAttribute("data-vertical");
    if (!vertical) {
      if (path.includes("concierge") || path.includes("hotel")) vertical = "concierge";
      else if (path.includes("legal") || path.includes("law")) vertical = "legal";
      else if (path.includes("construction") || path.includes("build")) vertical = "construction";
      else if (path.includes("healthcare") || path.includes("health") || path.includes("dpm")) vertical = "healthcare";
      else if (path.includes("mortgage") || path.includes("loan")) vertical = "mortgage";
      else if (path.includes("school") || path.includes("edu")) vertical = "schools";
      else if (path.includes("finops") || path.includes("finance")) vertical = "finops";
      else if (path.includes("insurance") || path.includes("claims")) vertical = "insurance";
      else if (path.includes("noc") || path.includes("network")) vertical = "noc";
      else if (path.includes("honeywell") || path.includes("hw-")) vertical = "honeywell";
      else if (path.includes("plant-incident")) vertical = "plant-incident";
      else if (path.includes("cyber-incident")) vertical = "cyber-incident";
      else if (path.includes("supplier-shutdown")) vertical = "supplier-shutdown";
      else vertical = "re"; // Default fallback
    }

    // Determine Page Role
    let role = body.getAttribute("data-page-role");
    if (!role) {
      if (path.includes("exec") || path.includes("board") || path.includes("portal")) role = "exec";
      else if (path.includes("strategist") || path.includes("strategy")) role = "strategist";
      else role = "warroom";
    }

    return { vertical, role, app };
  }

  // 1a. Cross-page continuity — this is what lets the guide widget act as
  // one continuous AI Guide instead of resetting every time the user is
  // routed to a different vertical's app to cure an anomaly.
  //
  // Two sources, checked in priority order on every page load:
  //   1. tsm_active_mission — written by TSMMissionConductor (js/tsm-mission-conductor.js)
  //      when it's loaded and the user explicitly generates an AI mission plan.
  //      Real AI-tailored steps (title/instruction/fieldHint) for THIS anomaly.
  //   2. tsm_guide_relay — written by this file's own click-capture below,
  //      unconditionally, on every page that loads tsm-guide-engine.js. This
  //      is the fallback that guarantees continuity even on pages where
  //      TSMMissionConductor isn't loaded (e.g. hc-denial-war-room.html today —
  //      its LAUNCH links call window.TSMCureConductor, which is undefined
  //      there, so nothing currently survives the navigation without this).
  const RELAY_KEY = 'tsm_guide_relay';
  const MISSION_KEY = 'tsm_active_mission';
  const CONTINUITY_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

  // Does a stored target URL correspond to the page we're on right now?
  // Compares filenames rather than full paths since stored URLs are
  // sometimes absolute, sometimes relative, sometimes with a query string.
  function urlMatchesCurrentPage(url) {
    if (!url) return false;
    try {
      const targetFile = url.split('/').pop().split('?')[0].split('#')[0].toLowerCase();
      const currentFile = location.pathname.split('/').pop().toLowerCase();
      return !!targetFile && targetFile === currentFile;
    } catch (e) { return false; }
  }

  function readActiveMission() {
    try {
      const raw = localStorage.getItem(MISSION_KEY);
      if (!raw) return null;
      const m = JSON.parse(raw);
      if (!m || !m.generatedAt || !Array.isArray(m.steps) || !m.steps.length) return null;
      if (Date.now() - new Date(m.generatedAt).getTime() > CONTINUITY_MAX_AGE_MS) return null;
      if (!urlMatchesCurrentPage(m.targetUrl)) return null;
      return m;
    } catch (e) { return null; }
  }

  function readRelay() {
    try {
      const raw = localStorage.getItem(RELAY_KEY);
      if (!raw) return null;
      const r = JSON.parse(raw);
      if (!r || !r.ts) return null;
      if (Date.now() - r.ts > CONTINUITY_MAX_AGE_MS) return null;
      if (!urlMatchesCurrentPage(r.targetUrl)) return null;
      return r;
    } catch (e) { return null; }
  }

  function clearContinuity() {
    try { localStorage.removeItem(RELAY_KEY); } catch (e) { /* noop */ }
    try { localStorage.removeItem(MISSION_KEY); } catch (e) { /* noop */ }
  }

  // Fires on EVERY page that loads this script, regardless of vertical.
  // Whenever the user clicks something that looks like "go cure this
  // elsewhere" (a LAUNCH/OPEN link to another .html app), snapshot what we
  // can see on screen right now — vertical, source app, whatever document
  // text is loaded, and the specific howTo hint if the click came from a
  // recommendation card — so the destination page's guide can pick it up.
  function captureRelayOnClick() {
    document.addEventListener('click', function (e) {
      const el = e.target.closest('a, button');
      if (!el) return;
      const text = (el.textContent || '').toUpperCase();
      if (!/\b(LAUNCH|OPEN)\b/.test(text)) return;

      let url = el.getAttribute('href') || '';
      if (!url || url === '#') {
        const onclickAttr = el.getAttribute('onclick') || '';
        const m = onclickAttr.match(/['"]([^'"]*\.html[^'"]*)['"]/);
        if (m) url = m[1];
      }
      if (!url || url === '#' || !/\.html/i.test(url)) return;
      if (urlMatchesCurrentPage(url)) return; // not actually leaving this app

      const card = el.closest('[data-app-name], .app-card, .rec-card, [class*="app-card"]');
      const appName = (card && card.dataset && card.dataset.appName) ||
        text.replace(/LAUNCH|OPEN|→/gi, '').trim() || 'App';
      const howTo = (card && card.dataset && card.dataset.appHowto) || '';

      const ctx = detectContext();
      const docEl = document.querySelector(
        '#doc-text, #docPaste, textarea[id*="doc"], textarea[id*="paste"], textarea[id*="text"]'
      );
      const docSnippet = (docEl && docEl.value ? docEl.value.trim() : '').slice(0, 500);

      const relay = {
        sourceVertical: ctx.vertical,
        sourceUrl: location.pathname,
        targetApp: appName,
        targetUrl: url,
        howTo: howTo,
        docSnippet: docSnippet,
        ts: Date.now()
      };
      try { localStorage.setItem(RELAY_KEY, JSON.stringify(relay)); } catch (err) { /* noop */ }
    }, true);
  }

  // Build the small "continuing from..." banner shown above the step list.
  function buildContinuityBanner(mission, relay) {
    if (mission) {
      const summary = mission.anomalySummary ? ' — ' + mission.anomalySummary : '';
      return {
        label: 'REMEDIATING: ' + (mission.anomalyType || mission.targetApp || 'Issue'),
        detail: summary.replace(/^ — /, '')
      };
    }
    if (relay) {
      return {
        label: 'Continuing from ' + (relay.sourceVertical || 'another') + ' war room',
        detail: relay.howTo || (relay.docSnippet ? relay.docSnippet.slice(0, 140) + '…' : '')
      };
    }
    return null;
  }

  // 1b. App-specific handoff banner — a second, independent continuity
  // source alongside tsm_guide_relay/tsm_active_mission above. The
  // click-capture in captureRelayOnClick() only fires on LAUNCH/OPEN link
  // text, so it never sees the HC ESCALATE buttons (their text is
  // "ESCALATE TO HC MAIN STRATEGIST" / "ESCALATE / RELAY TO EXEC"), even
  // though those buttons DO ship a real payload (TSM_WAR_ROOM_BRIEF,
  // TSM_EXEC_RELAY). Rather than teach the click-guess more trigger words
  // (still a guess), this reads the actual payload the destination page's
  // own code already depends on, so the banner only ever reflects a
  // genuine handoff. Keep in sync with hc-denial-war-room.html's
  // dispatchSessionPayload() and hc-main-strategist.html's
  // escalateToExecPortal() if either payload shape changes.
  function readVerifiedAppHandoff(context) {
    try {
      if (context.vertical === 'healthcare' && context.role === 'strategist') {
        const raw = sessionStorage.getItem('TSM_WAR_ROOM_BRIEF');
        if (!raw) return null;
        const brief = JSON.parse(raw);
        if (!brief || !brief.timestamp) return null;
        if (Date.now() - new Date(brief.timestamp).getTime() > CONTINUITY_MAX_AGE_MS) return null;
        return {
          label: 'Continuing from HC Denial War Room',
          detail: 'Session ' + (brief.sessionId || '—') +
            (brief.documentMeta && brief.documentMeta.ingestType ? ' · ' + brief.documentMeta.ingestType : ''),
          noClear: true // TSM_WAR_ROOM_BRIEF is live data this page's own readWarRoomBrief() renders from — dismissing the banner must not delete it
        };
      }
      if (context.vertical === 'healthcare' && context.role === 'exec') {
        const raw = sessionStorage.getItem('TSM_EXEC_RELAY') || localStorage.getItem('TSM_EXEC_RELAY');
        if (!raw) return null;
        const relay = JSON.parse(raw);
        if (!relay || !relay.enriched || !relay.ts) return null;
        if (Date.now() - relay.ts > CONTINUITY_MAX_AGE_MS) return null;
        return {
          label: 'Continuing from HC Main Strategist',
          detail: relay.sessionId ? 'Session ' + relay.sessionId : '',
          noClear: true // TSM_EXEC_RELAY drives loadStratRelay() on this page — dismissing the banner must not delete it
        };
      }
    } catch (e) { /* noop */ }
    return null;
  }

  // When a fresh AI mission exists for this exact page, it becomes the
  // config outright (real AI-tailored steps take priority over the generic
  // template) and runs on the heuristic engine — these steps are dynamic
  // free text, there's no generic DOM signal to verify them against.
  function missionToConfig(mission) {
    return {
      title: 'GUIDE · ' + (mission.targetApp || 'MISSION').toUpperCase(),
      steps: mission.steps.map(function (s, i) {
        return { id: 'm' + i, label: s.title + (s.fieldHint ? ' — ' + s.fieldHint : '') };
      })
    };
  }


  // field-for-field, rather than the generic vertical template in
  // GUIDE_CONFIGS (which was written for a different page and doesn't
  // reflect what's actually on screen here).
  const APP_CONFIGS = {
    "finops-accounting": {
      title: "GUIDE · FINOPS ACCOUNTING DOCUMENT ANALYSIS",
      steps: [
        { id: "s1", label: "Pick a doc type (left panel) & fill its fields — e.g. Invoice #, PO #, Vendor" },
        { id: "s2", label: "Click FIRE ALL 4 ENGINES" },
        { id: "s3", label: "Review Triage, Variance, Action Plan & CFO Report" },
        { id: "s4", label: "Export the full report (⬇ Export All)" }
      ]
    },
    "hc-denial-war-room": {
      title: "GUIDE · HC DENIAL WAR ROOM",
      steps: [
        { id: "s1", label: "Paste or drop a denial letter, EOB, or clinical record on the left" },
        { id: "s2", label: "Click FIRE ALL 5 ENGINES" },
        { id: "s3", label: "Review the recommended app(s) to fix the issue" },
        { id: "s4", label: "Escalate to HC Main Strategist" }
      ]
    },
    // Verified against html/finops-suite/finops-operations.html. This page is
    // an 11-tab wealth-management back office (Cashiering, Service Requests,
    // Compliance, etc.), not the "ledger ingestion -> margin audit -> relay
    // to strategist" shape the generic finops.warroom fallback assumes — that
    // generic config's trigger words (LEDGER/MARGIN/STRATEGIST/RELAY) don't
    // match anything real on this page, so its step tracker never advanced.
    // These 4 steps use real button label text pulled from the page's own
    // Cashiering/Service Requests/Compliance tabs. Note: like most of this
    // page's demo actions, the underlying buttons are toast-only (no
    // persisted DOM/storage flag written on click) — so this uses the
    // click-text heuristic tracker (no APP_STATE_CHECKERS entry), same
    // honesty convention as the generic GUIDE_CONFIGS fallbacks elsewhere in
    // this file. Treat step-completion here as a rough hint, not a
    // guarantee, same as any other unverified page.
    "finops-operations": {
      title: "GUIDE · FINOPS OPERATIONS BACK OFFICE",
      steps: [
        { id: "s1", label: "Post or reconcile a transaction (Cashiering tab)", triggerText: ["POST TXN", "RECONCILE DAY"] },
        { id: "s2", label: "Run an AI Exception, Compliance, or Audit review", triggerText: ["AI EXCEPTION ANALYSIS", "AI COMPLIANCE REVIEW", "AI AUDIT ANALYSIS"] },
        { id: "s3", label: "Triage service requests or resolve a compliance flag", triggerText: ["ANALYZE", "PRIORITIZE", "MARK IN PROGRESS", "RESOLVE"] },
        { id: "s4", label: "Generate & export a report", triggerText: ["GENERATE REPORT", "EXPORT"] }
      ]
    },
    // Verified against html/l1-copilot/l1-ticket-copilot.html. Condensed from
    // the page's own "Working the Queue — Recommended Order" reference card
    // (Ticket -> AI Analysis -> Troubleshooting -> ... -> Resolution/Escalation).
    // Steps 3-9 in that card (Troubleshooting, the 5 specialist tabs, Vendor
    // Support, SLA, Notes) all feed the same real signal below — the
    // checklist being worked — since that's the one common, verifiable
    // action across that whole middle stretch; the specialist tabs and SLA
    // panel are reference/lookup surfaces with no single completion signal
    // of their own.
    "l1-ticket-copilot": {
      title: "GUIDE · L1 TICKET COPILOT",
      steps: [
        { id: "s1", label: "Paste the raw ticket description (Ticket tab)" },
        { id: "s2", label: "Run AI Analysis for confidence, severity & recommended path" },
        { id: "s3", label: "Work the Troubleshooting checklist in order" },
        { id: "s4", label: "Generate Resolution — or build an Escalation package" }
      ]
    }
  };

  // 2. Comprehensive Multi-Vertical Workflow Matrix
  const GUIDE_CONFIGS = {
    re: {
      warroom: {
        title: "GUIDE · RE WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Property / Loan Ingestion Data", triggerText: ["DOC SEARCH", "FILE SYSTEM", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Ingestion Module or Deal Rescue Pack", triggerText: ["MODULES", "DEAL RESCUE", "RUN"] },
          { id: "s3", label: "Save Ingested Analysis", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to RE Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · RE STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Verify Intake & Session Data", triggerText: ["MODULES", "DEAL RESCUE"] },
          { id: "s2", label: "Configure Strategy & Risk Parameters", triggerText: ["TOP RISK", "30-DAY ACTION", "QUICK STRATEGY"] },
          { id: "s3", label: "Generate Strategic Brief", triggerText: ["FULL STRATEGIC BRIEF", "GENERATE BRIEF"] },
          { id: "s4", label: "Escalate to Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · RE EXEC PORTAL SIGN-OFF",
        steps: [
          { id: "s1", label: "Select Deal Portfolio / Active Case", triggerText: ["DEAL", "PORTFOLIO", "SNAPSHOT"] },
          { id: "s2", label: "Generate Executive Brief", triggerText: ["GENERATE BRIEF", "BRIEF"] },
          { id: "s3", label: "Execute Sign-off / Override", triggerText: ["RESCUE", "SIGN-OFF", "APPROVE"] }
        ]
      }
    },
    concierge: {
      warroom: {
        title: "GUIDE · HOTELOPS WAR ROOM TELEMETRY",
        steps: [
          { id: "s1", label: "Load PMS / BMS Telemetry Data", triggerText: ["SAMPLE", "LOAD", "PMS", "TELEMETRY", "GUEST"] },
          { id: "s2", label: "Parse OTA & Maintenance Alerts", triggerText: ["PARSE", "OTA", "MAINTENANCE", "ALERTS", "RUN"] },
          { id: "s3", label: "Review IoT & Compliance Exposure", triggerText: ["GUEST INTELLIGENCE", "COMPLIANCE", "IOT", "EXPOSURE"] },
          { id: "s4", label: "Relay to HotelOps Strategist", triggerText: ["RELAY TO STRATEGIST", "STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · HOTELOPS STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit OTA Overcharges & SLAs", triggerText: ["OTA COMMISSION AUDIT", "SLA", "MAINTENANCE", "OVERCHARGE"] },
          { id: "s2", label: "Review AI Operations Analysis", triggerText: ["EXPLAINABILITY", "ANALYSIS", "OPERATIONS", "DELTA"] },
          { id: "s3", label: "Generate Dispatch & Dispute Packets", triggerText: ["GENERATE DISPATCH", "DISPUTE", "SAVE", "PACKET"] },
          { id: "s4", label: "Escalate to Executive View", triggerText: ["EXECUTIVE VIEW", "ESCALATE", "EXEC PORTAL"] }
        ]
      },
      exec: {
        title: "GUIDE · HOTELOPS EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Portfolio Occupancy & GOP", triggerText: ["HILTON", "MARRIOTT", "PORTFOLIO", "OCCUPANCY", "GOP"] },
          { id: "s2", label: "Audit Total Overcharge Exposure", triggerText: ["OTA EXPOSURE", "REVENUE RISK", "FINANCIAL DELTA"] },
          { id: "s3", label: "Approve Board Directives & Refunds", triggerText: ["APPROVE", "DISPUTE", "EXECUTE", "REFUND", "SIGN-OFF"] }
        ]
      }
    },
    legal: {
      warroom: {
        title: "GUIDE · LEGAL WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Case Files & Filings", triggerText: ["DOC SEARCH", "CASE DATA", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Municipal Residency / Factor Audit", triggerText: ["FACTOR", "AUDIT", "MODULES"] },
          { id: "s3", label: "Save Ingested Case Analysis", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Legal Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · LEGAL STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Verify Case Citations & Precedent", triggerText: ["CITATIONS", "PRECEDENT", "INTAKE"] },
          { id: "s2", label: "Configure Litigation Strategy", triggerText: ["MOTION", "SETTLEMENT", "RISK", "PARAM"] },
          { id: "s3", label: "Generate Defense Brief", triggerText: ["GENERATE BRIEF", "DEFENSE BRIEF"] },
          { id: "s4", label: "Escalate to Senior Partner Portal", triggerText: ["EXEC PORTAL", "ESCALATE", "PARTNER"] }
        ]
      },
      exec: {
        title: "GUIDE · LEGAL EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Firm Case Portfolio Risk", triggerText: ["PORTFOLIO", "FIRM RISK", "ACTIVE CASE"] },
          { id: "s2", label: "Audit Settlement Deltas", triggerText: ["IMPACT DELTA", "FINANCIAL EXPOSURE", "BRIEF"] },
          { id: "s3", label: "Authorize Litigation Spend & Motions", triggerText: ["AUTHORIZE", "APPROVE", "SIGN-OFF"] }
        ]
      }
    },
    construction: {
      warroom: {
        title: "GUIDE · CONSTRUCTION WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Site Inspection & Subcontract Logs", triggerText: ["SITE LOGS", "INSPECTION", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Permitting & Safety Overrun Audit", triggerText: ["PERMIT", "OVERRUN", "MODULES"] },
          { id: "s3", label: "Save Site Telemetry", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Construction Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · CONSTRUCTION STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Vendor Change Orders & SLAs", triggerText: ["CHANGE ORDER", "SLA", "VENDOR"] },
          { id: "s2", label: "Review Material Cost Overruns", triggerText: ["COST DELTA", "ANALYSIS", "OVERRUN"] },
          { id: "s3", label: "Generate Remediation Directives", triggerText: ["GENERATE DIRECTIVE", "SAVE", "PACKET"] },
          { id: "s4", label: "Escalate to Developer Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · CONSTRUCTION EXEC PORTAL",
        steps: [
          { id: "s1", label: "Review Multi-Project Contingency Reserves", triggerText: ["PROJECTS", "RESERVES", "PORTFOLIO"] },
          { id: "s2", label: "Audit Total SLA Penalties & Delays", triggerText: ["PENALTIES", "EXPOSURE", "RISK"] },
          { id: "s3", label: "Sign-off Project Funding & Overruns", triggerText: ["SIGN-OFF", "APPROVE", "FUNDING"] }
        ]
      }
    },
    healthcare: {
      warroom: {
        title: "GUIDE · HEALTHCARE WAR ROOM TELEMETRY",
        steps: [
          { id: "s1", label: "Load EHR / Claims Telemetry Data", triggerText: ["SAMPLE", "EHR", "CLAIMS", "LOAD"] },
          { id: "s2", label: "Parse Denial Flags & HIPAA Exposure", triggerText: ["PARSE", "DENIAL", "HIPAA", "MODULES"] },
          { id: "s3", label: "Review Patient SLA & Billing Leakage", triggerText: ["BILLING", "SLA", "PATIENT"] },
          { id: "s4", label: "Relay to Clinical Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · HEALTHCARE STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Claim Denials & CPT Coding", triggerText: ["DENIAL AUDIT", "CPT", "CODING"] },
          { id: "s2", label: "Review AI Care & Compliance Analysis", triggerText: ["EXPLAINABILITY", "ANALYSIS", "IMPACT"] },
          { id: "s3", label: "Generate Appeal & Action Packets", triggerText: ["GENERATE APPEAL", "SAVE", "PACKET"] },
          { id: "s4", label: "Escalate to Chief Medical Officer View", triggerText: ["EXEC PORTAL", "ESCALATE", "CMO"] }
        ]
      },
      exec: {
        title: "GUIDE · HEALTHCARE EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Clinical Net Revenue & Denials", triggerText: ["REVENUE", "DENIALS", "PORTFOLIO"] },
          { id: "s2", label: "Audit Regulatory & HIPAA Exposure", triggerText: ["HIPAA EXPOSURE", "COMPLIANCE"] },
          { id: "s3", label: "Authorize Clinical Appeals & Overrides", triggerText: ["AUTHORIZE", "APPROVE", "SIGN-OFF"] }
        ]
      }
    },
    mortgage: {
      warroom: {
        title: "GUIDE · MORTGAGE WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Loan Origination / TRID Statements", triggerText: ["LOAN", "TRID", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Pull-Through Rate & Closing Risk Audit", triggerText: ["PULL-THROUGH", "CLOSING RISK", "MODULES"] },
          { id: "s3", label: "Save Underwriting Telemetry", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Lending Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · LENDING STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit TRID Violations & Title Issues", triggerText: ["TRID VIOLATIONS", "TITLE", "AUDIT"] },
          { id: "s2", label: "Review Pull-Through & Rate Lock Deltas", triggerText: ["IMPACT DELTA", "PULL-THROUGH", "EXPLAINABILITY"] },
          { id: "s3", label: "Generate Loan Rescue Directives", triggerText: ["RESCUE DIRECTIVE", "SAVE", "GENERATE"] },
          { id: "s4", label: "Escalate to Lending Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · MORTGAGE EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Active Loan Pipeline Volume", triggerText: ["PIPELINE", "VOLUME", "ACTIVE LOANS"] },
          { id: "s2", label: "Audit Total TRID & Closing Exposure", triggerText: ["TRID EXPOSURE", "REVENUE RISK"] },
          { id: "s3", label: "Sign-off Secondary Market Offloads", triggerText: ["SIGN-OFF", "APPROVE", "OFFLOAD"] }
        ]
      }
    },
    schools: {
      warroom: {
        title: "GUIDE · SCHOOLS WAR ROOM TELEMETRY",
        steps: [
          { id: "s1", label: "Load District Attendance & ADA Funding Logs", triggerText: ["ADA", "ATTENDANCE", "DISTRICT", "SAMPLE"] },
          { id: "s2", label: "Parse Title IX & Safety Compliance Flags", triggerText: ["TITLE IX", "SAFETY", "MODULES"] },
          { id: "s3", label: "Review Campus Facilities SLA Risks", triggerText: ["FACILITIES", "SLA", "CAMPUS"] },
          { id: "s4", label: "Relay to District Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · SCHOOL STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit ADA Funding Discrepancies", triggerText: ["ADA FUNDING", "ATTENDANCE AUDIT"] },
          { id: "s2", label: "Review Campus Compliance & Safety Deltas", triggerText: ["EXPLAINABILITY", "IMPACT DELTA", "ANALYSIS"] },
          { id: "s3", label: "Generate District Remediation Directives", triggerText: ["GENERATE DIRECTIVE", "SAVE"] },
          { id: "s4", label: "Escalate to School Board Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE", "BOARD"] }
        ]
      },
      exec: {
        title: "GUIDE · SCHOOL DISTRICT EXEC PORTAL",
        steps: [
          { id: "s1", label: "Review District ADA Funding & Enrollment", triggerText: ["ENROLLMENT", "FUNDING", "DISTRICT"] },
          { id: "s2", label: "Audit Title IX & Facility Exposure", triggerText: ["TITLE IX EXPOSURE", "COMPLIANCE"] },
          { id: "s3", label: "Approve Board Budget Allocations", triggerText: ["APPROVE", "ALLOCATE", "SIGN-OFF"] }
        ]
      }
    },
    finops: {
      warroom: {
        title: "GUIDE · FINOPS WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Ledger & Transaction Logs", triggerText: ["LEDGER", "TRANSACTION", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Revenue Delta & Margin Audit", triggerText: ["MARGIN", "REVENUE", "AUDIT", "MODULES"] },
          { id: "s3", label: "Save Ingested Audit Trail", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to FinOps Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · FINOPS STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Cloud Spend & EBITDA Exposure", triggerText: ["EBITDA", "CLOUD SPEND", "AUDIT"] },
          { id: "s2", label: "Review Margin Delta & Cost Anomaly Analysis", triggerText: ["ANOMALY", "ANALYSIS", "IMPACT DELTA"] },
          { id: "s3", label: "Generate Cost Optimization Directives", triggerText: ["GENERATE DIRECTIVE", "OPTIMIZATION", "SAVE"] },
          { id: "s4", label: "Escalate to CFO Portal", triggerText: ["EXEC PORTAL", "ESCALATE", "CFO"] }
        ]
      },
      exec: {
        title: "GUIDE · FINOPS EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Corporate P&L & EBITDA Margin", triggerText: ["P&L", "EBITDA", "PORTFOLIO"] },
          { id: "s2", label: "Audit Financial Exposure Deltas", triggerText: ["EXPOSURE", "FINANCIAL RISK"] },
          { id: "s3", label: "Approve Capital Allocations & Budget Overrides", triggerText: ["APPROVE", "ALLOCATE", "SIGN-OFF"] }
        ]
      }
    },
    insurance: {
      warroom: {
        title: "GUIDE · INSURANCE WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Policy & Claims Records", triggerText: ["POLICY", "CLAIMS", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Run Loss Ratio & Underwriting Risk Audit", triggerText: ["LOSS RATIO", "UNDERWRITING", "MODULES"] },
          { id: "s3", label: "Save Claims Telemetry", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Claims Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · INSURANCE STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Fraud Indicators & Coverage Limits", triggerText: ["FRAUD", "COVERAGE", "AUDIT"] },
          { id: "s2", label: "Review Reserve Exposure & Severity Deltas", triggerText: ["RESERVE EXPOSURE", "SEVERITY", "ANALYSIS"] },
          { id: "s3", label: "Generate Settlement & Subrogation Packets", triggerText: ["SUBROGATION", "SETTLEMENT", "SAVE"] },
          { id: "s4", label: "Escalate to Chief Risk Officer View", triggerText: ["EXEC PORTAL", "ESCALATE", "CRO"] }
        ]
      },
      exec: {
        title: "GUIDE · INSURANCE EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Combined Ratio & Reinsurance Risk", triggerText: ["COMBINED RATIO", "REINSURANCE"] },
          { id: "s2", label: "Audit Total Portfolio Loss Reserves", triggerText: ["LOSS RESERVES", "PORTFOLIO RISK"] },
          { id: "s3", label: "Sign-off Enterprise Reinsurance Directives", triggerText: ["SIGN-OFF", "APPROVE", "AUTHORIZE"] }
        ]
      }
    },
    noc: {
      warroom: {
        title: "GUIDE · NOC WAR ROOM TELEMETRY",
        steps: [
          { id: "s1", label: "Load Network & Server Incident Feeds", triggerText: ["INCIDENT", "FEED", "SAMPLE", "LOAD"] },
          { id: "s2", label: "Parse Outage SLA & Latency Anomaly Flags", triggerText: ["LATENCY", "OUTAGE", "SLA", "MODULES"] },
          { id: "s3", label: "Save Network Telemetry State", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to NOC Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · NOC STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Edge Failures & BGP Routing", triggerText: ["BGP", "EDGE FAILURE", "AUDIT"] },
          { id: "s2", label: "Review Uptime SLA & Penalties Analysis", triggerText: ["UPTIME SLA", "PENALTIES", "ANALYSIS"] },
          { id: "s3", label: "Generate Failover & Reroute Directives", triggerText: ["FAILOVER", "REROUTE", "GENERATE", "SAVE"] },
          { id: "s4", label: "Escalate to Infrastructure Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · NOC EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Enterprise Network Availability & SLA", triggerText: ["AVAILABILITY", "SLA", "INFRASTRUCTURE"] },
          { id: "s2", label: "Audit Total SLA Breach Exposure", triggerText: ["SLA BREACH", "FINANCIAL PENALTY"] },
          { id: "s3", label: "Authorize Core Infrastructure Capital Spend", triggerText: ["AUTHORIZE", "APPROVE", "SIGN-OFF"] }
        ]
      }
    },
    honeywell: {
      strategist: {
        title: "GUIDE · HONEYWELL BGS STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit BMS Telemetry & HVAC Performance", triggerText: ["BMS", "HVAC", "TELEMETRY", "AUDIT"] },
          { id: "s2", label: "Review Energy Efficiency & SLA Deltas", triggerText: ["ENERGY", "EFFICIENCY", "SLA DELTA"] },
          { id: "s3", label: "Generate Facility Automation Packets", triggerText: ["AUTOMATION", "PACKET", "GENERATE", "SAVE"] },
          { id: "s4", label: "Escalate to Honeywell Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · HONEYWELL BGS EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Global Facility Portfolio Performance", triggerText: ["GLOBAL PORTFOLIO", "FACILITIES"] },
          { id: "s2", label: "Audit Total Building Operational Risk", triggerText: ["BUILDING RISK", "OPERATIONAL DELTA"] },
          { id: "s3", label: "Approve Enterprise Modernization Directives", triggerText: ["APPROVE", "DIRECTIVE", "SIGN-OFF"] }
        ]
      }
    },
    "plant-incident": {
      warroom: {
        title: "GUIDE · PLANT INCIDENT WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Factory Telemetry & SCADA Logs", triggerText: ["SCADA", "FACTORY", "INCIDENT", "LOAD"] },
          { id: "s2", label: "Parse Equipment Downtime & Safety Flags", triggerText: ["DOWNTIME", "SAFETY", "MODULES"] },
          { id: "s3", label: "Save Plant Incident Telemetry", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Plant Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · PLANT INCIDENT STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Failure Root Cause & OSHA Risk", triggerText: ["ROOT CAUSE", "OSHA", "AUDIT"] },
          { id: "s2", label: "Review Production Line Yield Deltas", triggerText: ["PRODUCTION YIELD", "YIELD DELTA"] },
          { id: "s3", label: "Generate Maintenance & Safety Directives", triggerText: ["SAFETY DIRECTIVE", "MAINTENANCE", "SAVE"] },
          { id: "s4", label: "Escalate to Operations Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · PLANT INCIDENT EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Multi-Plant Output & Safety Compliance", triggerText: ["MULTI-PLANT", "OUTPUT", "SAFETY"] },
          { id: "s2", label: "Audit Total Unplanned Downtime Cost", triggerText: ["DOWNTIME COST", "FINANCIAL LOSS"] },
          { id: "s3", label: "Authorize Plant Overhaul Capital Allocations", triggerText: ["AUTHORIZE", "OVERHAUL", "APPROVE"] }
        ]
      }
    },
    "cyber-incident": {
      warroom: {
        title: "GUIDE · CYBER INCIDENT WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load SIEM / SOC Alerts & Breach Logs", triggerText: ["SIEM", "SOC", "BREACH", "LOAD"] },
          { id: "s2", label: "Parse Threat Vector & Compromise Exposure", triggerText: ["THREAT VECTOR", "COMPROMISE", "MODULES"] },
          { id: "s3", label: "Save Cyber Telemetry Snapshot", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Cyber Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · CYBER INCIDENT STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Breach Containment & Ransom Exposure", triggerText: ["CONTAINMENT", "RANSOM", "AUDIT"] },
          { id: "s2", label: "Review Data Exfiltration & SEC Disclosure Deltas", triggerText: ["EXFILTRATION", "SEC DISCLOSURE", "ANALYSIS"] },
          { id: "s3", label: "Generate Incident Remediation Directives", triggerText: ["REMEDIATION DIRECTIVE", "GENERATE", "SAVE"] },
          { id: "s4", label: "Escalate to CISO Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE", "CISO"] }
        ]
      },
      exec: {
        title: "GUIDE · CYBER INCIDENT EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Corporate Cyber Risk & Active Breaches", triggerText: ["CYBER RISK", "ACTIVE BREACH"] },
          { id: "s2", label: "Audit Total Legal & Regulatory Liability", triggerText: ["REGULATORY LIABILITY", "FINANCIAL PENALTY"] },
          { id: "s3", label: "Sign-off Board Incident Communications & Disclosures", triggerText: ["SIGN-OFF", "DISCLOSURE", "APPROVE"] }
        ]
      }
    },
    "supplier-shutdown": {
      warroom: {
        title: "GUIDE · SUPPLIER SHUTDOWN WAR ROOM INGESTION",
        steps: [
          { id: "s1", label: "Load Vendor Outage & Logistics Logs", triggerText: ["VENDOR", "OUTAGE", "LOGISTICS", "LOAD"] },
          { id: "s2", label: "Parse Single-Point Failure & Inventory Risks", triggerText: ["SINGLE-POINT", "INVENTORY", "MODULES"] },
          { id: "s3", label: "Save Supply Chain Snapshot", triggerText: ["SAVE", "STORE"] },
          { id: "s4", label: "Relay to Supply Chain Strategist", triggerText: ["STRATEGIST", "RELAY"] }
        ]
      },
      strategist: {
        title: "GUIDE · SUPPLIER SHUTDOWN STRATEGIST WORKFLOW",
        steps: [
          { id: "s1", label: "Audit Alternate Vendor Capacity & SLAs", triggerText: ["ALTERNATE VENDOR", "CAPACITY", "SLA"] },
          { id: "s2", label: "Review Order Delays & Stockout Exposure Deltas", triggerText: ["STOCKOUT", "ORDER DELAYS", "ANALYSIS"] },
          { id: "s3", label: "Generate Emergency Rerouting Directives", triggerText: ["REROUTING DIRECTIVE", "GENERATE", "SAVE"] },
          { id: "s4", label: "Escalate to Supply Chain Exec Portal", triggerText: ["EXEC PORTAL", "ESCALATE"] }
        ]
      },
      exec: {
        title: "GUIDE · SUPPLIER SHUTDOWN EXECUTIVE PORTAL",
        steps: [
          { id: "s1", label: "Review Global Supply Network Continuity", triggerText: ["SUPPLY NETWORK", "CONTINUITY"] },
          { id: "s2", label: "Audit Revenue Exposure From Vendor Shutdowns", triggerText: ["REVENUE EXPOSURE", "SHUTDOWN LOSS"] },
          { id: "s3", label: "Authorize Secondary Vendor Procurement Commitments", triggerText: ["AUTHORIZE", "PROCUREMENT", "APPROVE"] }
        ]
      }
    }
  };

  // 2b. Real-state checkers — verified against actual page code, not guessed.
  // Each returns an array of booleans (one per config step, in order) computed
  // from real DOM text/localStorage, never from "something got clicked".
  // Only add an entry here after reading the real page. Everything without
  // an entry falls back to the old click-text heuristic below (initEngineHeuristic),
  // which can be advanced by clicking anything whose text happens to match —
  // not verified, kept only so untouched pages still show *something*.
  const STATE_CHECKERS = {
    mortgage: {
      // Verified against html/war-rooms/mortgage/mortgage-war-room.html.
      // Real user actions on this page: LOAD SAMPLE DATA -> RUN ANALYSIS -> RELAY TO STRATEGIST.
      // The config's 4 steps split "load" and "save" into two labels, but on
      // this page they're the same click (loadSampleData() calls saveToStorage()
      // internally) — so steps 1 and 3 are driven by the same real signal below,
      // not faked as separately achievable.
      warroom: function () {
        const AI_PLACEHOLDER = 'Run analysis to get AI-generated pipeline risk, SLA-breach root cause, and closing-readiness guidance across the loan file portfolio.';
        let loaded = false;
        try {
          const raw = localStorage.getItem('TSM_MORTGAGE_DATA');
          if (raw) {
            const data = JSON.parse(raw);
            loaded = Object.keys(data || {}).some((k) => Array.isArray(data[k]) && data[k].length > 0);
          }
        } catch (e) { /* localStorage unavailable or corrupt — treat as not loaded */ }

        const out = document.getElementById('aiOutput');
        const analyzed = !!(out && out.textContent && out.textContent.trim() !== AI_PLACEHOLDER && !out.classList.contains('loading'));

        let relayed = false;
        try { relayed = !!localStorage.getItem('TSM_MORTGAGE_STRATEGIST_RELAY'); } catch (e) { /* noop */ }

        // step1: Load, step2: Run analysis, step3: Save (same signal as step1 on this page), step4: Relay
        return [loaded, analyzed, loaded, relayed];
      }
    },
    // Verified against html/hotelops/hotelops-war-room.html (HotelOps engine
    // mirrors mortgage-engine.js's shape/storage-key convention). Strategist
    // and Exec Portal are intentionally NOT covered here: both are pure
    // auto-render dashboards (loadRelay() renders every panel in one shot,
    // there is no separate "generate" click), and the exec portal's
    // ACKNOWLEDGE/ESCALATE buttons are decorative (toast only, no downstream
    // write). Faking step-by-step granularity there would misrepresent state
    // that doesn't exist — left on the heuristic fallback instead.
    concierge: {
      warroom: function () {
        const AI_PLACEHOLDER = 'Run analysis to see AI output here.';
        let loaded = false;
        try {
          const raw = localStorage.getItem('TSM_HOTELOPS_DATA');
          if (raw) {
            const parsed = JSON.parse(raw);
            const data = parsed && parsed.data;
            loaded = !!(data && Object.keys(data).some((k) => Array.isArray(data[k]) && data[k].length > 0));
          }
        } catch (e) { /* localStorage unavailable or corrupt — treat as not loaded */ }

        const out = document.getElementById('aiOutput');
        const txt = out && out.textContent ? out.textContent.trim() : '';
        const analyzed = !!(out && txt && txt !== AI_PLACEHOLDER && txt !== 'Running analysis...' && !out.innerHTML.includes('Analysis failed'));

        let relayed = false;
        try { relayed = !!(localStorage.getItem('TSM_HOTELOPS_STRATEGIST_RELAY') || sessionStorage.getItem('TSM_HOTELOPS_STRATEGIST_RELAY')); } catch (e) { /* noop */ }

        // step1: Load PMS/BMS telemetry, step2: Parse OTA & maintenance alerts
        // (RUN ANALYSIS click), step3: Review IoT & compliance exposure — same
        // real signal as step2 on this page (renders together, no separate
        // click), step4: Relay to strategist.
        return [loaded, analyzed, analyzed, relayed];
      }
    },
    // Verified against html/finops-suite/finops-war/finops-war-room.html and
    // finops-main-strategist.html. Exec Portal intentionally excluded: its
    // TSM_EXEC_CONFIRMED_finops-suite write fires unconditionally the moment
    // the page loads (not gated on any click or real sign-off), so there is
    // no genuine user action there to verify — left on the heuristic fallback
    // rather than treating an auto-write as proof of review.
    finops: {
      warroom: function () {
        const paste = document.getElementById('docPaste');
        const loaded = !!(paste && paste.value && paste.value.trim().length > 20);

        const bar = document.getElementById('escalateBar');
        const analyzed = !!(bar && bar.classList.contains('visible'));

        let relayed = false;
        try { relayed = !!localStorage.getItem('TSM_STRAT_CONFIRMED_finops-suite'); } catch (e) { /* noop */ }

        // step1: Load, step2: Run audit, step3: Save (same signal as step2 —
        // storeRelay() fires at the same completion point as the escalate bar
        // appearing), step4: Relay (confirmed by the strategist page reading
        // it back, not a local write on this page).
        return [loaded, analyzed, analyzed, relayed];
      },
      strategist: function () {
        const runStatus = document.getElementById('runStatus');
        const generated = !!(runStatus && runStatus.textContent.trim() === 'COMPLETE');

        let escalated = false;
        try { escalated = !!localStorage.getItem('TSM_EXEC_CONFIRMED_finops-suite'); } catch (e) { /* noop */ }
        // TSM_EXEC_CONFIRMED_finops-suite fires unconditionally when the exec
        // portal loads (not gated on a real sign-off there) — so "escalated"
        // here really means "navigated to exec portal", same honesty caveat
        // as the exec portal checker note above.

        // This page's 4 config steps (audit / review / generate / escalate)
        // don't map to 4 separately-clickable actions — GENERATE STRATEGIST
        // REPORT produces the audit and review together as one report, so
        // steps 1-3 share the same real signal; only "escalated" differs.
        return [generated, generated, generated, escalated];
      }
    },
    // Verified against html/healthcare/hc-main-strategist.html and
    // html/healthcare/executive-portal.html. War Room is intentionally NOT
    // covered here — it already has its own hand-verified entry in
    // APP_STATE_CHECKERS below ("hc-denial-war-room"), which takes priority.
    healthcare: {
      // hc-main-strategist.html's 6 Pull Packs (revenue/variance/denial/auth/
      // compliance/executive) all write to the same #strat-out panel — there
      // is no separate DOM signal distinguishing "audited denials" from
      // "reviewed compliance" from "generated packet", so steps 1-3 share
      // the one real signal (a pack has actually been run), same honesty
      // convention as the finops.strategist checker above. Step 4 is the
      // real TSM_EXEC_RELAY write from escalateToExecPortal().
      strategist: function () {
        const out = document.getElementById('strat-out');
        const packRun = !!(out && out.textContent && out.textContent.trim().length > 40);

        let escalated = false;
        try {
          escalated = !!(sessionStorage.getItem('TSM_EXEC_RELAY') || localStorage.getItem('TSM_EXEC_RELAY'));
        } catch (e) { /* noop */ }

        return [packRun, packRun, packRun, escalated];
      },
      // executive-portal.html: step 1 (revenue/denial review) and step 2
      // (HIPAA/regulatory audit) share the same real signal —
      // loadStratRelay() populating the KPI tiles + BNCA strip from a
      // genuine TSM_EXEC_RELAY write. The Compliance Calendar panel (HIPAA,
      // Stark Law, CMS deadlines) is static reference content with no
      // click/interaction to verify, so there is no second real signal to
      // split step 2 off from step 1 — an unverifiable sub-step shares its
      // parent's real signal rather than being faked as separately
      // achievable, same convention used throughout this file. Step 3
      // (authorize) is the real TSM_EXEC_FEEDBACK write from
      // submitExecNote() — an executive actually submitting a decision/note
      // back to the strategist, not just typing in a textarea.
      exec: function () {
        let relay = null;
        try {
          const raw = sessionStorage.getItem('TSM_EXEC_RELAY') || localStorage.getItem('TSM_EXEC_RELAY');
          if (raw) relay = JSON.parse(raw);
        } catch (e) { /* noop */ }
        const relayLoaded = !!(relay && relay.enriched);

        // Primary authorize signal: decide() in tsm-exec-portal-upgrade.js
        // (wired to this page as of the HITL-persistence commit) stamps a
        // .tsm-status-approved/-rejected/-hold marker on a Decision Center
        // item the moment an executive actually clicks Approve/Reject/Hold,
        // backed by a server-side HITL gate. That's a closer match for
        // "Authorize Clinical Appeals & Overrides" than the Respond-by-Notes
        // panel below, so it's checked first.
        const decided = !!document.querySelector(
          '.tsm-status-approved, .tsm-status-rejected, .tsm-status-hold'
        );

        // Secondary: TSM_EXEC_FEEDBACK is a distinct, genuine action (a note
        // submitted back to the strategist via submitExecNote()) — counts
        // as authorization too if that's the path the executive took instead.
        let feedbackSubmitted = false;
        try {
          const fb = JSON.parse(localStorage.getItem('TSM_EXEC_FEEDBACK') || '[]');
          feedbackSubmitted = Array.isArray(fb) && fb.length > 0;
        } catch (e) { /* noop */ }

        const authorized = decided || feedbackSubmitted;

        return [relayLoaded, relayLoaded, authorized];
      }
    }
  };

  // 2c. Page-specific checkers — paired with APP_CONFIGS above, verified
  // against the real ids/functions in each page's own source.
  const APP_STATE_CHECKERS = {
    // Verified against html/finops-suite/finops-accounting.html. Real user
    // actions: pick a doc type + fill its form -> FIRE ALL 4 ENGINES ->
    // (four panels populate) -> Export All. There's no separate DOM/storage
    // signal for "reviewed the output" or "exported" — Export All just
    // triggers a file download with no flag written — so steps 3 and 4
    // share the "engines complete" signal from step 2, same honesty
    // convention used elsewhere in this file.
    "finops-accounting": function () {
      const area = document.getElementById('form-area');
      let filled = false;
      if (area) {
        filled = Array.prototype.some.call(area.querySelectorAll('input, textarea'), function (el) {
          return el.value && el.value.trim().length > 0;
        }) || Array.prototype.some.call(area.querySelectorAll('select'), function (el) {
          return el.selectedIndex > 0;
        });
      }
      const fs = document.getElementById('fire-status');
      const complete = !!(fs && fs.textContent.trim() === 'ALL 4 ENGINES COMPLETE');
      return [filled, complete, complete, complete];
    },
    // Verified against html/healthcare/hc-denial-war-room.html. Real user
    // actions: paste/drop a document (updateStatus() writes doc-status) ->
    // FIRE ALL 5 ENGINES (runPipeline() writes active-txt) -> Engine 6
    // auto-renders #e6-dispatch-panel once the 5 engines finish -> clicking
    // Escalate writes TSM_WAR_ROOM_BRIEF to sessionStorage.
    "hc-denial-war-room": function () {
      const statusEl = document.getElementById('doc-status');
      const loaded = !!(statusEl && statusEl.textContent.trim() !== 'No document loaded');

      const actTxt = document.getElementById('active-txt');
      const enginesComplete = !!(actTxt && actTxt.textContent.trim() === '5 / 5 Engines Complete');

      const dispatched = !!document.getElementById('e6-dispatch-panel');

      let escalated = false;
      try { escalated = !!sessionStorage.getItem('TSM_WAR_ROOM_BRIEF'); } catch (e) { /* noop */ }

      return [loaded, enginesComplete, dispatched, escalated];
    },
    // Verified against html/l1-copilot/l1-ticket-copilot.html. Real user
    // actions: paste description (Ticket tab) -> RUN ANALYSIS (renderAnalysis
    // replaces the #aiOutput placeholder) -> check items in the
    // Troubleshooting checklist (renderChecklist adds a .done class to each
    // completed .check-row) -> GENERATE RESOLUTION (#resolutionOutput) or
    // BUILD ESCALATION PACKAGE (#escalationOutput), either of which is a
    // genuine close-out action so both count for step 4.
    "l1-ticket-copilot": function () {
      const desc = document.getElementById('tkDescription');
      const intake = !!(desc && desc.value && desc.value.trim().length > 0);

      const aiOut = document.getElementById('aiOutput');
      const aiTxt = aiOut && aiOut.textContent ? aiOut.textContent.trim() : '';
      const analyzed = !!(aiOut && aiTxt &&
        aiTxt !== 'Run AI analysis from the Ticket tab to populate this panel.' &&
        aiTxt !== 'Running AI analysis on ticket...' &&
        !aiOut.querySelector('.err'));

      const checklistWorked = document.querySelectorAll('#checklistBody .check-row.done').length > 0;

      const resOut = document.getElementById('resolutionOutput');
      const resTxt = resOut && resOut.textContent ? resOut.textContent.trim() : '';
      const resolved = !!(resOut && resTxt &&
        resTxt !== 'Problem / Cause / Actions Taken / Resolution / Validation / Next Steps will be generated here from the ticket, checklist, and AI analysis.' &&
        resTxt !== 'Generating resolution write-up...' &&
        !resOut.querySelector('.err'));

      const escOut = document.getElementById('escalationOutput');
      const escTxt = escOut && escOut.textContent ? escOut.textContent.trim() : '';
      const escalated = !!(escOut && escTxt &&
        escTxt !== 'Escalation package will appear here.' &&
        escTxt !== 'Building escalation package...' &&
        !escOut.querySelector('.err'));

      return [intake, analyzed, checklistWorked, resolved || escalated];
    }
  };

  // 3. Inject Collapsible Widget HTML Into DOM
  function renderWidget(config, banner) {
    if (document.getElementById("tsm-universal-guide")) return;

    const totalSteps = config.steps.length;
    const bannerHtml = banner ? `
        <div id="guide-continuity-banner" style="background: rgba(56,189,248,0.1); border-bottom: 1px solid rgba(56,189,248,0.3); padding: 6px 10px; font-size: 9px; color: #38bdf8; display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div style="min-width:0;">
            <div style="font-weight:bold; letter-spacing: 0.5px;">↳ ${banner.label}</div>
            ${banner.detail ? `<div style="color:#7dd3fc; font-weight: normal; margin-top: 2px; line-height: 1.4;">${banner.detail}</div>` : ""}
          </div>
          <button id="guide-continuity-dismiss" title="Dismiss" style="background:none;border:none;color:#38bdf8;cursor:pointer;font-size:11px;flex-shrink:0;padding:0;">✕</button>
        </div>` : "";
    const widgetHtml = `
      <div id="tsm-universal-guide" style="position: fixed; bottom: 20px; right: 20px; z-index: 999999; width: 330px; background: #070d19; border: 1px solid #10b981; box-shadow: 0 10px 30px rgba(0,0,0,0.95); font-family: monospace; color: #e2e8f0; border-radius: 4px; overflow: hidden; pointer-events: auto;">
        <div style="background: rgba(16, 185, 129, 0.18); padding: 6px 10px; border-bottom: 1px solid #10b981; display: flex; justify-content: space-between; align-items: center; user-select: none;">
          <span style="font-size: 10px; font-weight: bold; letter-spacing: 1px; color: #10b981;" id="guide-title">• ${config.title}</span>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 9px; color: #38bdf8; font-weight: bold;" id="guide-step-counter">STEP 1 OF ${totalSteps}</span>
            <button id="guide-toggle-btn" style="background: #0f172a; border: 1px solid #10b981; color: #10b981; font-size: 10px; border-radius: 3px; cursor: pointer; padding: 0 5px; line-height: 14px; font-weight: bold;">+</button>
          </div>
        </div>
        ${bannerHtml}
        <div id="guide-card-body" style="padding: 10px; font-size: 10px; line-height: 1.5; display: none;">
          ${config.steps
            .map(
              (step, idx) => `
            <div id="u-step-${idx + 1}" class="guide-step" style="margin-bottom: 6px; color: ${idx === 0 ? "#f59e0b" : "#64748b"}; opacity: ${idx === 0 ? "1" : "0.6"}; display: flex; align-items: flex-start; gap: 8px;">
              <span class="u-icon" style="font-weight: bold; width: 12px; text-align: center;">${idx === 0 ? "●" : "○"}</span>
              <div>
                <strong>${idx + 1}. ${step.label}</strong>
              </div>
            </div>
          `
            )
            .join("")}
        </div>
        <div id="guide-card-footer" style="background: #030712; padding: 6px 10px; border-top: 1px solid #1e293b; font-size: 9px; color: #f59e0b; display: none;">
          <strong>Next:</strong> <span id="guide-step-hint">Click ${config.steps[0].label} to begin.</span>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", widgetHtml);

    // Toggle button event handler
    document.getElementById("guide-toggle-btn").addEventListener("click", function () {
      const body = document.getElementById("guide-card-body");
      const footer = document.getElementById("guide-card-footer");
      if (body.style.display === "none") {
        body.style.display = "block";
        footer.style.display = "block";
        this.innerText = "–";
      } else {
        body.style.display = "none";
        footer.style.display = "none";
        this.innerText = "+";
      }
    });

    // Dismiss continuity banner — clears the stored relay/mission so it
    // doesn't keep resurfacing on this page (e.g. after a refresh).
    const dismissBtn = document.getElementById("guide-continuity-dismiss");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", function () {
        // Only clear tsm_guide_relay/tsm_active_mission for the generic
        // click-guessed banner. App-specific handoff banners (noClear) read
        // real payloads other page code still depends on rendering — wiping
        // them on dismiss would break that, so just hide the widget banner.
        if (!banner || !banner.noClear) clearContinuity();
        const el = document.getElementById("guide-continuity-banner");
        if (el) el.remove();
      });
    }
  }

  // 4a. Shared step-painting — sets each step's done/active/pending style from
  // an explicit array of booleans, rather than assuming steps complete in order.
  function paintSteps(doneArray, totalSteps) {
    let firstUndone = doneArray.findIndex((d) => !d);
    if (firstUndone === -1) firstUndone = totalSteps; // all done

    for (let i = 0; i < totalSteps; i++) {
      const el = document.getElementById(`u-step-${i + 1}`);
      if (!el) continue;
      const icon = el.querySelector(".u-icon");
      if (doneArray[i]) {
        el.style.color = "#10b981"; el.style.opacity = "1";
        if (icon) icon.innerText = "✓";
      } else if (i === firstUndone) {
        el.style.color = "#f59e0b"; el.style.opacity = "1";
        if (icon) icon.innerText = "●";
      } else {
        el.style.color = "#64748b"; el.style.opacity = "0.6";
        if (icon) icon.innerText = "○";
      }
    }
    const counterEl = document.getElementById("guide-step-counter");
    if (counterEl) {
      const doneCount = doneArray.filter(Boolean).length;
      counterEl.innerText = doneCount >= totalSteps ? "COMPLETE" : `STEP ${firstUndone + 1} OF ${totalSteps}`;
    }
    // guide-step-hint is set by the caller (it has the step labels in scope).
  }

  // 4b. Verified engine — polls a real STATE_CHECKERS function on an interval
  // plus after every click (cheap, and catches async updates like AI output
  // finishing). Never advances on click text alone.
  function initEngineVerified(config, checkerFn) {
    const totalSteps = config.steps.length;
    function tick() {
      let doneArray;
      try { doneArray = checkerFn(); } catch (e) { doneArray = new Array(totalSteps).fill(false); }
      paintSteps(doneArray, totalSteps);
      const firstUndone = doneArray.findIndex((d) => !d);
      const hintEl = document.getElementById("guide-step-hint");
      if (hintEl) {
        hintEl.innerHTML = firstUndone === -1
          ? "Workflow complete."
          : `<strong>${config.steps[firstUndone].label}</strong>`;
      }
    }
    tick();
    document.addEventListener("click", function () { setTimeout(tick, 150); }, true);
    setInterval(tick, 800);
  }

  // 4c. Unverified fallback — original click-text heuristic, unchanged.
  // Advances on ANY element whose visible text matches a trigger term, whether
  // or not the underlying action actually happened. Only used for pages with
  // no entry in STATE_CHECKERS above — treat its output as a rough hint, not
  // a guarantee, until that vertical gets a real checker.
  function initEngineHeuristic(config) {
    let activeStep = 1;
    const totalSteps = config.steps.length;

    function advanceTo(stepNum, hint) {
      if (stepNum <= activeStep) return;
      for (let i = 1; i < stepNum; i++) {
        const prevEl = document.getElementById(`u-step-${i}`);
        if (prevEl) {
          prevEl.style.color = "#10b981";
          prevEl.style.opacity = "1";
          const icon = prevEl.querySelector(".u-icon");
          if (icon) icon.innerText = "✓";
        }
      }
      activeStep = stepNum;
      const currEl = document.getElementById(`u-step-${activeStep}`);
      if (currEl) {
        currEl.style.color = "#f59e0b";
        currEl.style.opacity = "1";
        const icon = currEl.querySelector(".u-icon");
        if (icon) icon.innerText = "●";
      }
      const counterEl = document.getElementById("guide-step-counter");
      if (counterEl) {
        counterEl.innerText = activeStep > totalSteps ? "COMPLETE" : `STEP ${activeStep} OF ${totalSteps}`;
      }
      if (hint) document.getElementById("guide-step-hint").innerHTML = hint;
    }

    document.addEventListener("click", function (e) {
      const el = e.target.closest("*");
      if (!el) return;
      const txt = (el.innerText || "").toUpperCase();
      config.steps.forEach((step, idx) => {
        const stepNum = idx + 1;
        if (step.triggerText && step.triggerText.some((term) => txt.includes(term))) {
          const nextHint = config.steps[stepNum] ? `Proceed to: <strong>${config.steps[stepNum].label}</strong>` : "Workflow complete.";
          advanceTo(stepNum + 1, nextHint);
        }
      });
    }, true);
  }

  // Allowlist — only the generic vertical/role fallback below (GUIDE_CONFIGS)
  // gets gated by this. data-page-role="warroom" was stamped on ~185 pages
  // that aren't real war-room pages (howto docs, showcases, tax-prep, suite
  // indexes) by default, so that fallback showed a bogus tracker on all of
  // them. APP_CONFIGS (hand-verified single pages) and the mission/relay
  // continuity banner are separate, deliberate features and are NOT gated
  // by this — only render-everywhere-by-default is the bug being fixed.
  // Historical note: html/healthcare/* previously had an orphaned duplicate
  // at html/war-rooms/health-war/* (same 11 nodes + strategist + exec portal,
  // stale fork). That mirror was deleted; html/healthcare/* is canonical.
  const ALLOWED_PAGES = [
    "/war-rooms/re-war/re-war-room.html",
    "/war-rooms/re-war/re-strategist.html",
    "/war-rooms/re-war/re-exec-portal.html",

    "/hotelops/hotelops-war-room.html",
    "/hotelops/hotelops-strategist.html",
    "/hotelops/hotelops-executive-portal.html",

    "/war-rooms/legal-war/legal-war-room.html",
    "/war-rooms/legal-war/legal-main-strategist.html",
    "/war-rooms/legal-war/legal-executive-portal.html",

    "/war-rooms/construct-war/construction-war-room.html",
    "/war-rooms/construct-war/construction-strategist.html",
    "/war-rooms/construct-war/construction-executive-portal.html",

    "/healthcare/hc-denial-war-room.html",
    "/healthcare/hc-main-strategist.html",
    "/healthcare/executive-portal.html",

    "/war-rooms/mortgage/mortgage-war-room.html",
    "/war-rooms/mortgage/mortgage-strategist.html",
    "/war-rooms/mortgage/mortgage-executive-portal.html",

    "/war-rooms/schools-command/schools-command.html",
    "/war-rooms/schools-command/schools-strategist.html",
    "/war-rooms/schools-command/schools-executive-portal.html",

    "/finops-main-strategist.html",
    "/finops-suite/finops-war/finops-executive-portal.html",

    "/war-rooms/insure-war/insurance-war-room.html",
    "/war-rooms/insure-war/insurance-strategist.html",
    "/war-rooms/insure-war/insurance-executive-portal.html",

    "/l1-copilot/noc/noc-war-room.html",
    "/l1-copilot/noc/noc-strategist.html",
    "/l1-copilot/noc/noc-executive-portal.html",

    "/war-rooms/honeywell-strategist.html",
    "/war-rooms/honeywell-executive-portal.html",
    "/war-rooms/bess-gigafactory-incident.html",

    "/plant-incident.html",
    "/cyber-incident.html",
    "/supplier-shutdown.html"
  ];

  function isAllowedPage() {
    let path = window.location.pathname.toLowerCase();
    // server.js mounts both '/' and '/html' to html/, so normalize the
    // '/html' prefix away before comparing — exact match only, no endsWith,
    // so same-named files in different directories (e.g. the canonical
    // finops-main-strategist.html vs the finops-war/ copy) can't collide.
    if (path.indexOf("/html/") === 0) path = path.substring(5);
    return ALLOWED_PAGES.indexOf(path) !== -1;
  }

  // 5. Bootstrap Engine on DOM Load
  document.addEventListener("DOMContentLoaded", function () {
    // Always-on: capture "LAUNCH/OPEN another app" clicks so continuity
    // survives even on pages with no other mission tooling loaded.
    captureRelayOnClick();

    const context = detectContext();

    // Cross-page continuity takes priority: a fresh AI mission generated
    // for THIS exact page beats the generic template, since it's tailored
    // to the specific anomaly that sent the user here.
    const mission = readActiveMission();
    const relay = !mission ? readRelay() : null; // mission already implies relay-level context
    const banner = buildContinuityBanner(mission, relay) || readVerifiedAppHandoff(context);

    let pageConfig, checkerFn;
    if (mission) {
      pageConfig = missionToConfig(mission);
      checkerFn = null; // dynamic AI steps — no generic DOM signal to verify against
    } else {
      const appConfig = context.app && APP_CONFIGS[context.app];
      if (appConfig) {
        pageConfig = appConfig;
        checkerFn = context.app && APP_STATE_CHECKERS[context.app];
      } else if (isAllowedPage()) {
        const vertConfig = GUIDE_CONFIGS[context.vertical] || GUIDE_CONFIGS.re;
        pageConfig = vertConfig[context.role] || vertConfig.warroom || vertConfig.strategist;
        checkerFn = STATE_CHECKERS[context.vertical] && STATE_CHECKERS[context.vertical][context.role];
      } else {
        console.warn(
          "[tsm-guide-engine] Skipped generic vertical/role config: " + window.location.pathname +
          " is not on the war-room/strategist/exec-portal allowlist. " +
          "If this page IS a genuine war-room page, add its path to ALLOWED_PAGES in tsm-guide-engine.js."
        );
      }
    }

    if (pageConfig) {
      renderWidget(pageConfig, banner);
      if (checkerFn) {
        initEngineVerified(pageConfig, checkerFn);
      } else {
        initEngineHeuristic(pageConfig);
      }
    }
  });
})();