# College Command Platform — Financial & Compliance Intelligence Suite

**Status:** All 5 domains complete and live on `main`
**Architecture:** Private server-side rate cards → real computed exposure → real AI analysis (Groq) with graceful degradation → zero client-side API keys

---

## The Core Pattern

Every domain in this suite follows the same disciplined architecture, and the discipline is the point:

1. **Private rate card** (`server/private-config/college/*.json`) — the pricing/scoring logic for a domain lives server-side only. It is never sent to the browser. A competitor, a curious student, or a browser DevTools session cannot see how your institution weighs risk.
2. **Real computation, not guesswork** — every dollar figure or risk score is calculated from actual case data against that rate card. No hardcoded totals, no client-side math that can be tampered with, no placeholder numbers dressed up as insight.
3. **Real AI, with an honest failure mode** — when the AI call succeeds, staff get genuine Groq-powered analysis of their actual case data. When it doesn't (rate limit, network blip, missing key), the system says so plainly and keeps the underlying numbers fully usable — it never fabricates an answer to paper over a failure.
4. **Zero client-side keys** — the old pattern across all five war rooms was a modal asking staff to paste in their own Groq API key, stored in-memory in the browser. That's gone. All AI calls now route through the server, where the key is actually managed.

This is not five different implementations — it's one architecture, applied five times, with each domain's rate card and system prompt tuned to its actual compliance reality.

---

## Domain 1 — Financial Aid (Title IV)

**What it watches:** R2T4 (Return to Title IV Funds) late-return penalties, FAFSA/IRS verification backlog, cohort default rate (CDR) sanction exposure.

**Wow factor:** This is the domain with the highest real regulatory teeth — R2T4 has a hard 45-day federal deadline, and missing it isn't a process failure, it's a Department of Education compliance violation with real financial penalties. The system quantifies exposure *before* that deadline is missed, not after.

**Business value:**
- Converts a spreadsheet-and-tribal-knowledge process into a single dashboard with dollar-quantified urgency
- Cohort default band exposure ($15K–$500K depending on sanction tier) means leadership sees the stakes in the same currency as the board does
- AI analysis is scoped to never fabricate a deadline — every date-sensitive claim it makes is grounded in data actually provided, which matters enormously in a domain where a wrong date is a compliance risk in itself

---

## Domain 2 — Bursar

**What it watches:** Delinquent payment plans, late-fee accrual, collections write-off risk by aging band, registration holds blocking re-enrollment.

**Verified exposure (sample data):** $7,900 AR balance + $1,395 late-fee accrual risk + $6,600 registration-hold enrollment risk = **$15,895 total exposure**

**Wow factor:** The aging-band write-off risk isn't a flat percentage — it's computed server-side from actual days-past-due, so a $3,000 balance at 51 days past due is priced differently than the same balance at 6 days. That's real collections modeling, not a guess.

**Business value:**
- Surfaces registration holds that may be *inappropriately* blocking re-enrollment — a student stuck in limbo over a small balance is a retention risk the AI is specifically prompted to flag
- Converts "AR balance" from an accounting abstraction into an actionable, prioritized list of which plans need attention today
- Registration-hold revenue-at-risk modeling puts a dollar figure on something usually treated as a purely administrative annoyance

---

## Domain 3 — Endowment

**What it watches:** Corpus deficit against spending policy, donor-restriction compliance and remediation risk.

**Verified exposure (sample data):** $226,000 corpus deficit + $33,000 donor-restriction remediation risk = **$259,000 total exposure**

**Wow factor:** Donor-restriction violations are a reputational and legal minefield most institutions handle reactively, after an audit finding. This surfaces the exposure proactively, before a donor or an auditor does.

**Business value:**
- Corpus deficit tracking against actual spending policy — not just "is the fund down," but "is it down relative to what governance rules allow"
- Remediation risk quantification gives the CFO/board a defensible, documented number instead of a vague "we should look into that"
- Prevents the single costliest failure mode in endowment management: a small restriction violation compounding silently for years before discovery

---

## Domain 4 — Research / Facilities & Administrative (F&A)

**What it watches:** Award burn-rate variance against planned budget, effort-report certification compliance, indirect cost (F&A) recovery shortfall.

**Wow factor:** This domain was rebuilt from the ground up in this engagement — the original version had no real numbers behind it at all (descriptive strings like "+38% vs plan" instead of actual budget figures). It now computes real over-burn exposure from `actual_spend - planned_budget`, scaled by severity, exactly the way an audit would.

**Business value:**
- Over-burn exposure by severity means a PI running 15% over budget isn't lumped in with one running 40% over — the dollar risk scales with the actual variance
- Effort-report noncompliance cost (a real, auditable federal exposure under uniform guidance) gets its own line item instead of being buried in a spreadsheet
- Gives research administration a single number — total sponsor-audit/disallowance exposure — instead of five disconnected spreadsheets per award

---

## Domain 5 — Accreditation

**What it watches:** Open findings by standard, standards at risk ahead of a site visit, proximity to the next accreditor visit.

**Wow factor — the honest one:** This domain deliberately does **not** report a dollar figure. Accreditation risk isn't a financial-penalty domain the way R2T4 or cohort-default are — a fabricated dollar number here would be *less* credible, not more. Instead it computes a transparent, points-based **readiness risk score**, weighted by finding severity, days-open beyond the 45-day mark, and proximity to the next site visit. That restraint — refusing to force every domain into the same "$ exposure" mold just for consistency — is itself the differentiator.

**Business value:**
- Gives the Provost's office and General Counsel a single, defensible readiness number that scales in real time as findings age or a site visit approaches
- The site-visit proximity bonus means the same open finding gets flagged as materially more urgent 30 days out than it did 90 days out — timeline-aware risk, not a static list
- Sets up a template other non-financial compliance domains (Title IX, safety/OSHA, IT security posture) could reuse — the scoring-points pattern generalizes beyond dollars

---

## What Makes This Suite Different From a Typical Dashboard

- **No fabricated numbers, anywhere.** Every AI prompt in every domain is explicitly instructed to use only dates and figures present in the actual data — never to calculate, estimate, or infer a deadline, and never to mark something resolved unless the data confirms it.
- **Rate cards are configuration, not code.** An institution can recalibrate every dollar-per-day, every severity weight, every proximity threshold by editing a JSON file — no redeployment, no engineering ticket.
- **Graceful degradation is a feature, not a bug fix.** If the AI layer goes down, the underlying financial/risk data — the part that actually matters for a compliance deadline — is completely unaffected. Staff never lose access to real numbers because an AI call failed.
- **Consistent aggregation.** All five domains relay into a single College Strategist dashboard via a shared relay-payload contract, so leadership gets one cross-domain view instead of five browser tabs.

---

## Verification Status (as of this delivery)

| Domain | Backend wired | Old client-key modal | Live on `main` |
|---|---|---|---|
| Financial Aid | ✅ | 0 markers | ✅ |
| Bursar | ✅ | 0 markers | ✅ |
| Endowment | ✅ | 0 markers | ✅ |
| Research / F&A | ✅ | 0 markers | ✅ |
| Accreditation | ✅ | 0 markers | ✅ |

Confirmed via direct repository inspection and a repeatable grep sweep across all five war-room files — not asserted, independently checked.

**Remaining open item:** authenticated end-to-end verification of the live `/financial-summary` and `/readiness-summary` math (endpoints are confirmed reachable and correctly auth-gated, but full numeric verification requires a logged-in session and hasn't been run yet).
