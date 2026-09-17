# Step 6 — Cross-Vertical Release Regression: Status

Session date: 2026-09-17. Written after Insurance and Legal were taken through
real validation, to close out this pass honestly before scope drifts into a
third vertical under momentum.

## Where the 8-step release audit stands overall

| Step | Status |
|---|---|
| 1. Honeywell 9-domain E2E | ✅ Done — 137/137 passing (`158429ff`) |
| 2–3. HC Denial/A/R → BNCA → Exec Portal | ✅ Done, pre-existing |
| 4. FinOps/AI | ⚠️ Partially closed (`e79fd6fe`) — relay chain confirmed live; portal-side display for `exposureDefaulted`/`riskScoreDefaulted` still missing; Groq inference layer itself still untested |
| 5. Training Intelligence | ⚠️ Partially closed (`1b980c18`) — servicenow-csa provider tested; analyze-url/teach/lab routes untested; `career-training-interview-proxy` branch staleness unconfirmed |
| 6. Cross-vertical release regression | ⚠️ In progress — see below |
| 7. Final release gate | ❌ Not started — depends on 6 |
| 8. Deployment | ❌ Not started — explicitly gated |

## Step 6: the honest coverage picture

A triage script (`triage-test-coverage.js`, committed to repo root) classified
every `*.spec.js`/`*.test.js` file as real-assertion vs. demo-only. Headline
finding, confirmed at scale, not just on the Legal file caught first:

**Every one of the 26 files under `tests/e2e/demo/*-demo.spec.js` is
screenshot-only.** No exceptions. `runStory()` clicks through a scripted path
and captures screenshots — zero assertions about data correctness, relay
payload accuracy, or business logic. A green `demo-certify.sh` run has never
meant the underlying logic works, for any vertical.

Re-mapping actual real coverage by hand (the triage script's per-vertical
grouping missed most non-demo files, since `tests/e2e/*.spec.js`,
`tests/playwright/*.spec.js`, and `tests/unit/*.test.js` don't follow a
vertical-prefixed naming convention):

| Vertical | Real coverage outside demo/ |
|---|---|
| Honeywell | ✅ 137 assertions (pre-existing) |
| Healthcare | ✅ 2 real specs + 2 weak unit tests |
| FinOps | ✅ 1 real spec (this session) + 1 unclear |
| Training Intelligence | ✅ 1 real spec (this session) |
| **Insurance** | ✅ **12 real assertions, this session** — see below |
| **Legal** | ⚠️ **Fixed + 6 real assertions, this session** — see below |
| Schools | ✅ 2 real + 3 weak |
| BPO | ✅ 1 real spec |
| Music | ✅ 1 real + 1 weak |
| College/Concierge | ✅ 2 real |
| Career-training | ✅ 1 real + 1 unclear |
| L1 Platform | ✅ 1 real spec; 6 adapter unit tests scored 0/0 by the triage regex — likely real (a "full 12-test unit suite" was previously noted for the GCP adapter) but use a test style the script didn't recognize; **not manually confirmed** |
| Property/Mortgage | ⚠️ 1 real (oddly filed under demo/) + 2 unclear |
| **Construction (+ cashflow/finance/je), NOC, HotelOps, PM-Copilot, Real Estate, RCM-OS (both), Property-revenue, Cyber-incident, Diagnose, Plant-incident, Supplier-shutdown** | ❌ **No real coverage found anywhere** — demo-only or nothing |

That last row is 13+ verticals/sub-flows with zero real logic testing. This is
not a small residual gap — it's roughly half the platform.

## Insurance — closed this session

Two parallel systems exist: an older `insure-war`/`insurance-command`
surface (still referenced from nav/shared infra) and a newer 4-engine system
(Claims, Licensing, PC, Compliance) with real server-side compute. Confirmed
via source that the 4-engine services genuinely call their
`/api/insurance/*/financial-summary` routes — this is the live path.

`tests/../test-insurance-exposure-honesty.js` (root of repo) — 12/12 passing,
run against the actual live server, not assumed:
- Reserve adequacy risk = `reserve_amount × severity-band rate`, verified exact
- Appeal handling cost = flat $1800/appeal regardless of reason/severity
- Regulatory fine exposure = flat, unrounded, by severity band
- **Litigation reserve status filter** — a Closed HIGH-severity matter
  correctly contributes $0, not $250,000; case-insensitive status matching
  confirmed
- **New finding, now pinned by test**: `normalizedSeverity()` silently
  defaults any unrecognized severity string to MEDIUM (0.08 rate), rather
  than rejecting or zeroing it. Not fixed — a product decision, not a bug —
  but previously undocumented and untested.
- Malformed input (`null`/non-array) degrades to zeroed totals with a 200,
  not a 500.

Landed on `main`: `e09c5595`.

## Legal — disclosure gap fixed this session; deeper issues found, not fixed

Two parallel systems here too: `legal-war/*` (no server-side logic at all —
confirmed via empty grep for `routes/legal-*`) and `legal-pro/case-strategist.html`
(newer, has a real-looking node-scoring/BNCA pipeline, reachable from both
the war-room and exec-portal pages).

**Finding: Legal's BNCA has been running on 100% fabricated output.**
`runBNCA()` calls `/api/groq`. That route is defined in `groq-route.js` but
**that file is never `require()`'d anywhere in the codebase** — confirmed by
a whole-repo grep. `server.js` only mounts `/api/groq/validate-key`, not
`/api/groq` itself. Confirmed live against the running server: `POST
/api/groq` returns 404. This means `runBNCA()`'s try block fails on every
single invocation, not as a rare degrade path, and `generateMockBNCA()`'s
output was presented identically to a real analysis — same "⚙ GROQ
LLAMA-3.3-70B" badge, same randomized 88–95% confidence score, no visual
distinction anywhere.

**Fixed this session** (`2623c61a` → pushed as `89c4e4f1`): `runBNCA()` now
passes a `degraded` flag into `finalizeBNCA()`, which shows a
`⚠ SIMULATED — GROQ UNAVAILABLE` badge when the real call fails. Verified via
`tests/e2e/legal-bnca-simulation-disclosure.spec.js` — a jsdom test that
loads and executes the actual page script (not a source grep), 6/6 passing
including a live canary confirming `/api/groq` is still unmounted.

**Not fixed, named for follow-up:**
- The missing `/api/groq` route itself. Two options, needs a decision: mount
  `groq-route.js` for real, or point `API_ENDPOINT` at the existing
  `/api/legal/query` route (which does exist and is mounted).
- `tsmWriteRelay()` — the function that would persist BNCA output to
  `TSM_KERNEL`'s relay for the Executive Portal to read — is defined but
  **never called**. `sendToRelay()` only updates a local status label and
  fills a page-local text box; it does not relay anything downstream.
  Whatever `legal-executive-portal.html` currently displays for confidence
  is coming from an entirely different, unidentified relay path. Needs
  investigation before Legal's exec-portal chain can be trusted at all.

## Separate finding, outside step 6's scope

`requireAnyAuth` (the guard on both Insurance financial-summary routes, and
likely others using the same middleware) defaults to `{ role: 'admin' }` and
calls `next()` when no session cookie is present — it never returns a 401.
Confirmed by reading `server.js` directly. This means these endpoints are
effectively open to anyone who finds the URL, not gated by real
authentication. Not a step-6 item, but real, and worth its own audit pass —
scope of exposure (which other routes share this middleware) is unknown.

## Recommendation for what's next

Given what two verticals just turned up — a fully non-functional AI
integration hiding behind a convincing UI, a dead relay function, and an
auth bypass — going vertical-by-vertical through the remaining 13+ at this
depth is realistically multiple more sessions, not a quick pass. Options,
unranked:

1. Triage the auth-bypass finding's actual blast radius (which routes share
   `requireAnyAuth`) — separate from step 6, but potentially more urgent.
2. Continue step 6 vertical-by-vertical (Construction and NOC are 0-coverage
   like Legal was, and are both flagged elsewhere in this repo's audit docs
   as having known issues, so may be similarly informative).
3. Treat step 6 as "coverage mapped, two verticals deeply verified, rest
   named as open risk" and move to closing out step 4/5's known-remaining
   items (FinOps portal badge, Training Intelligence's untested Groq routes)
   before opening new vertical work.

This doc is the artifact to hand to whoever decides that — not a
recommendation this session is making on its own.
