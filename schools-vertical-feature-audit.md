# TSM Schools Vertical — Feature Audit

**Scope:** `html/war-rooms/schools-command/` (Command Center, Strategist, Executive Portal) + supporting `server/schools/`, `routes/schools-financial.js`, and related API routes in `server.js`.

**Persona this vertical serves:** Back-office/compliance operations at a multi-site K-12 charter network (the fictional "AMS Charter Network" — sites in AZ, NV, AR) — CFOs, grants managers, special-education compliance staff, and the network's executive/board level.

---

## 1. Platform shape: three linked pages, one mission

The Schools vertical isn't a single page — it's a **three-tier escalation chain**, mirroring the same pattern used across other TSM verticals (Mortgage, Healthcare):

| Page | Role | Audience |
|---|---|---|
| **Schools Command Center** (`schools-command.html`) | The operator's workbench — 11 tabs of day-to-day compliance, finance, and AI tooling | Grants/compliance analysts, business office staff |
| **Schools Strategist** (`schools-strategist.html`) | Read-only relay view that renders whatever the Command Center's "Run AI Analysis" produced, re-stamped with a review timestamp | Compliance director / department head reviewing analyst output |
| **Schools Executive Portal** (`schools-executive-portal.html`) | Further-upstream relay view for leadership | Superintendent / board / executive sponsor |

**Business value of the chain itself:** it enforces a review step between an AI-generated finding and executive visibility — the Strategist page stamps `reviewedAt` on the payload, so the Executive Portal can show leadership *reviewed* output, not a raw AI answer with no human in the loop. That's a governance/liability control, not just a UI nicety: it prevents "the AI told the board X" and instead shows "a human reviewed the AI's finding on X."

---

## 2. Command Center tabs

### 📊 Dashboard
**What it does:** Landing view — 8 headline metrics (enrollment, active grant funds, compliance score, docs processed, pending tax filings, security posture, uptime, active alerts) plus a 4-site status grid (each site tagged with its live risk flags: IDEA risk, NSLP hold, ZT active, 990 filed, etc.) and quick-launch buttons into the other tabs.
**Business value:** A single-glance status board for a district CFO/superintendent — is any site at risk, and where. Reduces the "which of our 4 sites should I worry about today" question to one screen.

### 💰 Financial
**What it does:** Four AI-agent-backed workflows: budget document processing/normalization, invoice automation + GL coding, grant tracking & compliance (deadlines, allowed-cost checks, supplanting checks), and enrollment analytics/forecasting.
**Business value:** Automates the manual, error-prone work of coding invoices to the correct federal fund and normalizing budget documents across sites — the kind of clerical bottleneck that causes audit findings when done by hand under deadline pressure.

### 🎓 Academic
**What it does:** Transcript/student-record extraction (PHI-aware), enrollment intake/verification (including McKinney-Vento homelessness checks), IEP/special-ed processing (FAPE/LRE validation), and 504 plan/accommodation tracking with overdue-review flagging.
**Business value:** Special-education compliance (IDEA/FAPE) is one of the most heavily audited and litigated areas in K-12 — automating IEP validation and catching overdue 504 reviews before a federal monitor does reduces both legal exposure and staff time spent manually cross-checking files.

### 👥 HR
**What it does:** Staff certification/licensure compliance checks, payroll fund-coding validation (flagging IDEA/Title I "supplanting" risk — spending federal dollars in place of, rather than in addition to, state/local dollars), and professional-development hour tracking against Title II/grant minimums.
**Business value:** Payroll miscoding to the wrong federal fund is a classic single-audit finding that can trigger clawbacks. Automated fund-split validation catches it before the auditor does.

### 📋 Grants
This is the vertical's centerpiece — a live operational tracker, not just an agent-trigger form:
- **Grant portfolio tracker** (`schKpiGrid`, `schSnapGrid`, `schTracker`, `schBreachBody`): tracks three entity types — grant files, monitoring items, and compliance exceptions — through their stage pipelines, surfacing SLA breaches and financial exposure (funding-delay exposure, compliance exposure, active award value, total exposure).
- **"Run SAP Phase Enrichment"**: pushes the highest-priority open grant file through TSM's shared enterprise capability engine (CRM · Order-to-Cash · Approval Center · Governance · MDM) — the same backend pipeline every other TSM vertical uses, so a grant issue can trigger cross-functional workflow (e.g., an approval request) without a separate integration.
- **"Run AI Analysis"**: generates a narrative brief covering grant risk, SLA-breach root cause, open compliance-exception escalation, and funding-continuity guidance — and this is the button that actually feeds the Strategist/Executive relay chain (see the "Load Sample Data → Run AI Analysis" flow note below).
- **Grants management agent forms**: NOFO application builder, drawdown-schedule/reimbursement generator, subrecipient monitoring, grant closeout package compiler.

**Business value:** Grant compliance is the single highest financial-risk area for a charter network — SLA breaches and open findings translate directly into deobligated funding or clawbacks. The server-side financial model (`server/private-config/schools/financial-model.json`) puts real dollar figures on this: a configurable per-day funding-delay cost and a severity-tiered compliance-exposure schedule (HIGH/MEDIUM/LOW), computed server-side (as of a recent fix) so the pricing model itself isn't exposed to the browser. This turns "we have 3 open exceptions" into "we have $47,000 of exposure sitting open" — the number a CFO actually needs.

### 📁 Doc Upload
**What it does:** Drag-and-drop document intake (PDF/DOCX/XLSX/images) with a 10-option analysis-type picker (IDEA supplant risk, NSLP/FNS audit, IEP/FAPE, 2 CFR 200 costs, Single Audit/SEFA, payroll fund coding, Title I comparability, tax-exempt/990, MOE, Zero-Trust/FERPA) plus a separate checklist generator for 8 federal program types (IDEA Part B, Title I, NSLP, 2 CFR 200, Single Audit, Form 990, McKinney-Vento, etc.).
**Business value:** Turns "what documents do I need before a monitoring visit" into a generated checklist instead of institutional knowledge living in one compliance officer's head, and lets staff run the *specific* federal-program lens relevant to a given document rather than a generic AI read.

### 🔍 Exam Prep
**What it does:** A federal-monitoring exam simulator across 4 agency types (OSEP/IDEA, FNS/NSLP, OIG audit investigation, SEA desk review), a pre-monitoring readiness checklist, a "2025–26 Hot Areas" briefing (current high-risk audit focus areas), and a Corrective Action Plan (CAP) drafter that takes a pasted finding and drafts a response.
**Business value:** Federal program monitoring visits are high-stakes and infrequent — this is a rehearsal tool so staff aren't seeing the hardest questions for the first time from an actual federal monitor, plus a CAP drafter that turns "we got a finding" into a first-draft response in minutes instead of days.

### 📅 Calendar
**What it does:** A color-coded monthly compliance-deadline calendar (reporting deadlines, IEP 60-day windows, tax filing dates, grant holds) with an AI-generated monthly briefing and a deadline-list export.
**Business value:** Missed regulatory deadlines are often the root cause behind avoidable findings — a single visual calendar spanning tax, special-ed, and grant deadlines catches conflicts that live in separate people's calendars otherwise.

### 📖 Reg Lookup
**What it does:** A quick-reference library of 10 core K-12 regulations (2 CFR 200, IDEA supplant rule, NSLP, FERPA, Time & Effort, LRE, McKinney-Vento, Title I SNS, 501(c)(3)/990, NIST 800-207) plus free-text citation lookup.
**Business value:** Puts plain-English regulatory context one click away instead of requiring staff to pull the actual CFR text — useful both for day-to-day questions and for training newer compliance staff.

### 🧾 Tax Hub
**What it does:** Six tax-specific agent workflows for a tax-exempt educational entity: Form 990 review, UBIT (unrelated business income) analysis, payroll tax compliance (FICA student exemptions, housing allowances), tax-exempt bond arbitrage (§148 yield restriction), sales tax exemption verification, and executive compensation §4958 excess-benefit review — plus a free-form AI tax Q&A.
**Business value:** Charter networks are 501(c)(3) tax-exempt entities but still carry real tax-filing obligations (990s, UBIT, bond arbitrage, payroll) that general school-ops software doesn't touch. This packages nonprofit/education tax expertise most districts would otherwise outsource to a specialized CPA firm.

### 📊 Compliance Hub
**What it does:** A scorecard across 8 federal compliance programs (FERPA, IDEA, 2 CFR 200, NSLP, Title I, MOE, IEP/FAPE, 990) with live percentage scores, plus a free-text AI compliance-analysis tool with quick prompts tied to the network's actual open issues (IDEA NV-01 supplant risk, NSLP AR-02 hold, procurement, OSEP 2026 priorities).
**Business value:** Rolls up compliance posture across every major federal program into one number per program instead of 8 separate spreadsheets or systems — the kind of view an auditor or board member asks for first.

### 🔐 Zero-Trust
**What it does:** A security-posture dashboard mapped to NIST SP 800-207's 5 zero-trust pillars (Identity, Devices, Network, Applications, Data/FERPA) with live metrics per pillar (MFA enrollment, MDM enrollment, micro-segmentation, CASB coverage, encryption), a threat-activity feed, and an AI zero-trust assessment tool.
**Business value:** K-12 districts are a top ransomware target (CISA has issued specific K-12 guidance) and hold FERPA-protected student data — this gives a district a defensible, framework-aligned security posture view instead of ad hoc IT reporting, which matters both operationally and for cyber-insurance/compliance purposes.

### 🤖 AI Analysis
**What it does:** A general-purpose free-text AI assistant pre-loaded with school/tax/compliance/security quick prompts (IDEA supplant, NSLP review, 2 CFR 200, MOE check, 990 review, zero-trust assessment), with TXT/MD export and copy.
**Business value:** A catch-all for questions that don't fit a specific tab — the "ask anything" escape hatch. Worth noting: this tab's output does **not** feed the Strategist/Executive relay chain (that's driven specifically by the Grants tab's "Run AI Analysis" button) — it's a standalone Q&A tool, not part of the mission-escalation pipeline.

### ⚙️ Integrations
**What it does:** Connector tiles for the systems a real district would need to plug in: SIS (PowerSchool, Infinite Campus, Skyward), Finance/ERP (QuickBooks, Tyler Munis, Frontline), Document Vault (SharePoint, Google Drive, Box), Tax/IRS e-file (IRS e-Services, Avalara, Vertex), Identity/SSO (Okta, Azure AD, Google Workspace), and Reporting/BI (Power BI, Tableau, Cognos).
**Business value:** Signals the integration surface a real deployment would need and gives a sales/demo narrative for "this plugs into what you already run" — currently these are demo-stub connectors rather than live integrations.

### 📘 How To
**What it does:** An in-app guided tour (`tsm-guided-how-to.js`) that walks a new user through the 9-phase operating model — START → INPUT → ANALYZE → REVIEW → DECIDE → EXECUTE → REPORT → MEASURE → REPEAT — highlighting the real on-page control for each phase (e.g., ANALYZE points at the "Run AI Analysis" button, REVIEW points at the financial exposure snapshot).
**Business value:** Onboarding — turns "here's a dense 11-tab enterprise tool" into a guided first walkthrough. This was the feature audited and repaired earlier in this session: it previously pointed at no real controls for 8 of 9 phases and has since been fixed and verified against the live page.

---

## 3. Backend intelligence layers (not directly visible as tabs, but power the tabs above)

| Component | What it does | Why it matters |
|---|---|---|
| `server/schools/decision-engine.js` + `schools-domain-config.js` | Classifies incoming findings into 3 domains (grant breach / monitoring stall / compliance exception), assigns an owner ("Grants Management," "Program Monitoring," "Compliance/Federal Programs"), an urgency, and a concrete next action | Turns a raw AI finding into an assigned, actionable ticket instead of a paragraph someone has to re-read and triage manually |
| `server/schools/portfolio-intelligence.js` | Deterministic (no-LLM) roll-up of grant files, breaches, monitoring items, and compliance exceptions into a portfolio-wide exposure total | Gives a reliable, non-hallucinating number for total dollar exposure across the portfolio — deliberately *not* AI-generated, which matters for anything a CFO would cite externally |
| `routes/schools-financial.js` | Server-side computation of funding-delay and compliance-exposure dollar figures from a private rate card | Recently hardened so the underlying pricing/rate-card model isn't exposed to the browser (was previously visible in a publicly-fetchable JSON file) — a real security/IP-protection fix |
| `/api/schools/intelligence-v3`, `/api/schools/portfolio-intelligence` | Role-gated (`PM_INTERNAL_ROLES`) endpoints that build the action queue and portfolio twin server-side | Internal-only intelligence generation, separated from the client-facing analysis endpoint |

---

## 4. Notable findings from this session's audit trail

- **Guided How-To tour (fixed, verified):** All 9 workflow-phase steps previously resolved to "no matching control" due to a generic fallback text-matcher that didn't match this page's actual button labels. Real CSS selectors were wired in and verified against the live DOM (jsdom) — all 9 now resolve correctly.
- **Export-bar labeling (fixed, verified):** The AI Analysis tab's export bar (Export TXT / Export MD / Copy) was missing the `data-tsm-how-to-label` attributes the workflow-documentation test expected — added and verified unique on the page.
- **Financial rate-card exposure (previously fixed, per code comments):** The dollar-exposure pricing model used to ship in a publicly fetchable JSON and has been moved server-side behind auth.
- **Financial-summary endpoint auth gap (previously fixed, per code comments):** `/api/schools/financial-summary` previously had no auth check and is now gated behind session auth, matching the pattern used elsewhere in the platform.
- **A prior demo script bug (documented, not yet re-verified with a real browser):** An earlier demo automation script clicked the wrong "Run AI Analysis" button (the free-text AI Analysis tab instead of the Grants tab), which — because only the Grants tab's button writes to the relay — would have left the Strategist and Executive Portal pages empty in a live demo. This has been corrected in the demo script per its own changelog note, though the fix is flagged as not yet re-run through an actual browser in this sandbox.

---

## 5. Overall business value summary

The Schools vertical packages together five distinct professional functions — grants compliance, special-ed compliance, K-12-specific tax law, cybersecurity posture (FERPA/NIST), and federal-monitoring exam prep — that a real charter network would otherwise need separate specialized staff, a CPA firm, and a security consultant to cover individually. Its differentiated value sits in three places: the **live grants exposure tracker** (turning compliance status into dollar risk a CFO can act on), the **CAP drafter + exam simulator** (compressing days of monitoring-prep work), and the **three-tier command → strategist → executive relay chain**, which gives leadership a governed, human-reviewed view of AI-generated findings rather than raw model output.
