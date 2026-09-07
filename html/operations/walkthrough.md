# TSM Consultz — Employee Troubleshooting Walkthrough

**Purpose:** end-to-end, step-by-step path through every vertical (War Room → Strategist → Executive Portal, or whatever the local variant is), written for troubleshooting — not for a demo. Each step says what should happen and what to check if it doesn't.

This is a companion to `MASTER_VERTICAL_WALKTHROUGH.md` (same folder), which is the sales/demo talk-track version. Everything technical here (paths, function names, button IDs, relay keys) is pulled from that verified source plus direct source checks — cite it if you find a discrepancy, don't guess.

---

## 0. Before troubleshooting any vertical — universal first checks

Most "the platform is broken" reports trace back to one of these four things. Rule them out first.

### 0.1 Session / login
- Confirm login actually succeeded before assuming a page is broken. `login.html` posts JSON `{password}` to `/api/auth/login`; a real success is `200 OK` with `{ok:true, role:...}` and a `tsm_session` cookie set. A silent failure here makes *every* downstream page look broken (this produced a false "all Exec Portals are down" report on 2026-08-29 — root cause was the test never checked the login response, not an app bug).
- Locally, `tsm_session` used to be set `Secure`-only, which `curl`/plain `http://localhost` silently drops — every role-gated API call 401s even with the right password. Fixed 2026-08-28 (`Secure` now conditional on `NODE_ENV === 'production'`), but if you're troubleshooting an older deploy this is the first thing to check.
- Role-gated routes (PM Copilot's `/api/pm/*`, others) require `requireRole([...])` — a correct password with the wrong role still 401s. Check which role the session actually has, not just whether login succeeded.

### 0.2 Which relay mechanism the vertical uses
Two coexist on the platform — know which one you're looking at before you go hunting for a bug:
- **Legacy (inline onclick):** Legal, Construction, FinOps, Insurance, Concierge, BPO, Honeywell. Each action is its own named JS function called directly from the button's `onclick`.
- **Newer (event-listener + dual storage):** Mortgage, Schools, PM Copilot, HotelOps. Buttons are bound via `addEventListener`, not inline `onclick`; the relay write hits **both** `sessionStorage` and `localStorage`, plus fires a `TSM_RELAY_EVENT` custom event (needed because the native `storage` event only fires cross-tab, not same-tab).

If data isn't showing up on the next screen in a newer-pattern vertical, check `sessionStorage`/`localStorage` directly for the relay key before assuming the backend is at fault — it's very often a pure client-side write/read mismatch.

### 0.3 Escalation is a data write, not just navigation
Almost every "Escalate" button (`escalateToStrategist`, `escalateToExec`, `writeExecRelay`, `schWriteRelay`, `escalateExec`, etc.) writes a payload to storage **before** changing pages. If the receiving screen shows sample/placeholder data instead of real data, the write didn't happen (or happened to the wrong key) — the navigation itself is not the failure point.

### 0.4 `exportClientPackage()` — the two named exceptions
`exportClientPackage()` (bound to `#tsmk-delivery-btn`, "⬇ EXPORT CLIENT PACKAGE") is the standard export on 11 of the 13 chained verticals: Healthcare, Construction, FinOps, Insurance, Legal, Mortgage, Schools, PM Copilot, HotelOps, Concierge, Honeywell. Two verticals do **not** have this button — don't spend time looking for it there:
- **Real Estate** — uses `exportSession()` ("Export Full Session") and `exportBoard()` ("Export Board Report") instead.
- **BPO** — uses `exportBrief()` ("⬇ EXPORT EXEC BRIEF" / "EXPORT BRIEF" / "⬇ EXPORT"), which builds a plain-text session report, not the JSON delivery package.

### 0.5 The shared Decision Center panel has its own, third relay-read mechanism
As of 2026-09-06, **9** exec portals (the original 7 — Healthcare, Construction, FinOps, Insurance, Legal, Real Estate, BPO — plus Concierge and College Command) load `html/shared/tsm-exec-portal-upgrade.js`, which appends a second panel below the page's own content (KPI cards → Decision Center → Execution Tracker → Audit Trail). This module reads relay data independently of whatever mechanism the rest of the page uses (§0.2) — its `readRelay()` checks `sessionStorage` first, then `localStorage`, against a fixed list of candidate keys per vertical (e.g. `TSM_CONCIERGE_RELAY`; two fallback keys for BPO). If this specific panel is missing or showing placeholder numbers while the rest of the page looks fine:
1. Confirm the page still has `<script src="/shared/tsm-exec-portal-upgrade.js"></script>` before `</body>` — a missing include, not a broken relay, is the single most likely cause (it's how this exact gap went unnoticed on two portals until 2026-09-06).
2. If the include is present, check the vertical's specific relay key directly in `sessionStorage`/`localStorage` — a value under the *page's own* relay key doesn't help if this module is looking for a different key name.

---

## 1. Healthcare (HC)

**Chain:** `html/healthcare/hc-denial-war-room.html` → `hc-main-strategist.html` → `executive-portal.html`
**Relay key:** `tsm_hc_docsearch_relay` / `TSM_HC_WAR_RELAY`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | Click **⚡ FIRE ALL 5 ENGINES** (`fireAll()`) | Eligibility, coding, prior-auth, appeal-drafting, and payer-pattern engines all populate against loaded claims (CO-29, PR-96, CO-4, CO-11 codes) | Confirm claims data actually loaded first — the engines read loaded denial codes, they don't generate demo data from nothing |
| 2 | War Room | Click **↗ Escalate to Strategist** (`#escalate-strategist-btn`, `escalateToStrategist()`) | Strategist opens with war-room context already loaded | Check `TSM_HC_WAR_RELAY` was written before navigation (§0.3) |
| 3 | Strategist | Click a quick-ask preset (e.g. "Board Brief") | Narrative generates with real dollar figures baked into the payload (not the model inventing numbers) | If figures are missing/wrong, the bug is upstream in the relay payload, not the strategist's generation |
| 4 | Strategist | Click **Escalate to Exec Portal** (`escalateToExecPortal()`) | Exec Portal loads with strategist output | — |
| 5 | Exec Portal | Click **⬇ EXPORT CLIENT PACKAGE** (`#tsmk-delivery-btn`) | Board-ready PDF generated from the same session data as step 1 | **Known historical bug (fixed):** the Business Impact Delta figure used to be wrong here — two stacked bugs, strategist computed it correctly but the exec portal read the wrong payload field. If a dollar figure looks off on this specific panel, re-check that fix hasn't regressed. |

---

## 2. Construction

**Chain:** `html/war-rooms/construct-war/construction-war-room.html` → `construction-strategist.html` → `construction-executive-portal.html`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **⚡ FIRE ALL 6 ENGINES** (`#fireBtn`, `fireEngines()`) | Budget variance, retainage, lien waivers, pay-app matching, GL reconciliation, compliance all populate | — |
| 2 | War Room | **⚡ ESCALATE TO STRATEGIST →** | Strategist inherits war-room context | — |
| 3 | Strategist | Top nav **AuditOps / Financial / Compliance** | Full `window.location.href` navigation to standalone apps (`construction-pro.html`, `financial.html`, `compliance-hub.html`) | These are real page navigations, not in-Strategist panels — if a click silently does nothing and stays on the Strategist view, `navTo()`'s `EXTERNAL_NAV_TARGETS` map may be missing that entry (this was the exact bug before the fix) |
| 4 | Strategist | Check anomaly feed after a BNCA run in `construction-pro.html` | Findings appear in the shared `TSM_OPERATIONAL_MEMORY_V3` store, same place FieldOps (`construction-suite-expansion.html`) writes to | If Construction's AuditOps Pro findings aren't showing up cross-module, confirm `TSMMemory.registerAnomaly()` is still being called after each completed BNCA run |
| 5 | Strategist | Check Sentinel Center | `sentinel-center.html` should show real Construction anomalies, not sample data | **This only works if you arrived via a real War Room hand-off** (`runConstructionBNCAFromRelay()` populated `warRoomRelay`). A cold Strategist session with a manual BNCA run never calls `pushToSentinel()` — Sentinel will legitimately keep showing sample data for Construction in that case. Don't treat that as a bug unless the session did come through the War Room. |
| 6 | Exec Portal | **AUTHORIZE** (`#d1-authorize-btn`) | Flips decision-item status, unlocks client package export | If export stays locked after clicking AUTHORIZE, the state flip itself failed — check `tsmConfirmExec()` |
| 7 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**Deadline-honesty guard:** `CON_ENGINE_SYSTEM_GUARD` (`routes/construction.js:88`) forces the engine to write `"NOT STATED IN SOURCE DOCUMENT"` rather than invent a deadline, and forbids marking filings/approvals complete unless the source confirms it. This has regressed once already (a shadowed route dropped the guard, fixed in `d87ab84e`) — if Construction output starts inventing dates or marking things complete without source backing, check for a shadowed route re-breaking this guard before anything else.

---

## 3. FinOps

**Chain:** `html/finops-suite/finops-war/finops-war-room.html` → `finops-main-strategist.html` → `finops-executive-portal.html`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **⚡ FIRE ALL 6 ENGINES** | GL/AP posture engines run | — |
| 2 | War Room | **⚡ ESCALATE TO STRATEGIST →** | Strategist opens | — |
| 3 | Strategist | **Relay source chips** (`setRelaySource('exec', this)`) | Lets you pick whether the report pulls from the exec or war-room upstream session | If the report has stale/wrong data, check which relay source is selected before assuming the engines are broken |
| 4 | Strategist | Switch to **⚡ 4-Engine Doc Analysis** tab, **⚡ FIRE ALL 4 ENGINES** | A *second*, separate engine stack runs (doc-level, distinct from the war room's 6) | Don't confuse this with the war-room engines when troubleshooting — they're independent code paths |
| 5 | Strategist | **→ Relay to Executive Portal** (`#relayExecBtn`) | Exec Portal receives the report | — |
| 6 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**Known open issue (as of last full certification run):** FinOps has a dead `war-room-prep` link flagged in the cert suite. Re-run the certification suite before assuming this is still broken — verify current state rather than trusting this note indefinitely.

---

## 4. Insurance

**Chain:** `html/war-rooms/insure-war/insurance-war-room.html` → `insurance-strategist.html` → `insurance-executive-portal.html`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **⚡ FIRE ALL 6 ENGINES** | Engines populate | — |
| 2 | War Room | **⚜ ESCALATE TO STRATEGIST →** | Strategist opens | — |
| 3 | Strategist | **⚜ RUN STRATEGIST CHAIN** (`#runBtn`, `runStrategist()`) | This is a **chained sequence**, not one call: claims triage → coverage analysis → reserve recommendation, in that order, each step's output feeding the next | If the reserve recommendation looks disconnected from the claim, the chain likely broke mid-sequence — check each stage's output independently rather than only the final one |
| 4 | Strategist | **→ SEND TO EXECUTIVE PORTAL** | Exec Portal receives data | — |
| 5 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**Known open issue (as of last full certification run):** Insurance was flagged for referencing a missing `tsm-guide-engine.js`. Verify current state before troubleshooting further down this path.

---

## 5. Legal

**Chain:** `html/war-rooms/legal-war/legal-war-room.html` → **case-level:** `html/legal-pro/case-strategist.html` → **chief:** `legal-main-strategist.html` → `legal-executive-portal.html` (three-deep — the only vertical with two strategist layers)

**Path correction:** `case-strategist.html` is *not* under `html/war-rooms/legal-war/` — it's at `html/legal-pro/case-strategist.html`. Relative nav links from the war room still resolve fine; only matters if you're navigating directly by file path.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **⚡ FIRE ALL 6 ENGINES** | Engines populate | — |
| 2 | War Room | **⚡ ESCALATE TO LEGAL CHIEF STRATEGIST →** (`escalateToChief()`) | Goes to Chief Strategist, *not* Case Strategist — those are two different escalation targets | If someone expects to land on the case-level strategist and lands on Chief instead, that's correct behavior, not a bug — the case-level layer is reached via a separate nav link, not this escalate button |
| 3 | Chief Strategist | Click **Escalate** link (`#escalate-btn`) | `writeExecRelay(event)` fires **on click, before** the href navigation happens | If the exec portal shows stale data, confirm the relay write actually completed before the browser followed the link — this is a click-handler-then-navigate pattern, easy to break if the handler throws |
| 4 | Exec Portal | **APPROVE** (`authorizeAction(this, 'Discovery Expansion')`) | Named action logged as "Discovery Expansion" specifically — not a generic AUTHORIZE label | If the audit log shows a generic label instead of "Discovery Expansion," the named-action string got dropped somewhere in the call chain |
| 5 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**Known open issue (as of last full certification run):** Legal was also flagged for a dead `war-room-prep` link. Verify current state.

---

## 6. Real Estate (RE)

**Chain:** `html/war-rooms/re-war/re-war-room.html` → `re-strategist.html` → `re-exec-portal.html`

**Export exception (§0.4):** this vertical has **no** `exportClientPackage()`. Use `exportSession()` ("Export Full Session") or `exportBoard()` ("Export Board Report") instead — don't treat a missing "Export Client Package" button as a bug here.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **↗ ESCALATE → STRATEGIST** | Strategist opens | — |
| 2 | War Room | Quick-fire presets (cross-node synthesis, highest-risk deal, compliance sweep, REO disposition, market intel) | Each fires a fully-scoped prompt, not a generic query | If a preset returns generic output, check `quickFire('...')` is passing the specific scoped string, not falling through to a default |
| 3 | Strategist | **↗ ESCALATE → EXEC PORTAL** (toolbar or results panel — appears twice) | Exec Portal receives strategist output | — |
| 4 | Exec Portal | **🔴 DEAL RESCUE** (`generateBrief('rescue')`) | Same generator as the standard brief but scoped to a specific at-risk deal | If it returns identical output to the plain brief, the `'rescue'` scope argument isn't being applied |
| 5 | Exec Portal | **Export Full Session** / **Export Board Report** | Session or board-level export | Do not look for `#tsmk-delivery-btn` here — it doesn't exist on this screen |

---

## 7. Mortgage

**Chain:** `html/war-rooms/mortgage/mortgage-war-room.html` → `mortgage-strategist.html` → `mortgage-executive-portal.html`
Uses the newer relay pattern (§0.2) — this is the template the Schools vertical was later built from.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **LOAD SAMPLE DATA** / **RESET SAVED DATA** (`#btnLoadSample` / `#btnResetData`) | Event-listener bound (not inline onclick) | If these buttons appear inert, check the event listener attached correctly on page load rather than looking for an `onclick` attribute in the DOM |
| 2 | War Room | **RUN AI ANALYSIS** (`#btnRunAnalysis`) | Analysis runs | — |
| 3 | War Room | **RELAY TO STRATEGIST →** (`#btnRelay`, `relayToStrategist()`) | Writes to **both** `sessionStorage` and `localStorage` under the Mortgage relay key | If the Strategist doesn't pick up data in a new tab, check `localStorage` specifically — `sessionStorage` alone won't survive a new tab |
| 4 | Strategist | Notice: **"Executive View →" is a plain link, no relay-write on click** | Data must already be in storage from step 3 — this link doesn't write anything itself | If the Exec Portal shows stale data, the problem is upstream at step 3's relay write, not this link |
| 5 | Exec Portal | **✓ ACKNOWLEDGE** / **↑ ESCALATE** (`recordExecAction('acknowledged'|'escalated', ...)`) | Both are logged actions with a specific message string (ESCALATE's copy references notifying the closing manager) | Check the event log for the actual message string if the audit trail looks generic |
| 6 | Exec Portal | **↳ EXPORT CLIENT PACKAGE** | Standard export | — |

---

## 8. Schools

**Chain:** `html/war-rooms/schools-command/schools-command.html` → `schools-strategist.html` → `schools-executive-portal.html`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **🤖 Run AI Analysis** (`#schBtnRunAnalysis`, `schRunAnalysis()`) | Five things happen in order: (1) engine runs, (2) relay payload written to `TSM_SCHOOLS_RELAY` in both storages, (3) `TSM_RELAY_EVENT` fires for same-tab listeners, (4) a Mission Core record is created, (5) **if the AI call itself errors, KPI/financial data still relays** so downstream screens don't go dark | This is the one button on the platform documented to fail *safely* — if you see a partial-failure report (AI narrative missing but KPIs present), that's the graceful-degradation path working as designed, not a bug. Only escalate if KPI/financial data is *also* missing. |
| 2 | War Room | Prompt library (`loadPrompt(...)`) | Pre-scoped compliance prompts load (subrecipient monitoring, Single Audit/SEFA, grant closeout, ESSER, MOE, 990, bond arbitrage, excess benefit, ADA/504, SOX, CISA K-12) | — |
| 3 | Strategist | **Executive View →** | Plain link, no relay-write on click (same pattern as Mortgage) | — |
| 4 | Exec Portal | **✓ ACKNOWLEDGE** / **↑ ESCALATE** | Logged actions (ESCALATE copy references the program officer) | — |
| 5 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**Known open issues (as of last full certification run):** Schools was flagged in the same cert pass for (a) referencing a missing `tsm-guide-engine.js` and (b) a war-room relay write gap. Note that step 1 above describes the relay write as working correctly per direct source verification — if you hit a real relay gap, confirm whether it's this exact write path or a different one (e.g. `war-room-prep.html`) before filing a duplicate.

---

## 9. PM Copilot

**Chain:** `html/war-rooms/pm-copilot/pm-command.html` → `pm-strategist.html` → `pm-exec-portal.html`
**Relay key:** `TSM_PM_COPILOT_RELAY` (`RELAY_KEY_FALLBACK`) / `TSM_PM_STRATEGIST_RELAY`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | Vendor dispatch (`dispatchVendorTransport(workOrderId, vendorId)`) | Assigns a specific vendor to a specific work order | This is a real state change tied to two IDs — if it silently no-ops, check that both IDs are actually populated, not just that the button was clicked |
| 2 | War Room | **RUN AI ANALYSIS** / **RELAY TO STRATEGIST** | Event-listener bound, dual-storage relay (same convention as Mortgage/Schools/HotelOps) | — |
| 3 | Exec Portal | **Executive Decision Queue** panel → `POST /api/pm/executive-decisions` | Deterministic priority ranking (no LLM) across IoT, vendor-compliance, maintenance-SLA findings, each with dollar exposure/owner/action | **Historical bug (fixed `7a436c67`):** this used to always render zero decisions because it read the wrong relay shape. If it's showing zero decisions again, check `findRelayPayload()` is still pointed at `TSM.relay.read('PM')` / `TSM_PM_RELAY`, not a stale key |
| 4 | Exec Portal | **Portfolio Intelligence** panel → `POST /api/pm/portfolio-intelligence` | Builds a portfolio twin + risk score + forward exposure | — |
| 5 | Exec Portal | **PM Intelligence V3 · Action Center** → `POST /api/pm/intelligence-v3` | Decide→Execute→Verify→Explain queue; **POST** `/api/pm/actions/verify` marks an action verified and records exposure before/after | Local smoke test:<br>`curl -sc /tmp/j.txt -H "Content-Type: application/json" -X POST http://localhost:8080/api/auth/login -d "{\"password\":\"$TSM_ADMIN_PASSWORD\"}" >/dev/null`<br>`curl -b /tmp/j.txt -H "Content-Type: application/json" -X POST http://localhost:8080/api/pm/intelligence-v3 -d '{"decisions":[...]}'`<br>Never paste the actual password value into chat or logs — reference it as `$TSM_ADMIN_PASSWORD` only. |
| 6 | Exec Portal | **Portfolio Risk Outlook** panel → `POST /api/pm/predictive-control` | Forward-looking exposure prediction, also deterministic (no LLM) | — |
| 7 | Exec Portal | Any `/api/pm/*` call returning 401 | — | There is no anonymous PM API access, but the role requirement isn't uniform: read routes (units, work-orders, leases) require `requireRole(PM_INTERNAL_ROLES)` = `['admin','manager','analyst']`; write/mutate routes (`POST` to those same paths) require the narrower `requireRole(PM_MANAGE_ROLES)` = `['admin','manager']` — **analyst can read but not write**. "My analyst account can see PM data but 401s when submitting a change" is that role boundary working as designed, not a bug. Also check §0.1's local-dev `Secure` cookie note if testing on `localhost`. |

---

## 10. BPO

**Chain:** `html/war-rooms/bpo-war/bpo-war-room.html` → `bpo-strategist.html` → `bpo-executive-portal.html`

**Export exception (§0.4):** no `exportClientPackage()` here either — use `exportBrief()` ("⬇ EXPORT EXEC BRIEF" / "EXPORT BRIEF" / "⬇ EXPORT", all three call the same function).

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | Document intake/classification | Feeds strategist's structured extraction | — |
| 2 | Strategist | Strategy brief generation | Escalates to Exec Portal with a `caseId` | If the Exec Portal can't find the case, confirm the `caseId` was actually attached to the escalation payload |
| 3 | Exec Portal | **⬇ EXPORT EXEC BRIEF** (`exportBrief()`) | Plain-text report pulling `stratData`, `lastResolutionAudit`, and `lastSupervisorRollup` (cross-vertical mission counts) — each section only appears if that panel actually loaded real data | A missing section in the export usually means that specific panel never loaded data, not that the export function is broken — check the panel first |
| 4 | Exec Portal | **✓ MARK EXECUTED** | Case transitions to resolved via `bpoUpsertWorkItem()` | This is the same function the Slack notifier hooks into (see below) |
| 5 | Exec Portal | **⚙ Manage Clients** | Goes to `bpo-clients-admin.html` | This is the real on-ramp to client-facing accounts, not a dead-end admin page |

### Client-facing chain (separate from the internal chain above)
- **`bpo-clients-admin.html`** — creates client logins, shows a **one-time access code** (`setAccessCodeBanner()`). This code cannot be recovered later — only rotated. If a client lost their code, generate a new one; don't go looking for a way to retrieve the original.
- **`saveTenantLink()`** (`PATCH /api/bpo/clients/:id`) links a client login to a cross-vertical Member — this switches their portal from BPO-only rollup to full cross-vertical rollup. `clearTenantLink()` reverts it. If a client reports seeing the wrong scope of data, check this link state first.
- **`login.html`** role-routes on success: `client` role → `/client-portal.html`, everything else → `/suite-hub.html`. This is the *only* place `client-portal.html` is reachable from.
- **`client-portal.html`** is backed by live endpoints: `GET /api/bpo/reports/client-rollup`, `GET /api/bpo/work-items/:caseId/documents`, `GET /api/bpo/documents/:docId/download` — all gated by `BPO_CLIENT_VIEW_ROLES`. If a client sees another client's data, that's a severity-1 access-control issue, not a display bug — escalate immediately rather than trying to patch it as a UI fix.

### Slack notifications
`server/integrations/slack-notifier.js` — Incoming Webhook only (no OAuth/bot token), fires non-fatally from `bpoUpsertWorkItem()`. Off by default (`SLACK_BPO_NOTIFY_ENABLED` + `SLACK_BPO_WEBHOOK_URL` both required). Defaults to notifying only on `resolved`; `SLACK_BPO_NOTIFY_EVENTS=opened,advanced,resolved` widens it. A Slack delivery failure is caught and swallowed — **it can never block a case from resolving**, so if Slack isn't firing, check the case still closed correctly before treating this as urgent.

---

## 11. HotelOps

**Chain:** `html/hotelops/hotelops-war-room.html` → `hotelops-strategist.html` → `hotelops-executive-portal.html`

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | **RUN AI ANALYSIS** / **RELAY TO STRATEGIST** (`#btnAnalyze` / `#btnRelay`) | Same Mortgage-style relay convention | — |
| 2 | War Room | IoT sensor import (`#btnIotImportPreview` → `#btnIotImportCommit`) | Two-step **preview-then-commit** flow — you see exactly what's about to import before it commits | If data appears imported without ever showing a preview, something is calling commit directly and skipping the preview step — flag as a real bug, this flow is designed to never be one-click |
| 3 | Strategist | **Export** | `window.print()` — this vertical uses print-to-PDF, not a custom export function | Don't look for a JSON export API call here |
| 4 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Wired with real financials, maintenance/compliance/Airbnb risk, and portfolio data as a sections passthrough | — |
| 5 | Exec Portal | **✓ ACKNOWLEDGE** / **↑ ESCALATE** | `recordExecutiveAction(...)` | — |

---

## 12. Concierge

**Chain:** `html/concierge/concierge-war-room.html` → `concierge-strategist.html` → `concierge-executive-portal.html`

This vertical is built around **live dispatched transport missions**, not document-driven case work — the actions below are real state transitions on a specific booking ID, not generic buttons.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | War Room | `loadMissions()` | Live mission list refreshes | — |
| 2 | War Room | `bookQuote(quoteId)` / `cancelMission(bookingId)` / `refreshMission(bookingId)` / `simulateEvent(bookingId, nextStatus)` | Each is scoped to a specific booking ID | If an action seems to affect the wrong booking, check the `bookingId` being passed, not the mission-list rendering |
| 3 | War Room | Status filters (`setFilter('confirmed'|'en_route'|'completed'|'cancelled'|'')`) | List filters client-side | — |
| 4 | Strategist | `confirmToExec()` | The `TSM_STRAT_CONFIRMED_<DOMAIN>` gate unlocks Exec Portal content | If Exec Portal content stays locked/hidden, this confirmation gate didn't fire — check it independently of the escalation navigation |
| 5 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Wired with real KPI totals (total/open/completed/exceptions/spend) as a sections passthrough | Historically the dollar-spend figure never reached this export even when everything else did — if spend is missing specifically, that's the known failure mode to check first |
| 6 | Exec Portal | Scroll past the export panel | A second panel appears below it: KPI cards (Open Missions / Completed / Exceptions / Total Spend) → Decision Center → Execution Tracker → Audit Trail, sourced from `TSM_CONCIERGE_RELAY` via `html/shared/tsm-exec-portal-upgrade.js` | If this panel is missing entirely, check the page still has `<script src="/shared/tsm-exec-portal-upgrade.js"></script>` before `</body>` — that include is the actual dependency, not just the relay key being present. If it's present but shows placeholder numbers instead of real ones, the relay read at `TSM_CONCIERGE_RELAY` came back empty — check `sessionStorage`/`localStorage` directly. Covered by `tests/playwright/concierge-college-exec-portal-relay.spec.js`, confirmed passing 2026-09-06. |

**Known third-party failure (not a repo bug):** `intake.tsmatter.com/api/intake/records` returns Cloudflare `525` (SSL handshake failure) on that third-party origin — confirmed via direct `curl -v`, outside this repo's control. Don't spend troubleshooting time in `tsm-apps` code for this specific error; it needs the other service's Cloudflare/origin config fixed.

**Relay wiring (resolved 2026-09-06):** Concierge is now wired into the shared exec-portal Decision Center (`html/shared/tsm-exec-portal-upgrade.js`) — see step 6 above. This was flagged as in-progress in an earlier pass; it's done and verified end-to-end (real-browser Playwright run, 8/8 passing, including a bounding-box check confirming the new panel doesn't overlap the export panel above it).

---

## 12a. College Command

**Structural note:** doesn't follow the standard War Room → Strategist → Exec Portal chain — it has **five separate domain war rooms**, each its own strategist-equivalent, all relaying into one combined executive portal:

| Domain | War Room |
|---|---|
| Financial Aid | `html/war-rooms/college-command/college-finaid-command.html` |
| Bursar | `html/war-rooms/college-command/college-bursar-command.html` |
| Endowment | `html/war-rooms/college-command/college-endowment-command.html` |
| Research / F&A | `html/war-rooms/college-command/college-research-fa-command.html` |
| Accreditation | `html/war-rooms/college-command/college-accred-command.html` |

Each domain writes only its own relay key (`TSM_COLLEGE_FINAID_RELAY`, `TSM_COLLEGE_BURSAR_RELAY`, `TSM_COLLEGE_ENDOWMENT_RELAY`, `TSM_COLLEGE_RESEARCH_FA_RELAY`, `TSM_COLLEGE_ACCRED_RELAY`) — there's also `college-strategist.html` as a combined view.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | Any domain war room | Run that domain's analysis | Writes to that domain's own relay key only | If one domain's data shows up under another domain's section, that's a real bug — each domain relay key is meant to be fully isolated |
| 2 | Executive Portal (`college-executive-portal.html`) | Load the page | Reads the **combined** `TSM_COLLEGE_EXEC_RELAY` key — `{ domains: [...], timestamp }` — and renders a summary bar (active domain count, combined financial exposure) plus a per-domain section for each entry in `domains[]` | If it shows "No relay from the College Strategist yet," no combined payload has been written under `TSM_COLLEGE_EXEC_RELAY` — check whether the individual domain relays were ever rolled up into that combined key, not just written individually |
| 3 | Executive Portal | Scroll past the domain sections | A second panel appears below (wired 2026-09-06, same mechanism as Concierge above): KPI cards (Active Domains / Combined Exposure / Domains Relayed / Confidence) → Decision Center → Execution Tracker → Audit Trail, computed from the same `TSM_COLLEGE_EXEC_RELAY` payload's `domains[]` array | Same two checks as Concierge: confirm the `<script src="/shared/tsm-exec-portal-upgrade.js">` include is present, then confirm `TSM_COLLEGE_EXEC_RELAY` actually has data. Covered by `tests/playwright/concierge-college-exec-portal-relay.spec.js`, confirmed passing 2026-09-06. |

**Export note:** unlike every one of the 13 chained verticals (§0.4), College Command's executive portal currently has **no export button at all** — no `exportClientPackage()`, no bespoke equivalent. Don't treat a missing export as a bug here; it's a real gap, not yet built.

**Open work:** College Command hasn't been run through the Tier 1/2/3 exception+correction audit the other 14 verticals have — it was flagged as a **provisional Tier 1 candidate** (five real per-domain routes, structurally the deepest of the confirmed-live-but-unaudited set), worth the same full audit Mortgage/Construction/Healthcare/FinOps already got. Don't represent it as tier-equivalent to the audited 14 when triaging a support request.

---

## 13. Honeywell (Plant / Supplier / Cyber-OT)

**Structural note:** unlike every other vertical, Honeywell has **three war rooms, no single one** — `html/plant-incident.html`, `html/supplier-shutdown.html`, `html/cyber-incident.html` — all funneling into one shared `html/war-rooms/honeywell-strategist.html` → `html/war-rooms/honeywell-executive-portal.html`.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | Any of the 3 war rooms | Scenario-specific escalate button (disabled until conditions are met on `plant-incident.html`) | All three target the same `STRATEGIST_URL` | If the button stays disabled, check the specific unmet condition on that page — it's a deliberate gate, not a bug |
| 2 | Strategist | Scenario shortcuts | Can navigate back to any of the three war rooms | — |
| 3 | Exec Portal | **AUTHORIZE** vs **BOARD NOTIFIED** | Two distinct, separately-logged actions (`recordExecutiveAction('AUTHORIZED', ...)` vs `('BOARD_NOTIFIED', ...)`) | If the audit trail only shows one action type when both should have fired, check they weren't collapsed into a single generic ESCALATE somewhere upstream |
| 4 | Exec Portal | **⬇ EXPORT CLIENT PACKAGE** | Standard export | — |

**No client-facing sales pitch yet for this vertical overall:** Honeywell is currently 3 sub-verticals with no queue/correction logic — off every client-facing pitch entirely, tracked as internal build backlog until it reaches Tier 2. Don't represent it as pilot-ready if a support/sales question comes in about it.

---

## 14. L1 Ticket Copilot (IT Ops)

**Structure:** does *not* follow the War Room → Strategist → Executive Portal pattern — four peer apps under `html/l1-copilot/`, hub-linked, not an escalation chain: `enterprise-command-center.html` (hub) → `l1-ticket-copilot.html` → `vmware-copilot.html`, plus `topology.html` reachable independently.

| Step | Screen | Action | Expected result | If it doesn't work |
|---|---|---|---|---|
| 1 | Hub | Assistant bubble (`#l1a-fab`) | `POST /api/l1-copilot/assistant` — real backend, present on all four pages | If the bubble returns a canned/static response, the backend call itself is failing silently — check the network tab, not the UI |
| 2 | Ticket Copilot | **"OPEN FULL VMWARE OPERATIONS MODULE →"** (`#btnOpenVmwModule`) | Writes ticket ID, issue summary, component, category, environment to `window.TSM.relay.write('VMWARE_COPILOT', {...})` before opening `vmware-copilot.html` | Confirm `VMWARE_COPILOT: "TSM_VMWARE_COPILOT_RELAY"` is still registered in `relay.core.js` — **this exact relay domain was missing once before**, which broke the context banner and pre-filled dropdowns on the receiving page |
| 3 | VMware Copilot | Context banner (`#ctxBanner`) + Component/Category/Environment dropdowns | Pre-fill from `window.TSM.relay.read('VMWARE_COPILOT')` | Same root cause as step 2 if these come up empty |

---

## RCM-OS (standalone — not a chain)

**Path:** `html/finops-suite/tsm-rcm-os.html` (single self-contained page)

Do **not** troubleshoot this as if it were a War Room → Strategist → Exec Portal chain — it has no escalation chain, no relay, and no `exportClientPackage()`. It's a standalone GL-reconciliation simulation tool under the FinOps suite.

**Historical bug (fixed):** cross-device relay was broken (`ea3e68f42`) because `rcm-relay-client.js`'s fetch calls were missing `credentials: 'include'`. If cross-device state ever silently fails to sync again, check that flag first before assuming a new bug.

**Companion pages (all in `html/finops-suite/`, cross-linked, not part of the escalation-chain pattern):**
- `rcm-os-simulation.html` ("RCM-OS Simulation Lab") — scenario injection/remediation tool (`injectAnomaly()`, `remediate()`, `loadNormal()`); its **"Send to RCM OS"** action (`sendToRCMOS()`) opens `tsm-rcm-os.html?simulation=1` in a new tab to hand off the generated scenario.
- `tsm-rcm-os-howto.html` — reference/how-to guide, links back to `tsm-rcm-os.html`. Its walkthrough section notes the four engine outputs are staged server-side with a **localStorage fallback** if the relay endpoint is unreachable, before navigating to `tsm-rcm-os.html` — check that fallback if a "staged" step seems to silently lose data.
- `rcm-os-presentation.html` — static sales/demo deck, links out to `tsm-rcm-os.html` in two places ("Launch RCM OS" nav CTA and an "RCM OS Executive Tab" link). No app logic to troubleshoot here beyond dead links.

---

## A/R Recovery War Room (standalone — not a chain)

**Real path:** `html/war-rooms/ar-recovery/index.html` — vertical-agnostic (`?vertical=` param, e.g. `?vertical=healthcare`), cross-linked from `hc-denial-war-room.html`'s HC-suite nav and listed in `suite-builder.html`'s own app registry.

**Known duplicate — don't confuse the two:** `ar-recovery-war-room.html` also exists at the repo root. It's an earlier standalone prototype with the same core parsing/ranking logic (`parseARText`, `bucketFor`, `rankQueue`) but **no career-engine wiring** and no `?vertical=` support. Nothing else in the app links to it. Prior version of this doc and `suite-hub.html` mistakenly pointed here — both now corrected to the real integrated path above.

Like RCM-OS, no escalation chain, no `RELAY` key, no `exportClientPackage()`. Core flow: paste/load A/R aging text → parse into a queue → rank/prioritize:

| Step | Action | Function | Notes |
|---|---|---|---|
| 1 | Load sample or paste real A/R aging text | `loadSample(type)` / `parseARText(text)` | — |
| 2 | Queue renders with aging buckets | `bucketFor(age)` → `renderQueue()` | Each row tagged with a recommended action via `recommendedAction(status, bucket)` |
| 3 | Rank/prioritize the queue | `rankQueue()` | — |
| 4 | Run AI pipeline over top accounts | `runPipeline()` → `summarizeTopAccounts(n)` → `groqStreamModel(...)` | Same client-side Groq fallback pattern as `finops-operations.html` — if this errors, check for the same missing-fallback-key / 401 condition before assuming a new bug |
| 5 | Copy output | `copyOut(id)` | — |

**Career-engine integration (new):** a self-contained IIFE lower in the file adapts A/R actions into career-training evidence — explicitly documented in its own comment as *not* replacing the ranking engine, HC AI pipeline, CRCR state, or the Career Engine, only translating A/R work into evidence for it. Key pieces:
- `careerEngine()` looks for `window.TSMRCMEngine` (set by `html/js/career/tsm-rcm-career-engine.js`, which self-registers as `global.TSMRCMEngine` if not already present — load-order matters, and a missing include on this page is the first thing to check if the career panel doesn't populate)
- `html/js/career/tsm-ar-recovery-career-adapter.js` (loaded separately, sets `window.TSMARRecoveryCareer`) exposes `discoverAccounts()`, `scoreRecoveryAction()`/`scoreSelection()`/`scoreReasoning()`, and `recordActionResult()`/`recordResult()` — covered by `scripts/test-rcm-career-browser.sh` and `scripts/test-rcm-career-ar-action-browser.sh`, which assert `window.TSMARRecoveryCareer` exists with those functions before doing anything else. If a career-related bug report comes in on this page, run the same checks those scripts do (`!!window.TSMARRecoveryCareer`, then the specific function) before digging further.
- Numerous `.bak` / `.bak-<timestamp>` files sit alongside the live adapters in `html/js/career/` from iterative repair passes (e.g. `tsm-rcm-career-engine.js.pre-v3.bak`) — don't mistake a `.bak` file for the live one when tracing a bug; confirm the actual `<script src>` path on the page first.

---

## Career Training Platform (standalone hub — not a chain)

**Path:** `html/tsm-career-training-platform.html` ("Decision Intelligence Academy"), companion guide at `html/tsm-career-os-guide.html`

Not a War Room → Strategist → Exec Portal chain — it's a hub linking out to practice tools across 7 sectors, plus a separate standalone L1/IT-Ops track (`switchTo('l1')` panel), each opening in its own tab/module.

- **L1/IT-Ops track reuses the same relay bus as §14 (L1 Ticket Copilot):** its VMware Copilot card explicitly reads `TSM.relay.read('VMWARE_COPILOT')`. If VMware context isn't pre-filling from this hub, check the same `VMWARE_COPILOT` relay registration in `relay.core.js` noted in §14 — it's a shared failure point, not something specific to career training.
- **Readiness checklist (`updateReadiness()`) is in-memory only** — it reads `.readiness-check` checkbox states directly off the DOM each time and recomputes a percentage; nothing is written to `localStorage`/`sessionStorage`/a relay. A refresh silently resets all checkmarks to zero — that's expected behavior, not a bug, unless persistence gets added later.
- Various "export" cards (readiness score export, governance audit export, etc.) are described in the page copy as staffing-firm/enterprise deliverables — confirm which of these actually wire up to a real export function versus being forward-looking copy before promising the behavior in a support conversation.

---

## Platform-wide gotchas worth knowing before you dig into vertical-specific code

- **Two relay mechanisms coexist** (§0.2) — always confirm which pattern a vertical uses before hunting for the storage key.
- **`relay.core.js` defer-order bug** — confirmed present in at least 5 files (CRM war room/strategist/exec portal + a pre-fix NOC) as of the last sweep; a full audit across all 32 war-room pages was still queued, not completed. If a relay read comes back empty on a page you haven't specifically verified, this is a plausible cause.
- **`TSM_KERNEL` references without loading `tsm-kernel.js`** — 11 pre-existing committed files were flagged for this; needs a dedicated audit pass rather than guess-and-patch if you hit a `TSM_KERNEL is not defined` error.
- **Confirmed-live-but-not-tier-audited verticals:** HotelOps, Concierge, PM Copilot, College Command, Music (Sweet Music OS), NOC, Logistics, Supplier-Vendor, Working-Capital, Approval, Catalog, CPQ, CRM, Digital-Twin, Governance, Integration-Hub, MDM, O2C all have real live pages per the build log but haven't been run through the same exception+correction audit as the 14 vertical set above — don't assume tier-parity with the audited set when triaging a functionality report on any of these.
- **Dead code, not a bug:** `server/capability-engines/{approval,catalog,cpq,crm,o2c}-engine.js` are real but never `require`d anywhere in `server.js` — the live client-side engines cover the same ground. If you're chasing a discrepancy in one of these five verticals, confirm you're looking at the code path that's actually wired before spending time on the unused engine files.

---

*Built from `MASTER_VERTICAL_WALKTHROUGH.md` (verified against live source, most recent re-audit 2026-08-29) plus a direct pass to reframe every section from demo talk-points into step → expected result → troubleshooting-check format. Where a note above says "as of the last certification run" or "not yet confirmed," treat that as a prompt to re-verify current state rather than a standing fact — several of these were open items, not closed ones, as of the source material's last update.*

*Re-audited 2026-09-06: every documented file path (49 checked) and a spot-check of 16 key functions/buttons across all 14 chained verticals confirmed present and unchanged in current source — no drift found. Concierge's "wiring in progress" note updated to reflect the completed fix (§12, step 6); added a new §12a for College Command, which was live but undocumented here before. Both updates verified end-to-end against a real running instance via `tests/playwright/concierge-college-exec-portal-relay.spec.js` (8/8 passing), not just static source review.*
