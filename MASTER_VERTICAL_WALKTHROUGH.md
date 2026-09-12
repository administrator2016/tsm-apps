# TSM Consultz — Master Vertical Walkthrough
## War Room → Strategist → Executive Portal (13 Chained Verticals + 1 Standalone)

**Verticals covered:** Healthcare, Construction, FinOps, Insurance, Legal, Real Estate, Mortgage, Schools, PM Copilot, BPO, HotelOps, Concierge, Honeywell (Plant/Supplier/ Cyber-OT). RCM-OS is documented separately at the end — it's a standalone reconciliation tool, not a War Room → Strategist → Executive Portal chain.
**Pattern:** every vertical runs the same three-layer chain — operator desk (War Room) → analytical handoff (Strategist) → leadership decision surface (Executive Portal). All onClick chains below are verified against the live HTML/JS, not assumed.

---

## ✅ PRE-DEMO CHECK — resolved 2026-08-29 (was flagged earlier same day)

An earlier pass today flagged `401 (Unauthorized)` responses firing on page load across 11 of 13 Executive Portal pages, based on a crawl run without confirming the login step actually succeeded. Re-run properly — logging in via the real `/api/auth/login` endpoint (matching what `login.html`'s own script does: `POST` JSON `{password}`, which sets the signed `tsm_session` cookie with `role`/`clientId`/etc.) and verifying the login response before crawling — the 401s do not reproduce. **Root cause was the test methodology, not the app:** the original crawl's login click never confirmed the `/api/auth/login` response succeeded, so the "logged-in" session was in fact unauthenticated for every subsequent page.

**Verified 2026-08-29, live Codespace deployment, real credentials (`MONGODB_URI` + `GROQ_API_KEY` both set):**
- Logged in with the real admin password → confirmed `200 OK` with `{ok:true, role:"admin", ...}` and a valid `tsm_session` cookie before crawling anything.
- All 40 links on `suite-hub.html` crawled (all 13 chained verticals + BPO Internal, Client Portal, Login, Smoke Test) — **39/40 pages returned HTTP 200 with zero unexpected failed sub-requests.**
- The one remaining failure (Concierge Command → `intake.tsmatter.com/api/intake/records`, HTTP 525) is a Cloudflare SSL-handshake failure on a **third-party service outside this repo** — confirmed via direct `curl -v` that Cloudflare's edge can't complete a TLS handshake to that origin. Not a `tsm-apps` bug; nothing to fix here without access to that other service's Cloudflare/origin config.

**Test artifact:** `tests/e2e/puppeteer-suite-hub-crawl.js` — does a real login (aborts loudly if the login response isn't 200, instead of silently crawling unauthenticated), crawls every `suite-hub.html` link, and filters the expected `/cdn-cgi/` Cloudflare RUM beacon noise. Kept in the repo for future regression checks.

---

## 0. The Story (use before touching any vertical)

**Talk points:**
- "Every one of these eight verticals runs the same three conversations: what's happening on the ground, what does it mean, what does leadership need to decide. Normally that's three tools and three people. Here it's one connected chain."
- "The War Room is the operator's desk — live engines running against real case data. The Strategist is the analytical layer that turns that into a report. The Executive Portal is where a decision gets made and a client package gets exported."
- "Watch the data travel. Nothing gets re-typed between screens."

---

## 1. Healthcare (HC)

**Path:** `html/healthcare/hc-denial-war-room.html` → `html/healthcare/hc-main-strategist.html` → `html/healthcare/executive-portal.html`
**Relay key:** `tsm_hc_docsearch_relay` / `TSM_HC_WAR_RELAY`

### War Room — `hc-denial-war-room.html`
- **⚡ FIRE ALL 5 ENGINES** — `fireAll()` — runs the denial-analysis engine stack against loaded claims data.
- **↗ Escalate to Strategist** — `escalateToStrategist()` (`#escalate-strategist-btn`) — hands the fired-engine output to the Strategist.
- **⬇ Export All / Export Full Report** — `exportAll()` — three separate export touchpoints (summary, full report, footer variant).
- **⚡ Run New Scenario** — `fireAll()` re-triggered from the results panel.

**Talk points:**
- "This is denial management for a multi-site practice group — Scottsdale, Mesa, Tempe, North Mountain. Five engines fire at once: eligibility, coding, prior-auth friction, appeal drafting, and payer-pattern detection."
- Click **FIRE ALL 5 ENGINES** → "That's not a canned demo response — it's reading the loaded denial codes (CO-29, PR-96, CO-4, CO-11) and building the same intervention list a denial manager would build by hand."

### Strategist — `hc-main-strategist.html`
- **◈ Run HC Strategist Analysis** (`#strat-run-btn`) — `runStrategist()`.
- **Quick-ask presets** (`quickAsk(...)`): Mesa Denial Spike, Board Brief, 99215 Defense, Site Variance Analysis — each fires a fully-scoped prompt with real dollar figures baked in (e.g. "$48K revenue at risk," "47 claims, $8,460").
- **⚡ GENERATE APPEAL FROM SELECTED CASE** — `tsmGenerateAppealFromSelectedCase()`.
- **◈ ANALYZE** (denial code breakdown) — `runDenialAnalysis()`.
- **◈ Medicare Strategy / ◈ Aetna Strategy** — payer-specific `quickAsk(...)` calls.
- **Escalate to Exec Portal** — `escalateToExecPortal()`.

**Talk points:**
- "The Strategist isn't starting cold — it inherited the fired-engine context from the war room. Watch: Board Brief." Click it. "That's a board-ready narrative with the 18.4% denial rate, the $48K at risk, and a recovery plan, generated in one click from data that already existed upstream."

### Executive Portal — `executive-portal.html`
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **⬇ Export Executive Report** (`#esc-export-btn`) — `exportExecutiveReport()`.
- **⚡ GENERATE / REFRESH DENIAL PACK** — `sbGenerateDenialPack()` / `generateDenialPack()`.
- **📋 GENERATE PHYSICIAN E/M TEMPLATE** — `sbGeneratePhysicianEMTemplate()`.
- **◈ RUN HC STRATEGIST ANALYSIS** (from within the exec portal itself) — `sbRunStratEngine()`.
- **✓ RELAY NOTE TO STRATEGIST** — `submitExecNote()` — closes the loop back down to the strategist layer.

**Close:** "Export Client Package — that's the board-ready PDF, generated from the exact same session data that started at the war room three screens ago."

---

## 2. Construction

**Path:** `html/war-rooms/construct-war/construction-war-room.html` → `construction-strategist.html` → `construction-executive-portal.html`

### War Room
- Nav bar: **STRATEGIST** / **EXECUTIVE** / **AUDITOPS** / **AUDITOPS PRO** — `goNav('construction-strategist.html')`, `goNav('construction-executive-portal.html')`, `goNav('auditops-tax.html')`, `goNav('construction-pro.html')`. AUDITOPS and AUDITOPS PRO are two separate apps sharing a name: AUDITOPS is the tax-intelligence tool (`auditops-tax.html`); AUDITOPS PRO is the construction BNCA app (`construction-pro.html`, titled "AuditOps // Sovereign Core" in-page). Don't conflate them in a demo.
- **⚡ FIRE ALL 6 ENGINES** (`#fireBtn`) — `fireEngines()`.
- **⚡ ESCALATE TO STRATEGIST →** — `escalateToStrategist()`.
- **EXPORT ANALYSIS** — `exportFull()`.
- **→ OPEN PERMITS & PROPOSALS / → OPEN FIELD & DOCUMENT OPS** — `tsmRouteToPermits()` / `tsmRouteToFieldOps()` — deep-links into adjacent modules.

**Talk points:**
- "Six engines: budget variance, retainage, lien waivers, pay-app matching, GL reconciliation, and compliance. Fire them together — this is the same close-day workload a project accountant runs manually across three systems."

### Strategist
- **Executive** sidebar link — direct `window.location.href` to the exec portal.
- **→ ESCALATE TO EXECUTIVE** — `escalateToExecutive()`.
- **◈ INJECT INTO STRATEGIST** — `injectWarRoomContext()` — pulls war-room findings into the active strategist session.
- **EXEC** issue-pack assignment — `assignConstIssuePack('Construction Executive')`.
- Top nav **AuditOps / Financial / Compliance** — these aren't inline Strategist panels (there's no `vp-auditops`/`vp-financial`/`vp-compliance` view), they're full standalone apps. `navTo()` now special-cases them via an `EXTERNAL_NAV_TARGETS` map and does a real `window.location.href` to `construction-pro.html`, `financial.html`, and `compliance-hub.html` respectively. Before this fix, clicking any of the three silently no-opped back to the Strategist view — worth knowing if you're comparing behavior against an older build or another vertical's Strategist.
- **AuditOps Pro anomaly feed** — `construction-pro.html` now loads `tsm-memory-engine.js` and calls `TSMMemory.registerAnomaly()` after each completed BNCA run (dedup'd by `CON_AUDITOPS_<CATEGORY>`, source `construction-pro`), so its findings land in the same cross-module `TSM_OPERATIONAL_MEMORY_V3` store that `construction-suite-expansion.html` (FieldOps) already wrote to — not a separate, siloed anomaly list.
- **Strategist → Sentinel relay** — `pushToSentinel()` writes `{ generatedAt, anomalies:[...] }` to `localStorage["TSM_CONSTRUCTION_STRATEGIST_RELAY"]`; `sentinel-center.html` reads that exact key (`'TSM_' + vId.toUpperCase() + '_STRATEGIST_RELAY'`) and its severity codes (`CRIT/HIGH/MED/LOW`) match `riskToSeverity()`'s output one-for-one — verified end-to-end by replaying both functions against a shared localStorage mock. **Caveat:** this only fires from `runConstructionBNCAFromRelay()` when `warRoomRelay` is populated — i.e., the Strategist was reached via a War Room hand-off (or a stored `tsm_construction_war_relay` relay). A cold Strategist session with a manual BNCA run never calls `pushToSentinel()`, so Sentinel keeps showing sample data for Construction until a real War Room hand-off happens.
- **Deadline-honesty guard** (verified 2026-08-27) — `CON_ENGINE_SYSTEM_GUARD` (`routes/construction.js:88`) constrains the engine's system prompt to only use deadlines/filing/payment-due dates explicitly present in the source document or data, writing `"NOT STATED IN SOURCE DOCUMENT"` rather than inferring one, and forbids marking documentation/approvals/filings as complete unless the source confirms it. A real regression once dropped this guard via a shadowed route; fixed in `d87ab84e` ("fix(construction): stop shadowed route from dropping engine safety guard") — safe to cite as a genuine reliability fix, not just a design intent.

### Executive Portal
- **STRATEGIST** nav — `nav('construction-strategist.html')`.
- **AUDITOPS** / **AUDITOPS PRO** nav — `nav('auditops-tax.html')` / `nav('construction-pro.html')` — same tax-vs-construction distinction as the War Room nav above.
- **AUTHORIZE** (`#d1-authorize-btn`, `data-action="approve"`) — `tsmConfirmExec()`.
- **OPEN** — routes back to strategist for a specific decision item.
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **OPEN STRATEGIST** (footer) — `nav('construction-strategist.html')`.

**Talk points:**
- "AUTHORIZE is a real state change — it flips the decision item's status and it's what unlocks the client package export."

---

## 3. FinOps

**Path:** `html/finops-suite/finops-war/finops-war-room.html` → `finops-main-strategist.html` → `finops-executive-portal.html`

### War Room
- Nav: **DOC ANALYSIS** — `nav('doc-analysis-tab.html')`; **STRATEGIST** — `nav('finops-main-strategist.html')`; **EXECUTIVE** — `nav('finops-executive-portal.html')`.
- **▶ GUIDED TOUR** — `startTour()`.
- **⚡ FIRE ALL 6 ENGINES** (`#fireBtn`) — `fireEngines()`.
- **⚡ ESCALATE TO STRATEGIST →** — `escalateToStrategist()`.
- **EXPORT ANALYSIS** — `exportFull()`.

### Strategist
- Two tabs: **▶ Strategist Report** / **⚡ 4-Engine Doc Analysis** — `switchTab(...)`.
- **Relay source chips** — `setRelaySource('exec', this)` — lets the strategist pick which upstream session (exec vs war room) feeds the report.
- **▶ Generate Strategist Report** (`#genBtn`) — `generateReport()`.
- **→ Relay to Executive Portal** (`#relayExecBtn`) — `relayToExecutive()`.
- **⚡ FIRE ALL 4 ENGINES** (`#fireBtn`) — `fireAllEngines()` — a second, doc-analysis-specific engine set.
- **📤 MGR EXPORT** / **→ PUSH TO STRATEGIST** — `managerExport()` / `pushDocToStrategist()`.
- **Log Approvals → Relay to Executive** — `submitApprovals()`.
- **▶ Run Strategist →** — `generateReport()` (CTA variant).

### Executive Portal
- Nav: **DOC ANALYSIS**, **STRATEGIST** — `nav(...)`.
- Decision card **STRATEGIST** button — `nav('finops-main-strategist.html')`.
- **⬇ EXPORT CLIENT PACKAGE** — `exportClientPackage()`.
- **OPEN STRATEGIST** — `nav('finops-main-strategist.html')`.

**Talk points:**
- "FinOps is the only vertical here with two separate engine stacks — 6 in the war room for GL/AP posture, 4 in the strategist for document-level analysis. Relay Source chips let the strategist decide which upstream context to pull from before generating the report."

---

## 4. Insurance

**Path:** `html/war-rooms/insure-war/insurance-war-room.html` → `insurance-strategist.html` → `insurance-executive-portal.html`

### War Room
- Nav: **STRATEGIST** / **EXECUTIVE** — `nav(...)`.
- **⚡ FIRE ALL 6 ENGINES** (`#fireBtn`) — `fireEngines()`.
- **⚜ ESCALATE TO STRATEGIST →** — `escalateToStrategist()`.
- **EXPORT ANALYSIS** — `exportFull()`.

### Strategist
- Nav: **EXECUTIVE** — `nav('insurance-executive-portal.html')`.
- **⚜ RUN STRATEGIST CHAIN** (`#runBtn`) — `runStrategist()`.
- **→ SEND TO EXECUTIVE PORTAL** — `escalateToExec()`.
- **EXPORT PACKAGE** — `exportPackage()`.

### Executive Portal
- Nav / decision-card **STRATEGIST** — `nav('insurance-strategist.html')`.
- **⬇ EXPORT CLIENT PACKAGE** — `exportClientPackage()`.
- **OPEN STRATEGIST** — `nav('insurance-strategist.html')`.
- **Decision Center (Approve/Hold/Reject)** — loads the shared `tsm-exec-portal-upgrade.js`, same as Healthcare/Legal/Construction/RE/FinOps/BPO. An **Approve** here auto-relays into the BPO Case Engine and shows up in that client's Client Portal rollup — see §14.5 below.

**Talk points:**
- "RUN STRATEGIST CHAIN is the phrase to watch — it's not one call, it's a chained sequence: claims triage → coverage analysis → reserve recommendation, in order, each step feeding the next."

**Engagement-model note (client-facing, not a demo talk point):** Insurance is queue-only, not full exception+correction like Healthcare/FinOps/Construction/Mortgage — pitch it as a bounded pilot (claims/document indexing, compliance research, licensing/CE admin), not a full-workload BPO commitment, until the correction layer's proven on real client volume. The upside to lead with: even at pilot scope, an Approved case here reaches the client's own portal automatically, same as it would for a mature vertical — that's real evidence to show a prospect, not a promise.

---

## 5. Legal

**Path:** `html/war-rooms/legal-war/legal-war-room.html` → `legal-main-strategist.html` (chief) — with `case-strategist.html` as a case-level intermediate layer → `legal-executive-portal.html`
**Correction (verified 2026-08-26):** the case-level `case-strategist.html` does NOT live in `html/war-rooms/legal-war/` alongside the other Legal files — it's actually at **`html/legal-pro/case-strategist.html`**. The nav links from `legal-war-room.html` (`nav('case-strategist.html')`, relative) still resolve correctly at runtime, but anyone navigating to the file directly needs the real path above.

### War Room
- Nav: **STRATEGIST** (case-level, `html/legal-pro/case-strategist.html`), **CHIEF STRATEGIST** (`legal-main-strategist.html`), **EXECUTIVE PORTAL** (`legal-executive-portal.html`) — three-deep chain, unique to Legal.
- **⚡ FIRE ALL 6 ENGINES** (`#fireBtn`) — `fireEngines()`.
- **⬇ EXPORT FULL REPORT** — `exportFull()`.
- **⚡ ESCALATE TO LEGAL CHIEF STRATEGIST →** — `escalateToChief()`.
- Footer links to all three downstream screens (Case Strategist, Chief Strategist, Executive Portal).

### Chief Strategist — `legal-main-strategist.html`
- **Escalate** link (`#escalate-btn`, href to exec portal) — `writeExecRelay(event)` fires on click before navigating, writing the relay payload.
- **Export Full Report** — `exportFullReport()`.

### Executive Portal
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **APPROVE** — `authorizeAction(this, 'Discovery Expansion')` — a named, case-specific authorization action (differs from the generic AUTHORIZE seen in other verticals).
- **Litigation Node** (verified 2026-08-27, `legal-war-room.html`) — one of ten specialist apps in the routing recommendation list (alongside Case Strategist, Contracts Node, Compliance Node, Discovery Node, Billing Node, Employment Node, Settlement Node, Chief Strategist); ranks #3 by default. Surfaces procedural risk, venue analysis, and motion sequencing off the Exposure Assessment tab once damages figures and litigation stage are entered — worth citing as a concrete engine, not just a routing label.

**Talk points:**
- "Legal is the deepest chain on the platform — case-level strategist *and* a chief strategist above it, because a single case escalates to the case strategist, but portfolio-wide legal risk escalates to the chief. Two altitudes, one platform."
- "APPROVE isn't generic — it's tied to a named action, 'Discovery Expansion,' logged with that label in the audit trail."

---

## 6. Real Estate (RE)

**Path:** `html/war-rooms/re-war/re-war-room.html` → `re-strategist.html` → `re-exec-portal.html`
*(Real Estate and Mortgage share one operating chain in this build — see §7 for the Mortgage-specific screens.)*

### War Room
- **↗ ESCALATE → STRATEGIST** — `escalateToStrategist()`.
- **Quick-fire presets** — `quickFire('...')` — cross-node synthesis, highest-risk deal, compliance sweep (TRID/HMDA/Fair Housing/FinCEN), REO disposition, market intel — each a fully-scoped prompt, not a generic button.
- **Engine buttons** (01–04): Acquisition, Finance, Transaction, Mortgage Ops — each its own `quickFire(...)` call.

### Strategist — `re-strategist.html`
- **↗ ESCALATE → EXEC PORTAL** — `escalateToExec()` (appears twice: toolbar and results panel).
- **↓ EXPORT** / **↓ EXPORT (.TXT)** — `exportReport()`.
- **30-day action plan** preset — `quickStrat('...')`.

### Exec Portal — `re-exec-portal.html`
- Sidebar: **RE Strategist** — `goto('/html/war-rooms/re-war/re-strategist.html')`.
- **Export Full Session / Export Board Report** — `exportSession()` / `exportBoard()`.
- **⚡ GENERATE BRIEF** / **🔴 DEAL RESCUE** — `generateBrief()` / `generateBrief('rescue')`.
- **⚡ AI-GENERATE ACTION ITEMS** — `generateActions()`.
- **⚡ REFRESH PIPELINE ANALYSIS** — `generatePipeline()`.
- **⚡ GENERATE BOARD REPORT** — `generateBoard()`.

**Note:** RE's exec portal is the one screen in this set with **no** `exportClientPackage()` wiring — it uses `exportSession()` / `exportBoard()` instead. Don't promise "Export Client Package" on this specific screen; use "Export Board Report."

**Talk points:**
- "🔴 DEAL RESCUE is worth calling out by name — same generator as the standard brief, but scoped specifically to a deal that's about to fall apart, with an amber visual treatment so it reads as urgent in the sidebar."

---

## 7. Mortgage

**Path:** `html/war-rooms/mortgage/mortgage-war-room.html` → `mortgage-strategist.html` → `mortgage-executive-portal.html`

### War Room
- **LOAD SAMPLE DATA / RESET SAVED DATA** (`#btnLoadSample`, `#btnResetData`) — event-listener bound, not inline onclick.
- **RUN AI ANALYSIS** (`#btnRunAnalysis`) — `runAnalysis()`.
- **RELAY TO STRATEGIST →** (`#btnRelay`) — `relayToStrategist()`.

### Strategist
- **Export** (`#printBtn`) — `window.print()` (this vertical uses print-to-PDF rather than a custom export function).
- **Executive View →** — plain `<a href="mortgage-executive-portal.html">`, no relay-write on click.

### Executive Portal
- **Export** (`#printBtn`) — `window.print()`.
- **↳ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **✓ ACKNOWLEDGE** — `recordExecAction('acknowledged', ...)`.
- **↑ ESCALATE** — `recordExecAction('escalated', ...)` — notifies the closing manager per the toast copy.

**Talk points:**
- "Mortgage is the template the Schools vertical was built from — notice the pattern: sessionStorage *and* localStorage both get written on relay, so the strategist picks it up whether it's the same tab or a new one."
- "ACKNOWLEDGE and ESCALATE are both logged actions, not just UI state — they write to the relay/audit trail with a specific message string, visible if you check the event log."

---

## 8. Schools

**Path:** `html/war-rooms/schools-command/schools-command.html` → `schools-strategist.html` → `schools-executive-portal.html`

### War Room — `schools-command.html`
- **🧠 Strategist →** (`#tsm-chain-strat`) — link to `schools-strategist.html`.
- **🤖 Run AI Analysis** (`#schBtnRunAnalysis`) — `schRunAnalysis()`, which:
  1. Runs the engine (`engine.runAnalysis()`).
  2. Writes the relay payload to **both** `sessionStorage` and `localStorage` under `TSM_SCHOOLS_RELAY` (`schWriteRelay`).
  3. Fires a `TSM_RELAY_EVENT` custom event for same-tab listeners (since the native `storage` event only fires cross-tab).
  4. Creates a Mission Core record (`schCreateMissionFromRelay()`).
  5. **Fails gracefully:** if the AI call itself errors, KPI/financial data still relays so downstream screens don't go dark.
- **Prompt library** (`loadPrompt(...)`) — pre-scoped compliance prompts: subrecipient monitoring, single audit / SEFA, grant closeout, ESSER allowable use, MOE, 501(c)(3) / Form 990, bond arbitrage (IRC §148), excess benefit transactions (IRC §4958), ADA/504, SOX 302/906, cybersecurity/CISA K-12.

### Strategist
- **Export** (`#printBtn`) — `window.print()`.
- **Executive View →** — plain link to `schools-executive-portal.html`.
- **← Command Center** — plain link back to `schools-command.html`.

### Executive Portal
- **Export** (`#printBtn`) — `window.print()`.
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **✓ ACKNOWLEDGE** — `recordExecutiveAction('ACKNOWLEDGED', ...)`.
- **↑ ESCALATE** — `recordExecutiveAction('ESCALATED', ...)` — copy references notifying the program officer.

**Talk points:**
- "This is a K-12/school-district compliance desk — the prompt library alone covers federal grants, tax-exempt status, bond compliance, and cybersecurity. That breadth is the pitch: one operator screen, eleven distinct regulatory domains."
- "Run AI Analysis is the one button on this whole platform that's documented to fail *safely* — if the model call errors, the KPI relay still fires so the strategist and exec screens don't show stale or blank data."

---

## 9. PM Copilot

**Path:** `html/war-rooms/pm-copilot/pm-command.html` → `pm-strategist.html` → `pm-exec-portal.html`
**Relay key:** `TSM_PM_COPILOT_RELAY` (`RELAY_KEY_FALLBACK`) / `TSM_PM_STRATEGIST_RELAY`

### War Room — `pm-command.html`
- **Vendor dispatch** — `dispatchVendorTransport(workOrderId, vendorId)` — assigns a vendor to a specific work order, not a generic action.
- **Quick-fire presets** — `pmQuickFire('compliance')` / `pmQuickFire('finance')` / `pmQuickFire('market')`.
- **RUN AI ANALYSIS** (`#btnAnalyze`) — event-listener bound, not inline onclick.
- **LOAD SAMPLE DATA / RESET SAVED DATA** (`#btnLoadSample` / `#btnResetData`) — event-listener bound.
- **RELAY TO STRATEGIST** (`#btnRelay`) — `relayToStrategist()`, event-listener bound — same Mortgage/Schools/HotelOps relay convention (sessionStorage + localStorage + `TSM_RELAY_EVENT`).

### Strategist — `pm-strategist.html`
- **Export** — `window.print()` (print-to-PDF, same as Mortgage/Schools, not a custom export function).
- `window.runInphusionWarRoomScenario()` — demo-scenario trigger.
- Executive View — plain link, no relay-write on click.

### Executive Portal — `pm-exec-portal.html`
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`.
- **✓ ACKNOWLEDGE** — `recordExecAction('acknowledged', 'Portfolio snapshot reviewed and signed off by executive')`.
- **↑ ESCALATE** — `recordExecAction('escalated', 'Escalation flagged — notify regional PM manager')`.
- **Export** (`#printBtn`) — `window.print()`.

**Talk points:**
- "PM Copilot follows the newer Mortgage-style relay convention — event-listener bound buttons, dual-storage relay — not the legacy inline-onclick pattern Legal/Construction/FinOps/Insurance use."
- "Vendor dispatch is a real state change tied to a specific work order and vendor ID, not a generic demo button."

### Executive Portal — decision/intelligence stack (verified live 2026-08-28)
PM Copilot's Executive Portal is no longer just the sign-off panel above — it now stacks four generated panels underneath it, each backed by its own server engine and its own `requireRole(['admin','manager','analyst'])`-gated POST route (Phase 5 "governed control plane" — every `/api/pm/*` route, not just these four, now requires an authenticated internal role; there is no anonymous PM API access left):

- **Executive Decision Queue** (`pm-decision-bridge.js` → `POST /api/pm/executive-decisions` → `server/pm/decision-engine.js`) — deterministic (`"confidence":"DETERMINISTIC"`, no LLM) priority ranking across IoT, vendor-compliance, and maintenance-SLA findings, each with a dollar exposure, an owner, and an action. Was previously reading the wrong relay shape and always rendering zero decisions; fixed (`7a436c67`) by pointing `findRelayPayload()` at the canonical `TSM.relay.read('PM')` / `TSM_PM_RELAY` payload instead of a stale key. Explicit governance flags on the response: `humanApprovalRequired: true`, `writeBackToSourceSystems: false`.
- **Portfolio Intelligence** (`#tsm-pm-intelligence-v2` → `POST /api/pm/portfolio-intelligence` → `server/pm/portfolio-intelligence.js`) — builds a "portfolio twin" (unit/lease/work-order counts) and layers `risk-engine.js` (Portfolio Risk score /100) and `forecast-engine.js` (forward exposure) on top of it.
- **PM Intelligence V3 · Action Center** (`#tsm-pm-intelligence-v3` → `POST /api/pm/intelligence-v3` → `server/pm/intelligence-v3.js`) — turns the V1 decisions into a Decide → Execute → Verify → Explain action queue (`action-engine.js` builds it, `verification-engine.js` closes it: `POST /api/pm/actions/verify` marks an action `verified`/`NOT_VERIFIED` and records exposure before/after).
- **Portfolio Risk Outlook** (`#tsm-pm-intelligence-v4` → `POST /api/pm/predictive-control` → `server/pm/predictive-control.js`, engine id `pm-predictive-control-v1`) — the forward-looking layer: "V1 Decision Engine = what is known now, V3 Intelligence = what action should be governed, V4 Predictive = what is likely to happen next," per the file's own header comment. Explicitly deterministic — no LLM in the predicted-exposure calculation.

**Talk points:**
- "Watch the Executive Portal load four panels, not one — sign-off, then a ranked decision queue with real dollar exposure, then a portfolio risk twin, then a predictive outlook. Each one is a separate governed engine, not four views of the same JSON."
- "Every one of these calls is deterministic and role-gated — no LLM guessing the priority ranking, and no PM API route left open to an unauthenticated session."

**Local dev / curl testing note (fixed 2026-08-28, `98acb70e`):** `/api/auth/login` used to set `tsm_session` with `Secure` hardcoded, which browsers and `curl` both refuse to send back over plain `http://localhost` — every role-gated `/api/pm/*` call would silently 401 in local dev even with a correct password. `Secure` is now conditional on `NODE_ENV === 'production'`. To smoke-test any of the four panels above locally:
```
curl -sc /tmp/j.txt -H "Content-Type: application/json" -X POST http://localhost:8080/api/auth/login -d "{\"password\":\"$TSM_ADMIN_PASSWORD\"}" >/dev/null
curl -b /tmp/j.txt -H "Content-Type: application/json" -X POST http://localhost:8080/api/pm/intelligence-v3 -d '{"decisions":[...]}'
```
`intelligence-v3` verified live end-to-end this way on 2026-08-28: `200 OK`, correctly built `ACT-*` action from a synthetic `decisions[]` payload, correct `actionSummary` rollup, `verification.required: true` / `verified: false` as expected pre-approval.

---

## 10. BPO

**Path:** `html/war-rooms/bpo-war/bpo-war-room.html` → `bpo-strategist.html` → `bpo-executive-portal.html`

### War Room — `bpo-war-room.html`
- Document intake and classification, feeding the strategist's structured extraction.

### Strategist — `bpo-strategist.html`
- Strategy brief generation from the intake document; escalates to the exec portal with a `caseId`.

### Executive Portal — `bpo-executive-portal.html`
- **⬇ EXPORT EXEC BRIEF** / **EXPORT BRIEF** / **⬇ EXPORT** (three separate buttons, `#dc-export-btn` among them) — all call `exportBrief()`.
- **Note: BPO does NOT use `exportClientPackage()` / `tsmk-delivery-btn`** — it's the second exception on the platform (after Real Estate). `exportBrief()` builds a plain-text session report instead of the JSON delivery package, pulling `stratData`, the resolution audit (`lastResolutionAudit` — anomaly, status, detected/resolved timestamps), and the cross-vertical supervisor rollup (`lastSupervisorRollup` — total/open/closed/late mission counts by vertical), each only included when that panel actually loaded real data.
- Decision Center action toggles (approve / assign owners / notify stakeholders) get folded into the exported brief as a "DECISION CENTER ACTIONS TAKEN" section.
- **⚙ Manage Clients** (top bar) — links to `/html/bpo-clients-admin.html`. This is the actual on-ramp to the client-facing portal (below), not a dead-end admin screen.

### Client Admin → Client Portal (the real external client-facing chain)
This is a separate hop from the internal War Room → Strategist → Executive Portal chain above, and it's the part that actually reaches real clients, not TSM staff:

- **`bpo-clients-admin.html`** (reached via Executive Portal's "⚙ Manage Clients") — creates client logins and shows a one-time **access code** (`setAccessCodeBanner()` — the code can't be recovered later, only rotated, so this is the one chance to hand it to the client). Also links a client login to a cross-vertical **Member** (`saveTenantLink()` → `PATCH /api/bpo/clients/:id` with `{tenantId}`). Linking switches that client's rollup from a single-`clientId` BPO-only view to the Member's full cross-vertical case rollup (`bpoBuildMemberClientRollup`, per the comment at `server.js:385-392`). Unlinking (`clearTenantLink()`) reverts it to work-items-only.
- **`login.html`** — on successful auth, role-routes: `data.role === 'client' ? '/client-portal.html' : '/suite-hub.html'`. This is the only place `client-portal.html` is linked from — it isn't reachable via any button inside the internal BPO chain, only via the client's own login.
- **`html/client-portal.html`** ("TSM Client Portal") — the actual page a real client sees. Confirmed it's backed by live BPO endpoints, not sample data: `GET /api/bpo/reports/client-rollup` (summary cards + SLA events), `GET /api/bpo/work-items/:caseId/documents` (expand-a-case-row to list docs), `GET /api/bpo/documents/:docId/download`. All gated by `BPO_CLIENT_VIEW_ROLES = [...BPO_INTERNAL_ROLES, 'client']` in `server.js`, so a client-role session sees only its own rollup.

**Talk points:**
- "BPO's export is a real text-file executive brief, not the JSON package the other verticals use — and it explicitly says so in its own footer: 'nothing here is re-derived or estimated at export time.'"
- "It's also the only exec portal on the platform that pulls in the cross-vertical supervisor rollup — mission counts across every other domain, not just BPO's own."
- "BPO is the only vertical with a genuine external client-facing app in this repo. Everything else we've walked through today is internal tooling — this is the one page an actual client logs into and sees their own case rollup and documents, nothing more."
- "Linking a client to a Member is what turns their view from 'just their BPO work items' into 'everything that Member has going on across verticals' — that's a real behavior change in the rollup query, not a cosmetic label."

### Slack Notifications on Case Resolution (new)
- `server/integrations/slack-notifier.js` — a one-way Incoming Webhook POST (no OAuth, no bot token, no Slack App) wired non-fatally into `bpoUpsertWorkItem()`, the same function every War Room → Strategist → **✓ MARK EXECUTED** transition already runs through.
- Off by default: requires `SLACK_BPO_NOTIFY_ENABLED=true` and a real `SLACK_BPO_WEBHOOK_URL` (same on/off-switch pattern as `SERVICENOW_INTEGRATION_ENABLED` on the L1 Copilot ServiceNow adapter). Credentials can be staged as Fly secrets ahead of time without anything going live.
- Notifies only on the client-visible **resolved** transition by default — War Room create and Strategist advance stay silent so a real channel doesn't flood with every internal hop. `SLACK_BPO_NOTIFY_EVENTS=opened,advanced,resolved` opts into full-lifecycle noise if wanted.
- A Slack delivery failure is deliberately non-fatal (try/catch, same pattern as the existing SLA-event write) — a case can never fail to resolve because Slack is down or misconfigured.
- Full detail and demo steps: `BPO_CLIENT_WALKTHROUGH.md` §7.

**Talk point:**
- "A client's team doesn't have to be logged into their portal to know a case closed — Slack tells them the moment MARK EXECUTED fires, and it can't take down the actual case update if Slack itself is down."

---

## 11. HotelOps

**Path:** `html/hotelops/hotelops-war-room.html` → `hotelops-strategist.html` → `hotelops-executive-portal.html`

### War Room — `hotelops-war-room.html`
- **RUN AI ANALYSIS** (`#btnAnalyze`), **RELAY TO STRATEGIST** (`#btnRelay` → `relayToStrategist()`), **LOAD SAMPLE DATA / RESET SAVED DATA** — all event-listener bound, same Mortgage-style relay convention.
- **IoT sensor import** — `#navIotSensors`, `#btnIotImportPreview` / `#btnIotImportCommit` — a preview-then-commit two-step flow unique to this vertical, for importing IoT maintenance-sensor data.

### Strategist — `hotelops-strategist.html`
- **Export** — `window.print()`.

### Executive Portal — `hotelops-executive-portal.html`
- **⬇ EXPORT CLIENT PACKAGE** — `exportClientPackage()`, now wired with real `financials`, maintenance/compliance/Airbnb risk data, and portfolio data as a sections passthrough (fixed 2026-08-26).
- **✓ ACKNOWLEDGE / ↑ ESCALATE** — `recordExecutiveAction(...)`.

**Talk points:**
- "The IoT import is a genuine preview-then-commit flow — you see exactly what's about to be imported before it commits, not a one-click black box."

---

## 12. Concierge

**Path:** `html/concierge/concierge-war-room.html` → `concierge-strategist.html` → `concierge-executive-portal.html`

### War Room — `concierge-war-room.html`
- **Live mission actions** — `bookQuote(quoteId)`, `cancelMission(bookingId)`, `refreshMission(bookingId)`, `simulateEvent(bookingId, nextStatus)` — all tied to a specific booking, not generic buttons.
- **Status filters** — `setFilter('confirmed' | 'en_route' | 'completed' | 'cancelled' | '')`.
- `loadMissions()` — refreshes the live mission list.

### Strategist — `concierge-strategist.html`
- **confirmToExec()** — the strategist-confirmation gate that unlocks the exec portal's content (same `TSM_STRAT_CONFIRMED_<DOMAIN>` gate pattern used elsewhere).
- `loadAll()` — pulls the live mission set into the strategist view.

### Executive Portal — `concierge-executive-portal.html`
- **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) — `exportClientPackage()`, now wired with real KPI totals (total/open/completed/exceptions/spend) as a sections passthrough (fixed 2026-08-26) — previously the actual dollar spend figure never reached the export.

**Talk points:**
- "Concierge is the one vertical built around live dispatched transport missions rather than document-driven case work — bookQuote/cancelMission/simulateEvent are all real state transitions on a specific booking ID."

---

## 13. Honeywell (Plant / Supplier / Cyber-OT / BESS / Advanced Detection)

**Path:** five parallel scenario-specific entry points — `html/plant-incident.html`, `html/supplier-shutdown.html`, `html/cyber-incident.html`, `html/war-rooms/bess-gigafactory-incident.html`, and `html/war-rooms/advanced-detection-incident.html` — each converging into one shared `html/war-rooms/honeywell-strategist.html` → `html/war-rooms/honeywell-executive-portal.html` chain.

**Structural note:** Honeywell uses multiple scenario-specific war rooms rather than one universal incident screen. Plant, supplier, cyber-OT, BESS/Gigafactory, and Advanced Detection have different first-response data and workflows, but leadership converges on the same Strategist and Executive Portal.

### War Room — Plant / Supplier / Cyber-OT

- **plant-incident.html** — `⚡ ESCALATE TO OPERATIONS STRATEGIST →` (`#escalateBtn`, disabled until conditions are met) — `escalateToStrategist()`.
- **supplier-shutdown.html** — `⚡ ESCALATE TO SUPPLY CHAIN STRATEGIST →` — `escalateToStrategist()`.
- **cyber-incident.html** — `🛡 ESCALATE TO OPERATIONS STRATEGIST →` — `escalateToStrategist()`.
- All three target the same `STRATEGIST_URL = '/html/war-rooms/honeywell-strategist.html'`.

### BESS / Gigafactory War Room — `bess-gigafactory-incident.html`

- Six-engine incident pipeline covering detection/context, facility impact, failure progression, financial exposure, response planning, and executive dispatch.
- Documented operating facts: **20 MW nameplate power**, **80 MWh installed energy capacity**, LFP chemistry, and output curtailed to **65% of contracted capacity**.
- Re-energization decision window: **12–24 hours**.
- Conditional module-replacement lead time: **3–5 weeks if thermal runaway is confirmed and replacement is required**.
- Financial exposure: **$400,000–$600,000 TSM planning estimate / assumption**, not a source-provided confirmed cost.
- Root cause must remain explicitly unconfirmed unless supported by incident evidence.
- Decision costs remain `NOT QUANTIFIED` unless the source provides an actual cost.
- Routes into the shared Honeywell Strategist → Executive Portal chain.

### Advanced Detection War Room — `advanced-detection-incident.html`

- Early-warning detection command scenario using BESS off-gas alerts, Gigafactory off-gas alerts, VESDA particulate alerts, and facility shutdown logs.
- Six engines:
  1. Detection Intelligence
  2. Facility Impact
  3. Failure Progression
  4. Exposure Calculation
  5. Response Plan
  6. Executive Dispatch
- Uses the canonical `/api/war-room/stream` surface.
- Detection-to-decision workflow is explicitly a **training / decision-support simulation**, not a live sensor feed or facility control system.
- It does not command, arm, or trigger real suppression, isolation, or shutdown equipment; actual site fire/life-safety systems and AHJ-approved procedures remain authoritative.
- Routes into the same shared Honeywell Strategist → Executive Portal chain.

### Strategist — `honeywell-strategist.html`

- **→ Escalate** — `escalateExec()`.
- Receives scenario-specific decision packages from all five Honeywell entry points.
- Scenario shortcuts can return to the applicable Honeywell war room.
- Executive escalation continues to `honeywell-executive-portal.html`.
- `manualRefresh()` and **Export** — `window.print()`.

### Executive Portal — `honeywell-executive-portal.html`

- **⬇ EXPORT CLIENT PACKAGE** — `exportClientPackage()`.
- **AUTHORIZE** — `recordExecutiveAction('AUTHORIZED', ...)`.
- **BOARD NOTIFIED** — `recordExecutiveAction('BOARD_NOTIFIED', ...)`.
- `AUTHORIZED` and `BOARD_NOTIFIED` are separate named executive actions and should remain separately represented in the audit trail.
- Scenario navigation can return to the applicable Honeywell war room.

**Talk points:**
- "Honeywell now has five scenario front doors — plant incident, supplier shutdown, cyber-OT, BESS/Gigafactory, and Advanced Detection. Each represents a genuinely different first-response context, but all converge on one strategist and one executive view."
- "BESS handles the incident-command side of battery/gigafactory events, while Advanced Detection handles the early-warning sensor side. They are complementary, not duplicate war rooms."
- "BOARD NOTIFIED is a named, distinct executive action from AUTHORIZE, which is important for auditability and governance."

**Client-facing status:** Honeywell remains an internal build/backlog vertical and should **not** be represented as pilot-ready solely because these additional scenario rooms are documented.


## 14. L1 Ticket Copilot (IT Ops)

**Path:** does not follow the War Room → Strategist → Executive Portal pattern. It's four peer apps under `html/l1-copilot/`, linked hub-style and connected by a lightweight relay, not an escalation chain: `enterprise-command-center.html` (hub) → `l1-ticket-copilot.html` → `vmware-copilot.html`, plus `topology.html` (digital twin view) reachable from the hub independently.

### Enterprise Command Center — `enterprise-command-center.html`
- Hub page — links out to Ticket Copilot, VMware Copilot, and NOC Command.
- **Assistant bubble** (`#l1a-fab`) — opens a chat panel wired to a real backend, `POST /api/l1-copilot/assistant` (confirmed live in `server.js`), not a canned response. The same bubble/backend is present on all four pages in this folder.

### L1 Ticket Copilot — `l1-ticket-copilot.html`
- **Ticket** tab active by default; incident number field is `#tkIncident`.
- **VMware SME** sidebar item (`data-section="vmware"`) — switches to VMware troubleshooting fields (Component/Category/Environment).
- **"OPEN FULL VMWARE OPERATIONS MODULE →"** (`#btnOpenVmwModule`) — writes ticket ID, issue summary, component, category, and environment to `window.TSM.relay.write('VMWARE_COPILOT', {...})` before opening `vmware-copilot.html` in a new tab. Confirmed the relay domain is registered (`VMWARE_COPILOT: "TSM_VMWARE_COPILOT_RELAY"` in `relay.core.js`) — this hop is real, not a dead write.

### VMware Copilot — `vmware-copilot.html`
- **Context banner** (`#ctxBanner`) — populated from `window.TSM.relay.read('VMWARE_COPILOT')`, showing the ticket ID/summary carried over from Ticket Copilot.
- Component/Category/Environment dropdowns pre-fill from that same relay read — not re-entered by hand.

### Topology (Digital Twin) — `topology.html`
- Live digital twin view, reachable from the hub.
- Also carries the `#l1a-fab` assistant bubble.

**Talk points:**
- "Every page in this platform has the same assistant one click away — you're never more than a chat bubble from help, no matter which tool you're in."
- "That VMware module click just fired a real relay write — ticket ID, component, category, and environment currently on screen get handed off behind the scenes. Nothing here is a canned demo payload."
- "This is the same relay pipeline the platform uses everywhere — write once on one page, read on the next. No copy-pasting ticket details between tools."

**Known-fixed issue (worth knowing if comparing against an older build):** the VMware Copilot context banner and pre-filled dropdowns didn't work in an earlier pass — the `VMWARE_COPILOT` relay domain was missing from the registry. That's fixed; the hop is verified end to end now.

**Supporting materials:** `tests/playwright/l1-platform-workflows.spec.js` (automated reachability/nav-link/relay-round-trip coverage for all four pages); `tests/e2e/demo/screenshots/l1-platform-demo.mp4` (screenshot-driven walkthrough video); `html/l1-copilot/L1-Ticket-Copilot-Demo-Narrative.md` (source narrative this section is based on).

---

## 14.5 The Closing Loop — Executive Decision → BPO Case Engine → Client Portal

Every section above stops at the Executive Portal — the internal employee-facing screen. This is the step after that: what actually reaches the client. Verified against `server.js` (`POST /api/exec-portal/:vertical/decide`), not assumed from naming conventions.

**The mechanism:** every Executive Portal with a Decision Center (Approve / Hold / Reject) posts to `/api/exec-portal/:vertical/decide`. On **Approve**, the server auto-creates/updates a real BPO work item (`bpoUpsertWorkItem`) tagged to the case's resolved client — no analyst re-keys anything from an exported Client Package by hand. BPO itself is excluded from the relay only because it already writes work items directly through its own endpoint.

**Where it lands:** `bpo_cases` → `bpoBuildClientRollup()` → `GET /api/bpo/reports/client-rollup` (live) and `GET /api/bpo/reports/client-monthly` (snapshot) → `client-portal.html`, the one page a real client logs into (via `login.html`, role-routed).

**Coverage — confirmed wired vs. not:**

| Vertical | Decision Center? | Reaches Client Portal on Approve? |
|---|---|---|
| Healthcare | Yes (shared script) **+** a second, independent sync at the War Room stage (`syncStructuredCaseToEngine()`, fires every pipeline run) | Yes — twice over |
| Legal, Construction, Real Estate, Insurance, FinOps | Yes (shared `tsm-exec-portal-upgrade.js`) | Yes |
| Mortgage, PM Copilot, Schools, HotelOps, Honeywell | Yes (direct inline call to the same endpoint) | Yes |
| BPO | Yes — own dedicated endpoint, not this relay | Yes — direct |
| **Concierge** | **No — not a registered exec-portal vertical at all** | **No** |
| **College Command** | **No — registered server-side, but no page calls the endpoint** | **No** |
| L1 Ticket Copilot | No — internal IT tooling, not client-facing | N/A |

**Talk point / training note:** For every "Yes" row, **Approve is the action that makes a case visible to the client** — not the export button. Concierge and College Command are the two real gaps: an approved case there does not reach the client automatically today; it has to be entered into BPO manually via `bpo-clients-admin.html` if a client needs to see it. That's a platform gap, not an employee-training gap — don't tell someone they did it wrong if a Concierge or College case doesn't show up in a client's portal.

**Recovery note:** A case sitting on Hold, or never opened, never reaches the client — regardless of vertical. An idle Executive Portal queue is client-invisible revenue-recovery work, not just an internal backlog.

---

## RCM-OS (standalone — not part of the War Room chain)

**Path:** `html/finops-suite/tsm-rcm-os.html` (single self-contained page), with `tsm-rcm-os-howto.html` and `rcm-os-presentation.html` as companion docs/demo.

RCM-OS ("Reconciliation Command Center") does not follow the War Room → Strategist → Executive Portal pattern at all — there's no escalation chain, no relay, and no `exportClientPackage()`. It's a standalone GL-reconciliation simulation tool that lives under the FinOps suite. Don't describe it in three-tier-chain language in a demo; it's a different kind of artifact.

---

## Candidate Intelligence — Career Training Platform (Staff Readiness &amp; Candidate Registry)

**Path:** `html/tsm-career-training-platform.html` (single page, panel-switched via `switchTo()`), fed by the Candidate Registry API (`POST /api/candidates`, `POST /api/candidates/:id/training-events`) rather than a War Room/Strategist/Executive Portal chain.

**Structural note:** like RCM-OS, this is a cross-suite capability, not a 14th chained vertical — there's no escalation relay here. It provides one canonical candidate record (Candidate Registry) that Career Training and Staffing Readiness both read from, so a candidate's readiness evidence only has to be recorded once.

### Candidate Registry — `panel-registry` (nav `02 · Candidate Registry`)

- Manager-facing roster (`registryTbody`) showing every active candidate across sectors: assigned course, progress, readiness score, status, and approval state.
- Candidates only see their own assigned curriculum; the roster view is manager-only.
- Footer nav chains to `panel-profile` (Candidate Profile, `03`) and back to `overview`.

### Candidate Readiness Tracker — `panel-readiness` (nav `05 · Readiness Tracker`, under "Assessment & Approval")

- Live explainability panel (`overall-score`, `readiness-bar`) computing an overall readiness percentage from a documented, non-fabricated formula: sector-tool completions (40%) + cert-prep status (35%) + governance-checkpoint adherence (25%).
- Per-sector checklists (`readiness-check` checkboxes, `updateReadiness()`) across all 7 sectors (Healthcare, FinOps, Insurance, Real Estate, BPO, and others further down the panel) plus 6 cert tracks.
- Feeds a placement-status readout (`placement-status`) and an exportable audit trail — the same explainability-contract pattern used elsewhere in the platform, described here as compliance-ready structured JSON/PDF.
- Footer nav chains to `panel-governance`.

**Talk points:**
- "Candidate Registry is the canonical record — Career Training and Staffing Readiness both read the same readiness evidence instead of keeping their own copies."
- "The Readiness Tracker's score isn't a black box — it's a documented weighted formula against real checklist completions, the same honesty pattern the rest of the platform holds to."
- "This is included in the client/interview-facing demo walkthrough alongside the Meridian Industrial incident-command set — it demonstrates the same canonical-record pattern in a staffing context, without needing a live backend."

**Client-facing status:** unlike Honeywell, this one is demo-ready — Candidate Registry and Readiness Tracker are explicitly called out for inclusion in client/interview-facing demos (see `html/document-processing-revenue-recovery-manual.html`, §CI).

**Supporting materials:** the Candidate Intelligence flow (Assessment → Candidate Record → Readiness Event → Evidence Promotion → Career/Staffing Consumption) is documented in full in the Revenue Recovery Manual's §CI, including lifecycle-status values (`in_training`, `needs_review`, `ready_for_placement`) and the ownership boundaries between Candidate Readiness V2, Candidate Registry, Career Training, and Staffing Readiness.

---

## Cross-Vertical Patterns Worth Naming in a Demo

1. **Escalation is state, not just navigation.** Most "Escalate" buttons (`escalateToStrategist`, `escalateToExec`, `writeExecRelay`, `schWriteRelay`, `escalateExec`) write a payload to storage *before* moving screens — the receiving screen reads real data, it isn't just a link.
2. **Two relay mechanisms coexist.** Legacy verticals (Legal, Construction, FinOps, Insurance, Concierge, BPO, Honeywell) use dedicated JS functions per action, mostly inline `onclick`. Newer ones (Mortgage, Schools, PM Copilot, HotelOps) standardized on a shared relay pattern: event-listener-bound buttons, `sessionStorage` + `localStorage`, and a custom `TSM_RELAY_EVENT` for same-tab updates.
3. **`exportClientPackage()` is the common exec-portal export**, present on HC, Construction, FinOps, Insurance, Legal, Mortgage, Schools, PM Copilot, HotelOps, Concierge, and Honeywell — 11 of the 13 chained verticals. **Two exceptions:** Real Estate uses `exportSession()` / `exportBoard()`, and BPO uses `exportBrief()` (a plain-text session report, not the JSON package). Don't promise "Export Client Package" language on either of those two exec portals.
4. **ACKNOWLEDGE / ESCALATE with logged messages** (Mortgage, Schools, PM Copilot, HotelOps, Honeywell's AUTHORIZE/BOARD_NOTIFIED) is the most audit-trail-forward pattern — worth showing to a compliance-sensitive buyer.
5. **Legal is the only three-tier vertical chain** (case strategist → chief strategist → executive) — call this out explicitly since every other chained vertical is a flat three-screen chain. **Honeywell is structurally unique in the other direction** — one strategist/exec-portal pair fed by three separate scenario-specific war rooms (plant / supplier / cyber-OT), rather than one war room per chain.
6. **RCM-OS sits outside this pattern entirely** — a standalone reconciliation tool with no War Room / Strategist / Executive Portal chain. Don't describe it in three-tier-chain language in a demo.
7. **The Decision Center's Approve action, not the export button, is what reaches the client** — see §14.5. Confirmed wired for 12 of 14 exec-portal verticals; Concierge and College Command are real gaps, not training gaps.

---

*Verified against live source in `tsm-rcm` repo. All onClick/event-listener bindings above were confirmed by direct grep against the HTML files, not inferred from naming conventions. §1–8 verified 2026-08-19; §9–13 and RCM-OS added and verified 2026-08-26, alongside a path correction to Legal's case-strategist location.*

*Re-audited 2026-08-26 against `origin/main` @ `e45cd205`: every file path, escalation function, export function, and button ID across all 13 chained verticals plus RCM-OS re-confirmed present and wired exactly as documented — including the RE and BPO `exportClientPackage()` exceptions, HotelOps' `sections: {financials, riskRegister, portfolio}` passthrough, and Concierge's `lastKpis` passthrough. The healthcare hub nav fix (`ec82fc37`) was independently re-verified: all 13 rewritten links resolve to real files. No drift found; no corrections required.*

*Re-audited 2026-08-28: the Slack Notifications section (BPO, added after the 2026-08-26 pass) checked against live source — `server/integrations/slack-notifier.js` require and call site confirmed in `server/tsm-ledger-service.js`, default-off gating (`SLACK_BPO_NOTIFY_ENABLED` + `SLACK_BPO_WEBHOOK_URL`) confirmed, non-fatal try/catch confirmed, `resolved`-only default confirmed, and the "19-assertion regression test" claim confirmed by running `scripts/test-bpo-slack-notify.js` (19/19 pass). No `SLACK_BPO_*` env var is set anywhere in CI/config, so the feature stays genuinely off by default. No drift found. This file also absorbs the duplicate `MASTER_VERTICAL_WALKTHROUGH (2).md`, which diverged only in missing this Slack section — that copy has been deleted; this is the single canonical version going forward.*

*2026-08-29 (morning): a Playwright crawl of all 40 `suite-hub.html` links against a live logged-in session found the Executive Portal 401 pattern documented in the "PRE-DEMO CHECK" section near the top of this file — added as a flag for Monday's presentation, not yet root-caused or fixed. That entry was written from static source review only (`middleware/require-auth.js`, the `NODE_REPORTS_API` pattern) — no live browser/network access was available to confirm the exact failing request(s). Unrelated to this: `suite-hub.html` also picked up three small nav-only additions today (Client-Selector Smoke Test, Sentinel Client Portal, Login) — internal QA/routing links, not part of any documented demo chain, so no vertical section above needed updating for them.*

*2026-08-29 (later same day): the 401 pattern above was root-caused and resolved — re-run with a puppeteer crawl (`tests/e2e/puppeteer-suite-hub-crawl.js`) that confirms the `/api/auth/login` response is actually `200` before crawling (the original pass never checked this), against the live Codespace deployment with real `MONGODB_URI`/`GROQ_API_KEY` credentials: 39/40 links pass clean. The 401s were a test-methodology gap, not an app defect. The lone remaining failure is a Cloudflare 525 SSL-handshake error on the third-party `intake.tsmatter.com` origin (Concierge Command's intake-records call) — confirmed via direct `curl -v`, outside this repo's control. "PRE-DEMO CHECK" section above has been updated in place to reflect this; the "before Monday" verification step is no longer outstanding.*
