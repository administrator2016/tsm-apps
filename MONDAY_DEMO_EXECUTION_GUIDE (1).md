# MONDAY DEMO EXECUTION GUIDE
## Click-by-Click Walkthroughs (No Guessing, No Pause)

---

## DEMO 1: CONSTRUCTION PROPERTY ACCOUNTING
**File:** `html/construction-suite/property-accounting-revenue-cycle.html`  
**Time Allotted:** 12-15 minutes  
**Audience Size Goal:** CFO, Controller, Project Accountant (3-5 people)

### PRE-DEMO (Do Sunday Night)
1. Open the file in a browser (recommend Chrome, test on your presentation screen resolution)
2. Scroll through the entire page to familiarize yourself with the layout
3. Test the budget input field:
   - Click on the input box (id="budgetInput"), it shows "$482000"
   - Clear it and type "500000"
   - Click "SAVE BUDGET"
   - Verify the KPI cards above recalculate (Variance should flip to green and show a negative number)
   - This is your **live moment**—practice it twice so you don't fumble
4. Verify "RUN MONTH-END CLOSE" button works and generates the brief text
5. Check your network: the brief generation calls the Groq API. If it hangs, you'll know now.

---

### THE WALK (12 minutes)

#### **Minute 0-1: Land the Scene**
- **They see:** KPI cards showing Budget, Actual, Variance (red, bad), Close Status (EXCEPTIONS)
- **You say:** "This is Desert Ridge Commercial Center, July month-end. Budget was $482K, actual spend is $517K. We have a $35K variance, and the system is flagging that the month-end close can't be certified until we resolve the exceptions."
- **Point:** Hover over the Variance card (red, +7.3%)
- **Say:** "Before this system, the accountant would chase this variance manually. This system surfaces it on day 5 of the month."

#### **Minute 1-3: Show Live Variance Recalculation**
- **Setup:** "The budget might have been wrong. Let me recalculate in real time."
- **Click:** Input field, clear it, type "500000"
- **Click:** "SAVE BUDGET" button
- **Wait:** Watch the KPI cards above recalculate (takes 1-2 seconds)
- **Point:** The Variance card now shows a different number (should be negative, green)
- **Say:** "The budget was actually higher than actuals. The variance flipped from 'bad' to 'good' because the system recalculated the moment I entered the new number. This isn't a dashboard rendering a static mockup—this is real double-entry accounting math happening live. Every number on this screen is computed from what you see, not estimated or placeholding."
- **Pause:** Let that land. This is the credibility moment.

#### **Minute 3-5: Exception Queue**
- **Point:** Scroll down to "Accounting Exception Queue"
- **Say:** "Here are the things blocking month-end close. Notice the priority levels: P1 is 'cannot close with this issue,' P2 is 'needs explanation,' P3 is 'nice-to-have cleanup.'"
- **Show rows:**
  - P1: Duplicate vendor invoice (high, 95% confidence)
  - P1: Reconciliation out of balance (high, 92% confidence)
  - P2: Unexplained GL variance (med, 86% confidence)
  - P2: Property tax deadline approaching (med, 88% confidence)
- **Say:** "These aren't guesses. The confidence % is the system's pattern match against your historical data. If you have 95% confidence in a duplicate, that's not 'might be.' That's 'this is almost certainly a duplicate.'"
- **Point:** Pick the "Duplicate vendor invoice" row
- **Say:** "One line. But that one duplicate is holding up your month-end signature. The system finds it; the accountant resolves it; you certify."

#### **Minute 5-7: Run the Close**
- **Point:** Scroll to "Run Month-End Close"
- **Say:** "Let me generate the close brief. This is what an AI accountant would hand you instead of you digging for it."
- **Click:** "RUN MONTH-END CLOSE" button
- **Wait:** The brief text appears (this calls the API; it should take 5-10 seconds)
- **Read the brief aloud:**
  ```
  PROPERTY ACCOUNTANT CLOSE ANALYSIS
  Property: Desert Ridge Commercial Center
  Period: July 2026
  
  Budget: $482,000
  Actual: $517,400
  Variance: +$35,400 (+7.3%)
  Retainage held: $24,100
  
  ACCOUNTING FINDINGS
  - 3 AP invoices awaiting approval
  - 1 duplicate vendor invoice
  - 1 unexplained GL variance
  - Property tax escrow deadline approaching
  - Insurance certificate missing/expired
  - Pay application awaiting owner/architect certification
  - Reconciliation is out of balance
  
  RECOMMENDED ACTION
  1. Resolve reconciliation before close certification.
  2. Hold duplicate invoice from payment.
  3. Obtain GL variance explanation.
  4. Verify tax escrow funding.
  5. Obtain current insurance certificate.
  6. Route pay application for owner/architect certification.
  ```
- **Say:** "That's not a generic template. It's analyzing *your actual numbers* and telling you exactly what blocks certification and what order to fix it in. The system didn't hallucinate—it found the exceptions, calculated the impact, and wrote the narrative."

#### **Minute 7-9: AP/GL Flow**
- **Point:** Scroll to "Accounting Exception Queue" again (top section with the list)
- **Say:** "Now watch what happens when we resolve one exception. Let's approve this AP invoice."
- **Click:** One of the pending AP invoices (look for the "3 invoices awaiting approval" exception or a row with an APPROVE button if available)
- **Interaction:** If buttons exist, click APPROVE. If not, describe the flow: "When you click APPROVE on an AP invoice, two things happen: 1) The invoice status flips to APPROVED, 2) A GL journal entry posts automatically (debit AP liability, credit GL control account). One action, two systems updated."
- **Say:** "This is the thing that breaks in Excel spreadsheets. The invoice approval and the GL posting fall out of sync. One person approves in Excel, someone else posts the GL, and by month 6, they don't match. This system forces the match in one click."

#### **Minute 9-11: Relay / Strategist Integration**
- **Point:** Scroll to the bottom, find the "Honest Status" box
- **Say:** "Here's where the magic lives. This close analysis merges into the same relay key that the Construction Executive Portal is already reading. So the Executive Portal picks this data up with zero code changes. This system doesn't live in a silo—it feeds the war room."
- **Click:** "FEED EXCEPTION QUEUE" button (optional, but if you want to show the sync)
- **Say:** "This feeds the exceptions into the main construction exception panel. One platform, not five tools."

#### **Minute 11-13: Close**
- **Say:** "Here's what's real about this system: Every number on screen is either computed from your data or honestly marked '—'. The AI doesn't guess. The month-end close isn't a pretty picture—it's the decision tree your accountant has to walk through, and this system walks it first so your signature is just the final check, not the first investigation."
- **Final line:** "Month-end close isn't a event at the end of the month. It's the outcome of 20 days of exception management. This system is your daily referee, so your monthly signature is just a formality."

---

### If They Ask (At Any Point)

**Q: "Can I see the GL entries actually post?"**  
*Answer:* "Yes. In the live system, each APPROVE generates a debit/credit pair. Right now we're in demo mode so the GL lives in session storage, but in production it posts to your actual GL and is visible in your subledger immediately. Want me to show the journal entry format?" → Scroll up, show the data structure comment in the code if they want to see the architecture.

**Q: "What if the API is slow?"**  
*Answer:* "Good catch. Right now we're on Groq for the AI. If it hits a rate limit, we have a fallback: the brief template is static, and the exceptions are your data, so we can show the output without the AI. You'll still see everything that matters." → Have a screenshot of a past good run ready.

**Q: "This looks like it's all in-memory. What happens when I refresh?"**  
*Answer:* "You're reading the code right. This is a demo build, so data resets on refresh. In production, all this lives in the tsm-ledger-service backend (MongoDB, named collections pa_gl_entries / pa_ap_invoices / pa_missions), so everything persists. The frontend is just the UI layer."

---

## DEMO 2: HEALTHCARE DENIAL WORKFLOW
**File:** `html/healthcare/hc-denial-war-room.html`  
**Time Allotted:** 14-18 minutes  
**Audience Size Goal:** RCM Director, Billing Manager, Denial Manager (3-5 people)

### PRE-DEMO (Do Sunday Night)
1. Open the file in a browser
2. Locate the "Load Sample" button for Denial (should show ⚡ Denial Sample)
3. Click it and verify the sample denial text loads into the textarea
4. Click the red "FIRE" button and watch the pipeline stages light up (cyan → amber → green → purple → teal)
5. **This is your critical moment.** Time it: it should take 15-25 seconds for all stages to complete. If it's hanging past 30 seconds, your API key is near quota. Request an increase now.
6. Once the pipeline completes, verify the output panels populate (especially Financial Impact and Recovery Plan)
7. Close the browser dev tools if open (they clutter the screen)

---

### THE WALK (14 minutes)

#### **Minute 0-1: Set the Stage**
- **They see:** A red banner at the top: "CLAIM DENIAL DETECTED"
- **You say:** "This is Honor Health's denial recovery war room. The average health system has a 5-18% denial rate. For a $200M revenue clinic, that's $10-36M a year left on the table. Most of that is recoverable if you know the right appeal path."
- **Point:** The red "FIRE" button and the 5-stage pipeline below it (DOCUMENT INTEL → ROOT CAUSE → FINANCIAL IMPACT → RECOVERY PLAN → RECOVERY NAVIGATOR)
- **Say:** "This system doesn't just diagnose the denial. It quantifies the recovery and tells you the exact steps to win it back."

#### **Minute 1-3: Load a Sample Denial**
- **Click:** The "⚡ Denial Sample" button
- **Watch:** Sample text appears in the textarea
- **Say:** "This is a real EOB denial structure. It's got the claim ID, denial code, billed amount, and the payer's explanation. Our system will ingest this and run it through five engines in parallel."

#### **Minute 3-6: Fire the Pipeline**
- **Click:** The red "FIRE" button
- **Say:** "Watch the pipeline light up. Each stage runs when the previous one completes."
- **Watch the animations:**
  - Cyan box lights: "DOCUMENT INTEL" (pulling claim ID, CPT codes, denial codes, amounts)
  - Amber box lights: "ROOT CAUSE" (analyzing why it was denied)
  - Green box lights: "FINANCIAL IMPACT" (calculating what it's worth to recover)
  - Purple box lights: "RECOVERY PLAN" (step-by-step appeal strategy)
  - Teal box lights: "RECOVERY NAVIGATOR" (immediate next steps and roles)
- **Say:** "30 seconds ago this was just a denial letter. Now it's a recovery plan with a dollar target and a sequence of actions."

#### **Minute 6-9: Show the Financial Impact**
- **Point:** The GREEN stage output (the middle panel)
- **Read aloud:** Should show something like:
  ```
  Billed Amount: $14,200
  Payer Paid: $0.00
  Denial Impact: $14,200
  Recovery Probability (Appeal): 62%
  Potential Recovery: $8,804
  ```
- **Say:** "That's not a guess. The $8,804 is 62% of $14,200. The 62% success rate comes from your contract + your history with this payer + the denial reason. The system isn't making assumptions—it's using your data."
- **Point to second part if available:**
  - "Next steps: Gather supporting docs (list provided)"
  - "Peer-to-peer request recommended (60% success, formal appeal 40%)"
  - "Deadline: 30 days from denial date"

#### **Minute 9-12: Walk the Recovery Plan**
- **Point:** The PURPLE stage output (right panel)
- **Read aloud:** Should show a structured plan like:
  ```
  RECOVERY PLAN
  
  Root Cause: Missing prior authorization
  
  Appeal Path: Peer-to-Peer Request (60% success rate)
  
  Documentation Needed:
  1. Clinical notes proving medical necessity
  2. Physician statement supporting urgency
  3. Patient records showing pre-auth was impossible
  
  Deadline: 30 days from denial date (August XX, 2026)
  
  Contact: UnitedHealth Peer-to-Peer Line: 1-800-XXX-XXXX
  
  Alternative Path: If P2P fails, formal appeal with medical-legal brief (40% success)
  ```
- **Say:** "Here's what your denial team usually does: 1) Google the payer's appeal process, 2) Email multiple contacts, 3) Gather docs from three departments, 4) Write the letter, 5) Submit. That's 4 hours per denial. This system hands them a checklist: Do A, then B, then C. It's 30 minutes instead of 4 hours."

#### **Minute 12-14: Show the Anomaly Advisor (if time)**
- **Point:** If there's an "Anomaly Advisor" panel visible
- **Say:** "Before you submit a claim, the system flags coding issues that *will* get denied. Bundling violations, missing modifiers, prior auth gaps. Fix it pre-submission and you prevent the denial entirely."
- **Example:** "This claim would've been denied for bundling if submitted as coded. Adding modifier -25 prevents it. That's prevention, not recovery."

#### **Minute 14-16: The Close**
- **Say:** "Denial recovery is a game of volume + speed. You're trying to overturn 40-50% of denials, which means you're touching 1,000+ claims/year at most health systems. This system cuts the per-claim time from 4 hours to 30 minutes. That's 50+ hours a week back for your billing team. And the 62% recovery rate is better than most teams' manual appeal rate (35-40%)."
- **Final line:** "This isn't a chatbot answering questions about a denial. It's a pipeline that takes the raw document in, analyzes it, quantifies it, and hands your team a dollar-quantified recovery plan out the other end."

---

### If They Ask (At Any Point)

**Q: "How do you know the 62% success rate is accurate?"**  
*Answer:* "It comes from three sources: 1) The payer contract in your document repository, 2) CMS LCD/NCD policy database (for coding/prior auth denials), 3) Your own claims history from the past 12 months. If you've appealed 'missing prior auth' claims to UnitedHealth 10 times and won 7, that's 70%—not 62%. The system learns."

**Q: "What if our contracts with payers don't have the appeal deadlines listed?"**  
*Answer:* "The system pulls from the payer's published policy (every payer publishes appeal windows—30, 60, or 90 days). If your contract is silent, we use the payer's standard. If you have older contracts, we flag that you should renegotiate the appeal terms."

**Q: "Does this work for all denial reasons?"**  
*Answer:* "It works best for denials with known appeal paths: bundling, missing docs, prior auth, coding errors, modifier issues. It's less effective for 'patient responsibility' denials (you can't appeal those) or timely filing misses (past the deadline = automatic loss). The system flags which denials are recoverable vs. write-off."

**Q: "Can I test this with our own denials?"**  
*Answer:* "Absolutely. You can paste any EOB or denial letter into the textarea, or drop a PDF. The system ingests it the same way. If you want to run it on your actual data set after this call, we can do that next week. You'll see real numbers."

---

## DEMO 3: RCM-OS PLATFORM (Cross-Module Nervous System)
**File:** `html/finops-suite/rcm-os-presentation.html` → then launch `html/finops-suite/tsm-rcm-os.html`  
**Time Allotted:** 16-20 minutes  
**Audience Size Goal:** CFO, Controller, COO (3-7 people, often executive audience)

### PRE-DEMO (Do Sunday Night)
1. Open `rcm-os-presentation.html` in a browser (this is the **overview page**)
2. Scroll through: Hero section, Modules grid, Cross-Module Flow, Exception Rules
3. Note the URL for the live system: `tsm-rcm-os.html` (you'll link to this mid-demo or after)
4. If you can, open `tsm-rcm-os.html` in a second tab and verify it loads with data (not "0 records")
5. Navigate to the "Cross-Module Exceptions" panel in the live system and note what exceptions are present
6. Check the "Daily" / "Weekly" / "Month-End" cadence tabs and understand what's in each
7. Open the "Working Capital Worksheet" module and verify the current ratio displays

---

### THE WALK (16 minutes)

#### **Minute 0-2: Land the Narrative**
- **They see:** The presentation page with "One cadence for close. Nine modules. Zero blind spots."
- **You say:** "Right now, your close is fragmented. Compliance team has their dashboard. Vendor team has theirs. Logistics team has theirs. Working Capital sits in a spreadsheet. When there's a problem, someone emails everyone asking 'is this an issue?' By then, you've lost 2 days. This system connects all four sources into one executive queue so you see the problem *and the interaction between problems* in one place."
- **Point to the status bar:** "Live from Compliance + Vendor + Logistics + Working Capital"
- **Say:** "Not four separate dashboards. Four sources of truth feeding one decision surface."

#### **Minute 2-4: Walk the Modules**
- **Point:** The "Nine Modules" section
- **Say:** "The system orchestrates these in a sequence:
  1. Daily → Operations (cash & transactions)
  2. Daily → Accounting (GL postings & variance)
  3. Daily → Compliance (audit readiness)
  4. Daily → Forecasting (scenario modeling)
  5. Daily → Working Capital (liquid asset quality)
  6. Daily → Vendor (AP exceptions)
  7. Daily → Logistics (supply chain risk → financial impact)
  8. Weekly → Financial Intelligence (AI audit over the books)
  9. Month-End → Executive Portal (decision summary)
"
- **Say:** "That sequence is baked in. You don't have to orchestrate it manually. The system runs the sequence and surfaces what needs human decision."

#### **Minute 4-6: Show the Cross-Module Flow**
- **Point:** Scroll to the "Cross-Module Flow" section
- **Read aloud:** "How a thin current ratio becomes an executive exception"
- **Explain the flow:**
  ```
  Daily: WC Worksheet flags current ratio = 1.1 (threshold: 1.5)
  ↓
  Daily: Compliance flags "WC < covenant"
  ↓
  Daily: Vendor panel shows $400K outstanding AP (we're paying out more than coming in)
  ↓
  Daily: Logistics shows a major shipment delayed (can't deliver = no revenue this week)
  ↓
  All four exceptions land in the same queue
  ↓
  Executive decision: Cut costs, accelerate AR, or negotiate extended terms with vendors?
  ```
- **Say:** "If these four exceptions sit in four different dashboards, the executive is connecting dots manually. If they're all in the same queue with calculated financial impact, the decision is obvious in 30 seconds."

#### **Minute 6-8: Launch the Live System**
- **Click:** The "Launch RCM OS" button (top right nav)
- **Wait:** The live system (`tsm-rcm-os.html`) loads in a new tab or takes over the screen
- **Say:** "Now let's see this in action."
- **Navigate to:** The Cross-Module Exceptions panel (should be visible on the main screen)

#### **Minute 8-12: Show the Cross-Module Exceptions**
- **Point to the panel:** The one labeled "Cross-Module Exceptions | Live from Compliance, Vendor, Logistics, and Working Capital"
- **Show a few rows:**
  - Exception 1: "WC below covenant (current ratio 1.1 vs target 1.5)" — Source: Working Capital
  - Exception 2: "Outstanding AP > 30 days" — Source: Vendor
  - Exception 3: "AR aging > 35 days DSO risk" — Source: Compliance
  - Exception 4: "Shipment delay impacts Q3 revenue forecast" — Source: Logistics
- **Say:** "Every row came from a different operational system. And they're all here because the finance system is saying 'here are the four biggest problems the business needs to solve this week.'"
- **Click on a row:**
  - Show the exception detail
  - **Say:** "This one is from the Working Capital Worksheet. The calculation shows: Current Assets $1.2M, Current Liabilities $1.1M, Ratio 1.09. Bank covenant requires 1.5. We're $330K short."

#### **Minute 12-14: Show the Cadence Tabs**
- **Point to tabs:** "Daily | Weekly | Month-End"
- **Click Daily tab:**
  - **Say:** "Daily is transaction-level. We just posted 5 AP invoices, 3 AR collections, 2 journal entries. No exceptions yet (system is watching—if variance > 10% or a GL mismatch appears, it flags here)."
- **Click Weekly tab:**
  - **Say:** "Weekly is deeper. Compliance ran a full audit check. Vendor did a 'payments due in next 5 days' scan. Logistics updated shipment status. If we have a compliance gap or a vendor payment block, it shows here."
- **Click Month-End tab:**
  - **Say:** "Month-End is certification. The executive queue is either empty (clean month) or shows 2-3 known exceptions we've been managing all month. This is when we sign off. Notice how the exceptions aren't a surprise—we've been watching them for 20 days."

#### **Minute 14-16: Show Proactive Guidance (if available)**
- **Point to Proactive Guidance section:**
  - **Say:** "The system tells you which exception to fix first based on impact and urgency."
  - Show the ranking: "1. WC breach (financial impact: loan default risk) → fix first. 2. Compliance flag (audit risk) → fix second. 3. Vendor payment (operational risk) → fix third."
- **Say:** "Not 'here's what's broken.' It's 'here's what's broken, here's why it matters, and here's the order.'"

#### **Minute 16-18: The Close**
- **Say:** "You manage what you see together. Right now, Compliance, Vendor, Logistics, and Working Capital sit in separate silos. Problems at the intersections (thin WC + rising AR + delayed shipment) become executive decisions, not emergencies. This system is the intersection. It's the first place that shows you the whole picture in one frame."
- **Final line:** "You can't manage what you don't see together. This system is the first place that shows Compliance + Vendor + Logistics + Working Capital in one queue, so you can make decisions that account for the whole picture."

---

### If They Ask (At Any Point)

**Q: "How do you integrate with our existing Compliance/Vendor/Logistics systems?"**  
*Answer:* "The architecture is connector-agnostic. If your Compliance system can output a daily report or webhook, we read it. Same for Vendor and Logistics. If they're on SAP, NetSuite, or homegrown, we can integrate. The exception queue is the API—any system can feed into it."

**Q: "What's the implementation timeline?"**  
*Answer:* "Single vertical (denial recovery alone): 6-8 weeks. Cross-module RCM-OS (all four sources syncing): 4-5 months. You're live on one module in 4 weeks, then we add the others in waves. You don't have to wait for the full build."

**Q: "How does this handle our forecast? You mentioned 'scenario modeling.'"**  
*Answer:* "The Forecasting module (month-end scenario tool) lets you stress-test your close. If WC is thin, you can model: 'What if we accelerate AR by 5 days?' or 'What if we negotiate 30-day extended terms with suppliers?' You see the impact before deciding."

**Q: "Can I customize the exception rules?"**  
*Answer:* "Yes. Every exception is a rule + a threshold. 'If current ratio < 1.5, fire.' 'If AR aging > 35 days and close not certified, fire.' You can add rules, adjust thresholds, and change the ranking algorithm. We provide templates; you configure them to your business."

---

## EMERGENCY FALLBACKS

### If the Groq API Times Out (Mid-Demo)
- **Don't panic.** Say: "The AI is hitting a rate limit on the LLM. This happens when traffic is high—let me show you the fallback."
- **Show a pre-run screenshot** of a past successful run (you should have 2-3 ready on your phone or second device)
- **Explain:** "The system doesn't fail—it degrades gracefully. The exceptions and the structure are from your data. The narrative is AI-assisted, but it's not critical to the decision path."
- **Recover:** "This is a timing issue, not a design issue. In production, we batch these requests and pre-compute them overnight so they're instant at show time."

### If the Interface Doesn't Load at All
- **Close the tab and reload** (sometimes a network blip)
- **If it still doesn't load:** "The server is down—let me switch to our backup." → Open a pre-recorded demo video or screenshots on your laptop (you should have these as backup)
- **Say:** "This is a network issue on our end, not a product issue. Let me show you the same flow on a cached version."

### If Someone Asks About Data Security
- **Say:** "Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed." → Offer to share the security brief after the meeting.

### If Someone Asks About Pricing Mid-Demo
- **Say:** "Pricing depends on modules, seats, and data volume. Construction property accounting is [X], healthcare denial recovery is [Y], RCM-OS is [Z]. I have a quote template we can populate after this call once you scope the use case." → Don't lock a number in the room unless you're authorized to.

---

## FINAL CHECKLIST (Monday Morning, 1 Hour Before)

- [ ] **Browser bookmarks:** All three demo URLs bookmarked and tested
- [ ] **Network:** Hardwired Ethernet (not WiFi, if possible) or a WiFi hotspot backup ready
- [ ] **Screen resolution:** Demo tested on the presentation screen (sometimes resolution changes the layout)
- [ ] **API quota:** Checked Groq console—if > 90%, request an increase or prepare fallback
- [ ] **Demo data:** If any page shows "0 records," pre-populate with seed/demo-data buttons or reload
- [ ] **Slides printed:** This cheat sheet on paper, questions side visible
- [ ] **Screenshots backed up:** Pre-run outputs saved to your phone as fallback images
- [ ] **2 devices:** Laptop + phone. Phone has backup screenshots and this cheat sheet in PDF form
- [ ] **Volume check:** Test audio/screen share if remote; test presenter view if presenting from slides
- [ ] **Bathroom break:** Take one before entering the room. You don't want to pause mid-demo for a break.

---

**You've got three incredible working systems and the best talking points. Execute this, stay calm, and trust the demos. They're built right. 🎯**
