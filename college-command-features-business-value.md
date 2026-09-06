# College Command — Features & Business Value

*A summary of what's actually built and verified in the College vertical of the TSM platform — grounded in shipped code and its test coverage, not a marketing gloss.*

---

## 1. Five back-office domains under one roof, not one generic dashboard

College Command covers five distinct back-office functions as real, purpose-built war rooms — not one template reused five times:

- **Financial Aid (Title IV)** — R2T4, Verification, Cohort Default Rate cases
- **Bursar** — payment plan delinquency, registration holds, AR exposure
- **Endowment** — underwater funds (FASB ASU 2016-14), donor restriction flags
- **Research/F&A** — award burn-rate flags, effort reporting, F&A recovery shortfall
- **Accreditation** — findings, standards at risk, site-visit countdown

**Business value:** these five offices almost never share a system today. A prospect sees their entire back-office compliance surface in one place for the first time — that's the "how did you know exactly what my job looks like" moment in a demo.

---

## 2. Real dollar exposure math, not a mockup number

Financial Aid's exposure figures come from a **server-side rate card** — R2T4 late-return penalty/day, verification backlog cost/day, cohort-default exposure by band — computed live from actual case data, not hardcoded for a demo.

**Business value:** a CFO can challenge the number and it holds up, because it's arithmetic against real inputs, not a placeholder. That's the difference between "trust me" and "here's the math."

---

## 3. AI analysis wired to real endpoints across all five domains

Every domain has a working "Run AI Analysis" button hitting a real Groq-backed endpoint with a domain-specific compliance prompt:

- R2T4/verification framing for Financial Aid
- Collections framing for Bursar
- FASB fund-risk framing for Endowment
- Burn-rate/effort-reporting framing for Research/F&A
- Readiness framing for Accreditation (no dollar exposure math here — deliberately, since it isn't a financial-penalty domain)

Each degrades gracefully to a placeholder if the AI call fails — never a hard error.

**Business value:** the AI isn't decoration bolted onto a static dashboard — it reads the institution's actual open cases and gives a specific compliance read. That's the actual pitch: "a brain for your existing team," not "replace your team."

---

## 4. Strategist aggregates all five domains simultaneously — a deliberate design choice

Unlike some other verticals on this platform (e.g. Honeywell's strategist, which only ever shows the newest incoming alert), College's strategist was built to show **all five domains' relayed status at once**, because financial-aid leadership genuinely needs simultaneous cross-office visibility, not a single "latest thing."

**Business value:** this maps to how a real VP of Enrollment or CFO actually works — they don't triage one office at a time, they need the whole picture on one screen before a board meeting.

---

## 5. Isolated relay keys per domain — architected to avoid a real bug class

Each of the five domains writes to its **own isolated relay key** rather than sharing one — deliberately avoiding a data-collision bug that has actually hit other verticals (Legal, Insurance) in this codebase before.

**Business value:** less flashy in a demo, but it's the difference between "the dashboard sometimes shows the wrong office's data" and it just working — a reliability story for technical buyers and IT evaluators specifically.

---

## 6. Cross-vertical document routing

The AI document classifier recognizes College content and routes a single incoming document to the correct sub-domain automatically — including genuinely cross-vertical cases (e.g., a research grant invoice classifies as both **College** *and* **FinOps** at once).

**Business value:** mailroom/inbox triage that already understands "this belongs to Research/F&A, not Bursar" out of the box — a concrete time-savings pitch for back-office staff.

---

## 7. Fully discoverable

College now has all 7 pages (5 domain command centers, Strategist, Executive Portal) live in the platform's Suite Hub discovery page, matching the pattern every other vertical uses.

**Business value:** table stakes, but worth noting — until this was fixed, a prospect or internal team member browsing the hub couldn't find College at all.

---

## Honest gap

There is **no College slide deck yet** on the Presentation Hub. That page only lists real `.pptx` files — none exists for College, so nothing was faked in to fill the space. A walkthrough deck for this vertical, using the structure above as an outline, is a natural next step.
