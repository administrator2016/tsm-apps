# TSM AuditOps Manual

## Operational Intelligence + BPO Services Quick Start Playbook

---

# PURPOSE OF THIS MANUAL

This manual teaches:

* How TSM BPO Services work
* What WIP means
* How to explain BNCA
* How to run executive demos
* How to operate the apps
* How to restart systems quickly
* Which URLs matter most
* Which documents to upload
* How to speak during presentations
* How to troubleshoot the environment

This is the internal operator handbook for running TSM Matter.

---

# SECTION 1 — WHAT TSM REALLY IS

## TSM Is NOT:

* just an AI chatbot
* just dashboards
* just document upload
* just automation

## TSM IS:

An operational intelligence layer.

TSM turns:

* documents
* queues
* workflows
* approvals
* exceptions
* backlog
* WIP
* operational risk

into:

* visibility
* ownership
* prioritization
* escalation
* executive reporting
* BNCA (Best Next Course of Action)

---

# SECTION 2 — CORE TSM CONCEPTS

## BNCA = Best Next Course of Action

BNCA means:

“What should happen next?”

Examples:

### Construction

* Escalate delayed RFI
* Assign superintendent review
* Flag cost drift

### Healthcare

* Escalate prior authorization
* Route denial to appeals
* Flag AR aging

### FinOps

* Reconcile invoice mismatch
* Assign controller review
* Flag duplicate payment risk

### Legal

* Route contract for review
* Escalate compliance issue
* Assign billing audit

### TaxOps

* Flag missing K-1
* Route IRS notice
* Assign reviewer

### RRD

* Escalate charge-off risk
* Assign collections owner
* Trigger recovery workflow

---

# SECTION 3 — WHAT WIP MEANS

## WIP = Work In Progress

WIP is unfinished operational work.

WIP tells executives:

* what is open
* what is aging
* what is delayed
* what is risky
* who owns it
* what needs action

## WIP Examples

### Healthcare

* prior auth queue
* unresolved denials
* AR aging

### Construction

* RFIs
* submittals
* pay apps
* incident reviews

### FinOps

* unreconciled invoices
* AP exceptions
* close blockers

### TaxOps

* missing documents
* returns awaiting review
* unresolved notices

### Legal

* matter intake backlog
* billing audit exceptions
* contract review queue

### RRD

* recovery queue
* payment disputes
* charge-off exposure

---

# SECTION 4 — CHARTS A–F

## Chart A = Queue Volume

“How much work exists?”

## Chart B = SLA Aging

“What work is becoming overdue?”

## Chart C = Risk / Exceptions

“What work contains problems?”

## Chart D = Owner Lane

“Who owns the next action?”

## Chart E = Financial / Recovery Impact

“What is the money impact?”

## Chart F = Resolution / Escalation Status

“What is resolved vs blocked?”

---

# SECTION 5 — HOW TO PRESENT TSM

## NEVER SAY:

“Here’s our AI.”

## SAY:

“This is an operational intelligence and workflow orchestration platform.”

---

# SECTION 6 — DEMO PRESENTATION FLOW

## Step 1 — Executive Framing

Goal:
Show operational chaos.

Say:

“Most organizations already have software. The problem is operational visibility, queue management, and escalation timing.”

---

## Step 2 — Intake

Show:

* uploaded documents
* queues
* work items
* intake forms

Goal:
Show operational complexity.

---

## Step 3 — AI Analyst

Run BNCA.

Goal:
Show:

* risk detection
* next actions
* owner assignment
* escalation logic

---

## Step 4 — Operating Lane

Show:

* queue ownership
* WIP
* SLA aging
* escalation status

---

## Step 5 — Executive Rollup

Show:

* financial impact
* operational pressure
* recovery opportunity
* staffing visibility

---

## Step 6 — Pilot Proposal

Never sell “everything.”

Sell:

* one workflow
* one queue
* one measurable outcome

---

# SECTION 7 — CORE BPO URLS

## Main BPO Hub

[https://tsm-shell.fly.dev/bpo/bpo-website.html](https://tsm-shell.fly.dev/bpo/bpo-website.html)

---

## ConstructionOps

[https://tsm-shell.fly.dev/bpo/bpo-construction.html](https://tsm-shell.fly.dev/bpo/bpo-construction.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/construction-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/construction-demo-flow.html)

---

## FinOps

[https://tsm-shell.fly.dev/bpo/finops-bpo.html](https://tsm-shell.fly.dev/bpo/finops-bpo.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/finops-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/finops-demo-flow.html)

---

## Healthcare

[https://tsm-shell.fly.dev/bpo/bpo-healthcare.html](https://tsm-shell.fly.dev/bpo/bpo-healthcare.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/healthcare-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/healthcare-demo-flow.html)

### War Rooms

Denial War Room:
[https://tsm-shell.fly.dev/html/healthcare/hc-denial-war-room.html](https://tsm-shell.fly.dev/html/healthcare/hc-denial-war-room.html)

A/R Recovery War Room — ranks open AR accounts by dollar exposure × aging risk, runs an AI recovery-plan pipeline on the top accounts, and syncs every ranked account into the Case Engine (bpo_cases). Has a button to pull in non-appealable/weak Denial War Room cases so a denial that won't win on appeal becomes an AR-recovery thread instead of falling through the cracks:
[https://tsm-shell.fly.dev/war-rooms/ar-recovery/](https://tsm-shell.fly.dev/war-rooms/ar-recovery/)

---

## LegalOps

[https://tsm-shell.fly.dev/bpo/bpo-legal.html](https://tsm-shell.fly.dev/bpo/bpo-legal.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/legal-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/legal-demo-flow.html)

---

## TaxOps

[https://tsm-shell.fly.dev/bpo/bpo-tax.html](https://tsm-shell.fly.dev/bpo/bpo-tax.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/taxops-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/taxops-demo-flow.html)

---

## RRD

[https://tsm-shell.fly.dev/bpo/rrd-bpo.html](https://tsm-shell.fly.dev/bpo/rrd-bpo.html)

### Demo Flow

[https://tsm-shell.fly.dev/demo-flows/rrd-demo-flow.html](https://tsm-shell.fly.dev/demo-flows/rrd-demo-flow.html)

---

## Internal Training

### Personal BPO Workflow

[https://tsm-shell.fly.dev/demo-flows/personal-bpo-guided-workflow.html](https://tsm-shell.fly.dev/demo-flows/personal-bpo-guided-workflow.html)

### WIP + Charts Training

[https://tsm-shell.fly.dev/demo-flows/wip-figures-charts-training.html](https://tsm-shell.fly.dev/demo-flows/wip-figures-charts-training.html)

### Career Training Platform

Study → knowledge check → scenario → readiness, per competency domain. Includes the Advanced Detection competency (fire/smoke/gas/alarm/monitoring) with a Honeywell simulation exercise — simulation evidence only, not a certification or field/sales experience claim:
[https://tsm-shell.fly.dev/tsm-career-training-platform.html](https://tsm-shell.fly.dev/tsm-career-training-platform.html)

---

# SECTION 8 — CONSTRUCTION DOCUMENTS TO UPLOAD

## FIELDOPS

Upload:

* weekly-progress-report-week-17.pdf
* incident-report-apr-14.pdf
* Weekly_Labor_Timesheet_Site_A.csv

---

## PLANROOM

Upload:

* site-plan-overall-master.pdf
* mep-coordination-drawings-level-1.dwg
* electrical-single-line-diagram.pdf

---

## RFI / SUBMITTALS

Upload:

* change-order-7-foundation.pdf
* subcontractor-bid-roofing.pdf
* building-permit-block-c-foundation.pdf

---

## COST CONTROL

Upload:

* q1-invoice-summary.xlsx
* GL_Extract_Q1.csv
* HOME_Expenditure_Log.xlsx
* invoice-q1.xlsx

---

## COMPLIANCE

Upload:

* osha-safety-plan-2026.pdf
* zoning-variance-application.pdf
* owner-architect-agreement.pdf
* Subcontractor_Final_Lien_Waiver.pdf

---

# SECTION 9 — QUICK START COMMANDS

## Go To Project

```bash
cd /workspaces/tsm-shell
```

---

## Check Git Status

```bash
git status
```

---

## Pull Latest

```bash
git pull
```

---

## Add Files

```bash
git add .
```

---

## Commit Changes

```bash
git commit -m "update"
```

---

## Deploy To Fly.io

```bash
fly deploy
```

---

## Restart PM2

```bash
pm2 restart all
```

---

## Check PM2 Apps

```bash
pm2 list
```

---

## Check Logs

```bash
pm2 logs
```

---

## Restart NGINX

```bash
sudo systemctl restart nginx
```

---

## Test NGINX

```bash
sudo nginx -t
```

---

## Reload NGINX

```bash
sudo systemctl reload nginx
```

---

## Check Open Ports

```bash
ss -tulnp
```

---

## Verify App URL

```bash
curl -I https://tsm-shell.fly.dev
```

---

# SECTION 10 — TROUBLESHOOTING

## Problem:

Page not updating.

### Try:

```bash
fly deploy
```

Then hard refresh browser.

---

## Problem:

PM2 app crashed.

### Try:

```bash
pm2 logs
pm2 restart all
```

---

## Problem:

NGINX broken.

### Try:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

---

## Problem:

AI route not responding.

### Check:

```bash
grep -n "/api/bpo/query" server.js
```

---

## Problem:

Fly deploy failing.

### Try:

```bash
fly status
fly deploy
```

---

# SECTION 11 — HOW TO SOUND ENTERPRISE

## DO SAY

* operational intelligence
* workflow orchestration
* queue visibility
* owner lane
* escalation path
* executive rollup
* operational risk
* SLA governance
* recovery opportunity
* operational bottleneck

---

## DO NOT SAY

* “cool AI tool”
* “chatbot”
* “it just analyzes PDFs”
* “magic AI”

---

# SECTION 12 — THE MOST IMPORTANT THING

The real value of TSM is not the dashboard.

The real value is:

* helping organizations see operational work
* prioritizing next actions
* routing ownership
* escalating risk earlier
* giving executives visibility

TSM turns invisible work into managed operations.

That is the product.
