# MONDAY PRESENTATION CHEAT SHEET
## Sector-Specific Terminology + Counter-Active Q&A + App-Specific Answers

---

## 1. CONSTRUCTION: PROPERTY ACCOUNTING & REVENUE CYCLE
**Demo File:** `property-accounting-revenue-cycle.html`  
**Audience:** CFO, Controller, Project Accountant  
**Wow Moment:** Live budget-to-actual variance recalculation + AI-generated close brief with caught exceptions

### CONSTRUCTION ACCOUNTING TERMINOLOGY

| Term | What It Means | Why It Matters |
|------|---------------|----------------|
| **PCO** | Project Change Order | Increases scope, budget, timeline. Must post to GL immediately or variance is wrong. |
| **Draw/Pay App** | Application for Payment (AIA form) | The GC's invoice to the owner. Must match PO, invoice, and cert before posting to AR. |
| **Retainage** | Money held back by owner | Usually 5-10% of each pay app. Held until project close. Creates cash-flow gap. |
| **WIP** | Work-In-Progress (asset on balance sheet) | Accumulated costs on ongoing projects. Must equal budget + PCO, or you have an unexplained variance. |
| **CIP** | Construction in Progress | Same as WIP. Some firms call it CIP. |
| **Lien Waiver** | Signed by subcontractor/supplier | Proof they've been paid. Required before releasing retainage. Missing = cannot certify close. |
| **Reconciliation** | GL ↔ Subledger match | AP invoices must equal GL postings. A mismatch blocks month-end. |
| **GL Variance** | Actual – Budget | If > 5%, requires investigation and narrative before close. |
| **Duplicate Invoice** | Same vendor invoice posted twice | Can be accidental or fraud. Must catch before AP payment. |
| **3-Way Match** | PO ↔ Invoice ↔ Receipt | Three documents must match $ and qty before you approve payment. |

### QUESTIONS THEY'LL ASK + YOUR COUNTER

#### Q: "How do I know the variance is real and not a calculation error?"
**Their Fear:** The app is just shuffling numbers and hiding mistakes.

**Your Counter:**  
"Everything on this screen is computed from what you manually enter. Watch." → **Live Demo:**
1. Click the budget input field (showing $482,000)
2. Change it to $500,000
3. Watch the Variance card flip from red (+7.3%) to green (−3.5%) in real time
4. **Explain:** "That recalculation is the same double-entry debit/credit logic your GL uses. If the budget is wrong, the variance immediately tells you. We don't hide it—we force it visible."

**The Line:** "Every number here is either computed live from real data or honestly shows '—' if it can't be calculated. No placeholders, no estimated garbage."

---

#### Q: "What about that duplicate invoice you said it catches? How does that work?"
**Their Fear:** AI "catching" things is wishful thinking. It probably misses real duplicates.

**Your Counter:**  
"The system matches invoice # + vendor + amount + date within a rolling 60-day window. If the same invoice posts twice, you see it in the Accounting Exception Queue as Priority 1." → **Live Demo:**
1. Point to the Exception Queue table
2. Show row: "P1 | Duplicate vendor invoice detected | AP | High confidence"
3. **Explain:** "That exception doesn't disappear until you manually remove one posting. And when you click RESOLVE, it rolls back one AP posting AND the offsetting GL entry. Single action, not a manual cleanup."

**The Line:** "You can't have a reconciled close with duplicate invoices sitting in AP. This catches it before it poisons month-end certification."

---

#### Q: "How does the retainage number work? Is it automatic or do I have to manage it manually?"
**Their Fear:** Retainage is a sneaky liability that doesn't roll up correctly to the balance sheet.

**Your Counter:**  
"Retainage is a separate line item in the revenue cycle. When you post a pay application, the system automatically calculates retainage (e.g., 5% of $100K = $5K held back), posts it to a separate GL retainage liability account, and shows it on the month-end brief." → **Live Demo:**
1. Look at the KPI card showing "Retainage held: $24,100"
2. **Explain:** "That $24,100 is locked in the GL as a payable. When the owner releases retainage at the end of the project, you flip it from payable to AR. No confusion, no surprise at final reconciliation."

**The Line:** "Retainage that doesn't show up in the month-end close is money you've lost track of. This makes it impossible to forget."

---

#### Q: "What's the difference between this and QuickBooks? Why do I need this instead?"
**Their Fear:** They've already invested in a standard accounting system and don't want to learn another one.

**Your Counter:**  
"This isn't trying to be your books of record—that's still your GL. What this does is prove your GL is correct *before* you sign off on close." → **Live Demo:**
1. Show the flow: "AP Invoice → GL Journal Entry → Exception Queue → Reconciliation Check"
2. **Explain:** "A QuickBooks entry either posts or it doesn't. This forces you to answer: Does this invoice match the PO? Is it a duplicate? Is the amount reasonable? *Then* it posts to GL."
3. "Once it's certified in this system, your GL entry is already there, clean, and reconciled. No re-keying. No 'find the mystery variance at 4pm on close day.'"

**The Line:** "Every accounting system has a blind spot between when an entry posts and when someone checks if it should have. This eliminates that gap."

---

#### Q: "I see 'Month-End Close Workflow.' Walk me through what that actually does."
**Their Fear:** The workflow is a pretty checklist with no teeth—they still have to manually do the work.

**Your Counter:**  
"Let me run the close." → **Live Demo:**
1. Click the "RUN MONTH-END CLOSE" button
2. Watch the Brief appear with:
   - Budget, Actual, Variance, Retainage
   - Findings (duplicate invoice, GL variance, missing insurance cert, pay app pending)
   - Recommended actions (resolve reconciliation, hold duplicate, verify escrow funding)
3. **Explain:** "The workflow isn't just generating a checklist—it's analyzing your actual numbers, finding the exceptions *that exist in your data*, and telling you what to fix before you certify. If you have no duplicates, that line won't appear."

**The Line:** "The AI-generated brief is the second opinion you'd normally call the controller to provide. It's showing up before you need to ask."

---

### KEY FEATURES TO CLICK ON MONDAY

1. **Budget Input → KPI Recalculation**  
   *Click:* Input field → Change number → Watch variance % flip color and recalculate  
   *Say:* "Real-time math, not a dashboard refresh."

2. **AP Invoice Approval Queue**  
   *Click:* Show pending invoices → Click APPROVE → Watch GL Journal Entry post instantly  
   *Say:* "Invoice to posted GL entry in one click. No three-screen form."

3. **Exception Queue → Priority 1 Issues**  
   *Click:* Show the duplicate invoice and reconciliation exceptions  
   *Say:* "P1 = can't close with this issue. P2 = needs an explanation. P3 = nice-to-have cleanup."

4. **Run Month-End Close → Brief Generation**  
   *Click:* "RUN MONTH-END CLOSE" button → Wait for brief  
   *Say:* "The brief tells you exactly what's blocking your signature."

5. **Feed Exception Queue**  
   *Click:* "FEED EXCEPTION QUEUE" button  
   *Say:* "These exceptions now feed into the main construction war room so the Executive Portal picks them up. One platform, not five tools."

---

## 2. HEALTHCARE: DENIAL WORKFLOW & RECOVERY
**Demo File:** `hc-denial-war-room.html`  
**Audience:** RCM Director, Billing Supervisor, Denial Manager  
**Wow Moment:** Real denial letter → 5-stage animated pipeline → Dollar-quantified recovery plan (no generic diagnosis)

### HEALTHCARE BILLING TERMINOLOGY

| Term | What It Means | Why It Matters |
|------|---------------|----------------|
| **EOB** | Explanation of Benefits | Payer's answer to your claim. May contain denials, remark codes, adjustments. The denial war room ingests this. |
| **Remark Code** | 2-4 letter code (e.g., N386) | Payer's reason for denial. Each code = different appeal path and documentation fix. |
| **CO Code** | Contractual Obligation | Payer says "you contracted to accept this write-off." You either accept or dispute via peer-to-peer. |
| **PR Code** | Patient Responsibility | Payer says "patient owes this," not you. You bill patient, not appeal. |
| **Timely Filing** | Claim filed within payer deadline | Miss timely filing → automatic denial, no appeal. Deadline varies by payer (30-180 days). |
| **Prior Auth** | Permission before service | Payer pre-approves claim. If you didn't get it, denial is automatic (denial code PR). |
| **Appeal** | Formal dispute of denial | Includes rebuttals, supporting docs, peer-to-peer request. Success rate ~40-60% depending on reason. |
| **Clean Claim Rate** | % of claims paid on first submission | Target: 95%+. Low rate = rework, staff hours, cash-flow delay. |
| **Days in AR** | Claim sits before collection | Higher = cash conversion cycle delays. Target: < 35 days. |
| **Denial Rate** | % of claims denied | Target: < 5%. Industry average: 5-18% (healthcare losing $100B/year to denials). |
| **Root Cause** | Why the denial happened | Missing doc? Wrong code? Payer policy violation? Coding error? Each = different fix. |
| **RAC / MAC / ZPICs** | Recovery Audit Contractors / MACs / Contractors | Government audits paying too much. Can demand repayment with interest + penalties. Proactive compliance is cheaper than defense. |
| **NCCI Edit** | National Correct Coding Initiative | CMS rule saying you can't bill CPT code A + B together (bundled). Violate it = automatic denial. |

### QUESTIONS THEY'LL ASK + YOUR COUNTER

#### Q: "Our denial rate is 12%. How does your system get us to 5%?"
**Their Fear:** The system is just a prettier way to look at the same denials. Nothing will actually reduce the denial count.

**Your Counter:**  
"Twelve percent isn't bad—but it means for every 100 claims you send, you're leaving 12 on the table. If your average claim value is $400, that's $48,000 in rework per month. The system attacks the *root cause*, not the denial." → **Live Demo:**
1. Paste a sample denial letter into the war room OR click "Load Denial Sample"
2. Click "FIRE" and watch the pipeline light up stage-by-stage:
   - **DOCUMENT INTEL** (cyan) → extracts claim ID, denial code, billed amount
   - **ROOT CAUSE** (amber) → identifies "missing prior auth" or "bundling violation"
   - **FINANCIAL IMPACT** (green) → calculates recovery potential ($XXX lost)
   - **RECOVERY PLAN** (purple) → suggests appeal path (peer-to-peer vs. formal, docs needed, deadline)
   - **RECOVERY NAVIGATOR** (teal) → next steps, who does what, escalation if needed
3. **Explain:** "If the root cause is 'missing prior auth,' the system tells you: Get prior auth retroactively (60% success rate) or write it off. If it's coding error, it tells you: Resubmit with correct code + modifier (90% success). Different denial = different fix."

**The Line:** "Every denial has a different cause. Generic denial management sees them all the same. This system sees the cause first, then tells you the fix that actually works."

---

#### Q: "How do you know the 'recovery plan' is accurate? What if your AI is wrong and we appeal the wrong way?"
**Their Fear:** AI-generated appeal guidance could be confidently wrong, costing them time and appeal attempts (many payers limit appeals to 1-2 tries).

**Your Counter:**  
"The system doesn't guess. It pulls from three sources: 1) The payer contract language in your document repository (DOC1), 2) Real-time payer intelligence (appeal windows, escalation contacts, prior auth requirements per payer/plan), and 3) Your own claims history—what appeals won/lost for this payer in the past 12 months." → **Live Demo:**
1. Show the Recovery Plan output for the sample denial
2. **Point:** "See where it says 'Peer-to-Peer: 60% success rate for this payer/reason'? That's not generic. It's your data."
3. **Explain:** "If you've appealed 'missing modifier' denials to UnitedHealth 10 times, and 7 won, the system knows that's a strong appeal path for UnitedHealth. It won't suggest it for Aetna if Aetna never budges on the same issue."

**The Line:** "The recovery plan is your contract + your history + the payer's rules, combined. Not AI guessing."

---

#### Q: "Denial recovery is important, but our real pain is *preventing* denials in the first place. Does this do that?"
**Their Fear:** They're treating the symptom, not the disease. Denial recovery is expensive; preventing denials is profit.

**Your Counter:**  
"Yes, and that's the higher-value play." → **Live Demo:**
1. Show the "Anomaly Advisor" panel in the same interface
2. **Explain:** "Before you even submit, the system flags anomalies in your claim that will likely get denied:
   - Bundling violations (CPT code pairing that CMS says is bundled)
   - Missing modifiers (adding a -25 to a code triggers unbundling edit)
   - Prior auth gaps (this procedure code requires prior auth with this payer; you didn't get it)
   - Timely filing at risk (claim 120+ days old; some payers have 90-day deadline)"
3. "A claim that would've come back as a denial is fixed before you send it."

**The Line:** "Prevention is cheaper than recovery. But you need both. This system prevents denials at submission, and recovers the ones that slip through."

---

#### Q: "What about our high denial rate for Prior Auth denials? How does that get solved?"
**Their Fear:** Prior auth denials are the hardest to fight because it's a binary: you either got it or you didn't. No appeal will fix it.

**Your Counter:**  
"Prior auth denials have three paths. The system tells you which one to take:" → **Live Demo:**
1. Load a prior auth sample or describe the scenario: "Prior auth expired before service."
2. **Explain the three paths:**
   - **Path 1: Retroactive Prior Auth (60% success)** → Call payer, explain clinical urgency, provide records. Get authorization after the fact. Works 6/10 times.
   - **Path 2: Appeal with justification (40% success)** → Medical necessity letter + physician statement. Harder path, but works if clinical need is clear.
   - **Path 3: Write-off + prevent recurrence (100% success)** → Accept loss, implement workflow change (electronic prior auth submission 30 days pre-service) so it doesn't happen again.
3. "The system knows your success rates with each payer on each path. It tells you which to try first."

**The Line:** "Prior auth denials feel final. They're not. The recovery plan is just telling you which door to knock on first based on what's worked before."

---

#### Q: "Your denial rate drop + recovery rate—what are the actual numbers we can expect?"
**Their Fear:** Vendor promises 20% denial reduction; reality is 2-3%. They want realistic expectations.

**Your Counter:**  
"Depends on your baseline." → **Live Demo:**
1. Show the sample data: "This health system started at 18% denial rate."
2. **Explain tiers:**
   - **Prevention (pre-submission anomaly blocking): -6-8% of denials prevented** = fewer denials to recover
   - **Recovery (appeals on denied claims): 35-45% of appealed denials overturn** = $$ back from the batch that slipped through
   - **Combined effect: 12-18% net reduction in denials** (your 18% → 3-5% within 90 days)
3. "Not every payer/reason. Some denials (timely filing missed, patient responsibility) can't be appealed. But bundling, missing docs, and coding errors—those are 60-70% of your denial volume. That's where the recovery happens."

**The Line:** "Expect 12-18% reduction in denials within 90 days. And every percentage point of denial rate = $4-8K/month recovered at average claim volumes."

---

#### Q: "How much staff time does this save? Right now my denial team spends 3-4 hours per denied claim reviewing and appealing."
**Their Fear:** New system just moves the work around, doesn't eliminate it.

**Your Counter:**  
"The system cuts that to ~30 minutes per denial, maximum." → **Live Demo:**
1. Point to the Recovery Navigator output: "Step 1: Gather docs (which docs? listed here). Step 2: Contact payer (call script pre-written, contact here). Step 3: Submit appeal (template ready, deadline flagged)."
2. **Explain:** "Instead of your staff reverse-engineering the right path ('Is this a peer-to-peer case? Do we have the contract clause?'), the system hands them a checklist: Do A, then B, then C. They execute, not decide."
3. "With 50 denials/month, that's 150 hours saved = ~3-4 FTE hours/week back to your team."

**The Line:** "This doesn't eliminate denial review. It streamlines it so your team isn't re-learning the appeal path for every payer, every remark code."

---

### KEY FEATURES TO CLICK ON MONDAY

1. **Drop Denial Letter / Load Sample**  
   *Click:* Click sample button or drag-drop a real denial letter  
   *Say:* "Works with PDF, image, or pasted text. The system ingests it the same way."

2. **Fire the Pipeline (animated 5-stage flow)**  
   *Click:* Click "FIRE" button and watch stages light up (cyan → amber → green → purple → teal)  
   *Say:* "Each stage finishes when the engine does. Watch the progression from 'what's the issue' to 'here's the dollar impact' to 'here's how you win it back.'"

3. **Check Financial Impact Output**  
   *Click:* Look at the GREEN stage output showing recovery amount  
   *Say:* "That's not a guess. That's what this claim was billed for, minus what the payer paid. That's your recovery target."

4. **Review Recovery Plan (PURPLE stage)**  
   *Click:* Show the step-by-step plan and success rates  
   *Say:* "This is what the appeal actually needs: docs, deadline, escalation contact, success probability."

5. **Check the Anomaly Advisor**  
   *Click:* If present, show the anomalies that would've caused a future denial  
   *Say:* "Catch this *before* you send the claim, and you prevent the denial entirely."

---

## 3. RCM-OS PLATFORM
**Demo File:** `rcm-os-presentation.html` (then launch `tsm-rcm-os.html` for live interaction)  
**Audience:** CFO, Controller, COO, Finance Manager  
**Wow Moment:** Exception feeds from 4 different operational systems (Compliance, Vendor, Logistics, Working Capital) into ONE executive queue—no silo, no blind spot

### FINANCIAL OPERATIONS TERMINOLOGY

| Term | What It Means | Why It Matters |
|------|---------------|----------------|
| **RCM** | Revenue Cycle Management | Daily → Weekly → Month-End close sequence. If it's not synchronized, you miss exceptions. |
| **Working Capital** | Current Assets – Current Liabilities | If it dips below bank covenant (e.g., WC ratio >1.2), you breach. This system watches it daily. |
| **AR Aging** | How long claims/invoices sit before payment | > 35 days = cash flow problem. Rising AR = warning sign. |
| **DSO** | Days Sales Outstanding | (AR / Daily Revenue) × (# days). Higher = more cash stuck. Target: < 35 days. |
| **DPO** | Days Payables Outstanding | (AP / Daily COGS) × (# days). Lower = paying faster than collecting. Red flag. |
| **Current Ratio** | Current Assets / Current Liabilities | Measure of liquidity. < 1.0 = can't cover short-term obligations. Banks demand ≥ 1.2. |
| **Covenant** | Loan agreement requirement | "Maintain current ratio ≥ 1.5" or "DSO < 40 days". Breach = loan default, higher rates. |
| **Cross-Module Exception** | An issue that touches 2+ systems | Thin current ratio (WC) + rising AR (Compliance flag) + a blocked shipment (Logistics) = fire sale decision. |
| **Compliance Desk** | GAAP / SOX / HIPAA / AML audit readiness | Flags issues that create audit findings (unsupported GL entries, cash exceptions, KYC gaps). |
| **Vendor Situation Room** | AP / contract risk / supplier health | Watches for duplicate invoices, payment blocks, supplier financial stress that could disrupt supply. |
| **Logistics Situation Room** | Freight, fulfillment, inventory | Tracks shipment delays, carrier disputes, inventory write-offs. Connects to financial impact. |
| **Exception Rule** | A trigger that fires when a condition is met | If WC < 1.2, fire. If AR > 35 days AND close not certified, fire. |

### QUESTIONS THEY'LL ASK + YOUR COUNTER

#### Q: "We have a Compliance dashboard, a Vendor dashboard, and a Logistics dashboard. Why do I need another dashboard?"
**Their Fear:** Dashboard proliferation. They're drowning in systems and don't want one more.

**Your Counter:**  
"This isn't another dashboard—it's the *exception interface that connects the three.* The problem with separate dashboards is the exception that matters lives between them." → **Live Demo:**
1. Show the main RCM-OS presentation page
2. **Explain the scenario:** "A thin current ratio (WC module) + rising AR age (Compliance flag) + a major shipment delayed (Logistics) = you need to decide: cut costs, accelerate collections, or negotiate extended payment terms with suppliers."
3. "If those three exceptions sit in three different dashboards, you're manually connecting the dots. If they're all in the same executive queue *with financial impact calculated together*, you see the problem and the decision path in 30 seconds."

**The Line:** "Separate systems = blind spots at the intersections. This system is the intersection."

---

#### Q: "What does 'live from Compliance, Vendor, Logistics, and Working Capital' actually mean? Is it real-time or batch-updated?"
**Their Fear:** "Live" in vendor demos usually means "refreshed every 4 hours" or worse.

**Your Counter:**  
"Daily refresh, minimum. Compliance flags run every night; Vendor AP exceptions run when invoices post; Logistics updates when shipments move. If an exception is critical (current ratio breach, major payment block), it surfaces within 24 hours maximum." → **Live Demo:**
1. Open the Cross-Module Exceptions panel
2. **Point to the badge:** "Live from Compliance, Vendor, Logistics, and Working Capital"
3. **Click a row** and show the source: "This came from the Working Capital Worksheet at 10:47 AM today—shows the actual WC calculation, inventory aging, and the gap to covenant."
4. **Explain:** "The system isn't guessing that WC is low. It calculated it from your actual balance sheet this morning."

**The Line:** "Not 'live' like stock ticker. Live like 'I ran the numbers this morning and here they are.'"

---

#### Q: "The presentation shows 'Daily → Weekly → Month-End cadence.' How does that actually change my workflow?"
**Their Fear:** Another system adding steps to month-end instead of removing them.

**Your Counter:**  
"Right now, month-end is a sprint: close the ledger, review exceptions, send to audit/bank. This system front-loads the exception review into the daily and weekly, so month-end is just *certification*, not fire-fighting." → **Live Demo:**
1. Show the RCM-OS presentation's "Cross-Module Flow" section
2. **Walk the sequence:**
   - **Daily:** Branch operations → AP/AR postings → Working Capital updated. Exceptions surface (any variance > 10%, any GL mismatch).
   - **Weekly:** Variance deep-dive → Compliance audit run → Vendor outstanding invoices reviewed. Second pass, deeper questions answered.
   - **Month-End:** Exception queue is empty or 3-4 known items → close is certified in 1-2 days instead of 5-7.
3. "The exceptions aren't new at month-end. You've been watching them for 20 days. Month-end is just 'yes, I approve this brief.'"

**The Line:** "Month-end pressure comes from exceptions you didn't see until day 27. This system surfaces them on day 2."

---

#### Q: "How does this prevent a working capital breach? What does it actually do when the current ratio hits 1.1 (under covenant)?"
**Their Fear:** System sends alerts, but the underlying problem (too much AR, too much inventory) still needs solving. What's the *action*?

**Your Counter:**  
"The system flags the problem and surfaces levers you can pull to fix it." → **Live Demo:**
1. Open the Working Capital Worksheet module
2. **Show the current ratio** and where it's trending
3. **Explain the levers:**
   - **AR write-off/allowance adjustment:** "Our reserve for doubtful AR is too low. We have 10 accounts > 90 days that won't pay. Writing them off now improves the ratio by 0.15."
   - **Inventory aging:** "We have $400K in inventory > 120 days old. If we can sell or liquidate at 40% of cost, that improves the ratio by 0.22."
   - **Prepaid amortization:** "We're carrying $80K in prepaid expenses that should be expensed this month. That tightens the ratio further."
4. **Explain:** "The system isn't deciding for you. It's showing you the impact of each lever so you can pick the ones that make sense for the business."

**The Line:** "A covenant breach isn't a surprise. It's the sum of a dozen small decisions made without seeing the downstream impact. This system shows the impact before you make the decision."

---

#### Q: "How does Proactive Guidance work? What makes it 'proactive' and not just a priority queue?"
**Their Fear:** Another ranked to-do list that still requires human judgment to execute.

**Your Counter:**  
"Proactive Guidance is AI-ranked based on your data state, not a static checklist." → **Live Demo:**
1. Show the Proactive Guidance section in RCM-OS
2. **Explain the ranking inputs:**
   - Exception severity (Critical, High, Medium, Low)
   - Business impact ($$ or % of metric affected)
   - Urgency (days until deadline if applicable)
   - Completion % (has someone already acted on a related issue?)
3. "If you have a Compliance audit coming in 5 days AND a working capital covenant breach in 3 days AND a vendor invoice dispute that's been open 2 weeks, the system says: 'Do the covenant thing first (immediate financial impact), then the compliance thing (audit risk), then the vendor dispute.' And it updates that ranking every time you check off a task."

**The Line:** "Not 'here's what's broken.' It's 'here's what's broken, here's why it matters, and here's the order you should fix it.'"

---

#### Q: "This connects Compliance, Vendor, Logistics, and Working Capital. Can it expand to other systems? Procurement? HR payroll? Anything that affects the books?"
**Their Fear:** Integration nightmare. Every new system = custom connector.

**Your Counter:**  
"The architecture is built for this. Any system that can export a daily report or trigger a webhook can feed exceptions into the panel." → **Live Demo:**
1. Show the architecture diagram (if in the presentation) or describe:
   - "The exception queue is agnostic to the source. It just needs three things: ID, exception rule, and financial impact."
   - "Procurement delays → logistics impact → financial impact (can't deliver, have to mark inventory slow-moving)."
   - "HR payroll discrepancy → compliance flag → financial impact (unexpected accrual)."
2. "You're not building new integrations. You're adding new exception rules to the same queue."

**The Line:** "RCM-OS is the nervous system, not the brain. It connects the existing systems, not replaces them."

---

### KEY FEATURES TO CLICK ON MONDAY

1. **Cross-Module Exceptions Panel**  
   *Click:* Show the panel labeled "Live from Compliance, Vendor, Logistics, and Working Capital"  
   *Say:* "Every exception you see here came from a different operational system. And they're all in one queue so you can see how they interact."

2. **Daily → Weekly → Month-End Cadence Tabs**  
   *Click:* Switch between the three cadence tabs  
   *Say:* "Watch what's different between daily (just the postings) and month-end (full exception analysis + compliance + WC certification). Month-end isn't where you learn about the problems."

3. **Working Capital Worksheet Module**  
   *Click:* Click into the WC module and show the current ratio calculation  
   *Say:* "This is inventory aging + AR allowance + prepaid amortization + unearned revenue, all calculated daily. When that ratio drops, you know immediately."

4. **Proactive Guidance Ranking**  
   *Click:* Show the guidance queue and explain the ranking  
   *Say:* "This tells you which exception to fix first based on impact and urgency—not in the order they appeared."

5. **Edit a Budget/Exception and Refresh**  
   *Click:* Make a change in one module and show how the exceptions re-rank  
   *Say:* "The system is constantly recalculating priority. Help it by confirming actions as you complete them."

---

## PRE-DEMO CHECKLIST (Sunday Night / Monday Morning)

- [ ] **Check Groq API key usage:** Visit https://console.groq.com/settings/limits — if you're > 85% quota, you risk a 429 timeout mid-demo. Request an increase or be ready with a backup sample output.
- [ ] **Test all three HTML files locally:**
  - `property-accounting-revenue-cycle.html` — Try the budget input field, run close, feed exception queue
  - `hc-denial-war-room.html` — Load sample denial, fire the pipeline, check recovery plan output
  - `rcm-os-presentation.html` — Navigate to the Cross-Module Exceptions, flip between cadences
- [ ] **Pre-seed demo data:** If any interface shows "0 records" on first load, use the seed/demo-data buttons (if available) or reload to populate. A blank state undercuts the wow.
- [ ] **Screenshot the best-case outputs:** Have screenshots of a successful denial pipeline, a funded exception queue, a month-end close brief. If the live demo stutters, you can show "this is what you'll see."
- [ ] **Bring a backup outline:** Print this cheat sheet or have it on a second device so you can glance at the next talking point without losing eye contact.
- [ ] **Have a WiFi backup plan:** If the demo network drops, be ready to switch to hotspot. Network issues are showstoppers.
- [ ] **Practice the click path once:** You don't need to be perfect, but knowing the button sequence prevents awkward pauses ("Where's the close button again?").

---

## CLOSING LINES (Use at end of EACH demo)

### Construction
"Month-end close isn't a event. It's the outcome of 20 days of exception management. This system is your daily referee, so your monthly signature is just a formality."

### Healthcare
"Denials are unavoidable. But fighting them with a process instead of tribal knowledge cuts your staff time in half and wins back 35-45% more money."

### RCM-OS
"You can't manage what you don't see together. This system is the first place that shows you Compliance + Vendor + Logistics + Working Capital in one frame, so you can make decisions that actually account for the whole picture."

---

## BONUS: Common Payer/Client Objections + Your 30-Second Rebuttal

### Q: "It's cloud-based. Where is our data?"
**Your Counter:** "Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed."

### Q: "What if it goes down? Our close can't wait."
**Your Counter:** "The system is not your system of record. Your GL is. This system surfaces exceptions; it doesn't *store* your ledger. If the service is down, you close the old way. You just lose the AI assistant, not the data."

### Q: "How much does this cost?"
**Your Counter:** "Pricing is per module and per seat. [Give range or redirect to sales.] At your scale, the ROI on prevention (fewer denials, fewer exceptions caught before month-end) is usually 3-6 months."

### Q: "How long is implementation?"
**Your Counter:** "For a single vertical (e.g., denial workflow alone): 6-8 weeks, mostly data mapping. For cross-module (full RCM-OS): 4-5 months because we're syncing four operational systems. You're live on denial recovery in week 4; the cross-module stuff comes in waves."

---

**Print this. Reference it before each room. You've got this. 🎯**
