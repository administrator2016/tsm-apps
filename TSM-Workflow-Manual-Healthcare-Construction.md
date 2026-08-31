# TSM Workflow Manual — Healthcare & Construction
### Upload → "Ready" (the intake pipeline, front to back)

Everything below is verified against the real code in `tsm-doc-search-multi.html`
and `server.js` (checked line-by-line while writing this, not reconstructed
from memory). `presentation-hub.html` is referenced only for vertical naming
("Healthcare" / "Construction") — nothing in that file is touched by this
manual.

_Re-audited 2026-08-24 against the current `deriveCheckStatus` source: the
"Known risk" section's decision-tree diagram was missing the `documentType`
conditions on the first two branches — corrected below. Everything else
checked (schema fields, thresholds, retry counts, `DOC_TYPE_ACTIONS`
content, status-transition call sites) matched the source exactly._

Scope: this covers **upload → the document landing "● Ready"** — the
ingestion pipeline every document goes through before a human ever opens it.
It does not re-cover the specialist war-room step lists (steps 3-5 of the
BPO manual you already have) — this is what happens *before* that, and why
each part of it exists.

---

## Stage 1 — Upload

**Where:** `tsm-doc-search-multi.html`, drag-and-drop zone or file picker.

**What actually happens:** the file never gets processed in place — it's
handed to `processFile()`, which runs every document through the same five
sub-stages below regardless of vertical. A queue row appears immediately
(`uqAdd()`) so the operator sees "Extracting..." the instant a file lands,
not just when something finishes.

**Why it matters for revenue recovery:** this is the only human action in
the entire pipeline. Everything from here to "Ready" is automatic — which
means upload-time mistakes (wrong file, wrong client workspace selected)
propagate all the way through before anyone catches them. The workspace
selector at the top of the page determines which client's compartment the
document lands in; get that wrong and the document is filed correctly by
type but invisible to the right reviewer.

---

## Stage 2 — Extraction

**Function:** `extractFile()`

The path taken depends on file type, and this is a real, previously-fixed
distinction, not a formality:

| File type | Path | Why |
|---|---|---|
| `.pdf` | Client-side PDF.js render → text | Direct text layer read |
| `.png/.jpg/.jpeg/.webp` | Base64 → vision model | No text layer to extract |
| `.docx/.xlsx/.xls` | Server route `/api/doc-router/extract-file` (mammoth/xlsx) | These are zip-based binary formats — reading them with plain `FileReader.readAsText()` silently produces garbled text with **no error thrown**, which used to get fed straight into classification as if it were real content |
| everything else | `fileToText()` | Plain text read |

**Why it matters for revenue recovery:** a denial letter or change-order
packet that gets garbled at this stage doesn't fail loudly — it gets
classified anyway, just on garbage input. The .docx/.xlsx fix exists
specifically because that failure mode is silent: the document still lands
"Ready" with a plausible-looking card, and the first sign anything was
wrong is a reviewer opening it and finding nonsense, by which point it may
have already sat in queue past a real deadline (timely-filing window,
dispute window, etc.).

Alongside extraction, `captureAttachment()` separately saves the actual
file bytes (capped at ~700KB) so a later client-facing report can include
the real document, not just what the classifier said about it.

---

## Stage 3 — AI Classification

**Endpoint:** `POST /api/doc-router/classify` (server.js), model
`openai/gpt-oss-120b`.

The classifier returns a fixed JSON schema: `documentType` (one of a
closed list — `DENIAL`, `CLAIM APPEAL`, `REMITTANCE`, `PERMIT`, `VENDOR
INVOICE`, `FILING`, `CONTRACT`, `DOCUMENT REPORT`, etc.), `verticals`,
`routing`, `vendor`, `invoiceNo`, `exclusionCode`, `amount`, `client`,
`summary`, `defectFlags`, and an `entities` block (parties/dates/amounts/
identifiers).

Two things worth knowing precisely, because they drive everything after
this stage:

- **`exclusionCode` has no format guidance in the prompt.** The schema just
  says `"exclusionCode": string or ""`. The model is never told to use
  `PA-`/`CO-`/`OA-`/`PR-` prefixes — those prefixes are a *routing
  convention* that downstream code checks for, not something the classifier
  is instructed to produce. If a document's own text contains something
  that looks like one of these prefixes (a denial code, a change-order
  number), the model may echo it verbatim as the exclusion code, and
  whatever prefix happens to match will route the document — see the
  callout at the end of this manual.
- **Confidence and validation are computed by code, not the model.**
  `validateClassification()` checks the model's own output against its
  schema; `scoreConfidence()` turns that into a 0–1 score. The model is
  explicitly told *not* to self-report confidence — self-reported LLM
  confidence is poorly calibrated, so it isn't trusted here.

**Retries:** classification retries up to 2 times (3 attempts total) on
429/500/502/503, parsing Groq's own stated wait time out of the error
message rather than using a flat delay.

**Why it matters for revenue recovery:** `exclusionCode` is the single
field that determines which specialist queue a document lands in and which
step list a reviewer gets. A healthcare denial classified with the wrong
prefix doesn't fail — it silently gets a *different, wrong* set of next
steps (prior-auth steps instead of appeal steps, for example), and there's
no edit function in the UI to correct it after the fact. This is the
highest-leverage failure point in the whole pipeline precisely because it's
invisible: the card still says "Ready," the button still has a label, it's
just the wrong one.

---

## Stage 3.5 — Mission Preview (confidence gate)

If `classificationNeedsReview()` returns true — confidence below 0.6, or
the classification failed its own schema validation — the document does
**not** proceed automatically. A Mission Preview modal shows the operator
the confidence score, doc type, vertical, client, and every extracted
entity, and asks them to **Confirm and Route** or **Discard**.

Confident, valid classifications skip this entirely and flow straight
through — this only fires on the documents most likely to be misrouted.

**Why it matters for revenue recovery:** this is the one real checkpoint
between "the AI guessed" and "the document is now live in someone's queue."
A discarded document costs nothing but the upload; a wrongly-confirmed one
inherits every downstream consequence described in Stage 3. For
Healthcare/Construction specifically, this is the moment to actually read
the confidence score rather than reflexively clicking Confirm — a
borderline denial or change-order is exactly the kind of document where a
generic step list quietly substitutes for the real one.

---

## Stage 4 — Routing

**Function:** `routeDocument()`

For each vertical the classifier assigned, this:

1. Builds a document record (`id`, `fileName`, `documentType`, `vendor`,
   `invoiceNo`, `exclusionCode`, `amount`, `routing` nodes, and `_ext`
   metadata including up to 6,000 characters of raw extracted text).
2. Sets **`status: "ready"`** — this is the terminal state a document
   reaches the moment it's written to the index. It never gets set
   anywhere else; it only changes later, to `in_review`, when a reviewer
   clicks the action button.
3. Writes it into the document's own **client compartment**
   (`loadIndexForClient`/`saveIndexForClient`) — always the client the
   *document* belongs to, never whatever workspace the operator happens to
   have open. A batch upload with five different clients' files still
   files each one correctly.
4. Separately builds a **Mission** record (`buildMissionFromClassification`)
   and a **Case** record (`buildCaseFromClassification`) if the vertical
   maps to the Mission/Case engine — both non-fatal, best-effort writes
   that don't block routing if they fail. The two are now cross-linked:
   the Case record's `missionId` field is populated from the real
   `mission.id` `buildMissionFromClassification` returns, when a mission
   was actually created (`missionId: null` if the mission bridge itself
   returned null — unmapped vertical, or the mission model/store not
   loaded). Before this, both writes ran independently with no shared
   key, so a Mission and its Case looked like two unrelated records.

**Why it matters for revenue recovery:** the client-compartment isolation
is what makes per-client reporting and the BPO client-scoped access model
possible at all — a document in the wrong compartment isn't just
inconvenient, it's invisible to whoever the "ready for client" reporting
line is supposed to serve. The Case record is what eventually rolls up into
exposure/severity numbers on the executive side; a document that fails to
map to a Case (unmapped vertical) still routes correctly but won't show up
in that rollup.

---

## Stage 5 — "● Ready"

The document now renders as a card with:

- The **"● Ready" status pill** (green, `#22d3a0`) — set the instant
  Stage 4 completes, changes only when a reviewer acts on it.
- A **type-specific action button**, not a generic "Open Node" button, for
  every `documentType` this manual covers. The label and the narrative
  behind it are real, already-shipped content (`DOC_TYPE_ACTIONS` in
  `tsm-doc-search-multi.html`) — not something this manual is proposing,
  just documenting what's already there:

### Healthcare (`hc`)

| Document type | Button | Real narrative shown to the reviewer |
|---|---|---|
| `DENIAL` | **Start Appeal Review** | "Payer denied this claim. Open the Billing Node to check the denial reason against CPT/ICD coding, confirm timely-filing deadline, and decide appeal vs. write-off." |
| `CLAIM APPEAL` | **Track Appeal** | "An appeal has already been drafted or filed for this claim. Open the Billing Node to log the payer's response deadline and follow up if it lapses." |
| `REMITTANCE` | **Reconcile Remittance** | "Payer remittance (835/EOB) batch. Open the Billing Node to match each line against the expected allowed amount and flag underpayments for appeal." |
| `DOCUMENT REPORT` | **Review Prior Auth** | "Typically a prior-authorization request in this vertical. Open the HC Node to confirm medical-necessity documentation is attached before the submission deadline." |
| `ESCALATION` | **Open Escalation** | "Flagged by BNCA for high dollar exposure or aging beyond threshold. Needs a reviewer with executive visibility, not routine queue handling." |

### Construction (`con`)

| Document type | Button | Real narrative shown to the reviewer |
|---|---|---|
| `PERMIT` | **Review Permit** | "Permit issued or pending with the municipality. Open the Construction War Room to confirm inspection milestones tied to this permit before work proceeds on site." |
| `DOCUMENT REPORT` | **Review Change Order** | "Typically a change order or field report in this vertical. Open the Construction War Room to verify cost/schedule impact and get owner sign-off before subs are paid against it." |
| `VENDOR INVOICE` | **Match Invoice** | "Subcontractor or vendor invoice. Open the Construction War Room to match it against the PO/contract value and confirm lien-waiver status before approving payment." |
| `FILING` | **Review Filing** | "Incident, OSHA, or zoning filing. Open the Construction War Room to confirm regulatory notification timelines are being met." |
| `CONTRACT` | **Verify Contract** | "Lien waiver or agreement (e.g. owner-architect). Open the Construction War Room to confirm signature and date validity before payment is released against it." |
| `ESCALATION` | **Open Escalation** | "Flagged by BNCA for cost/schedule exposure beyond threshold. Needs a reviewer with executive visibility, not routine queue handling." |

Clicking the button (`runDocTypeAction`) is what moves the card from
`ready` to `in_review` — nothing else in the pipeline changes status.

**Why "Ready" is the right handoff point for revenue recovery:** it's the
first moment a document is simultaneously (a) correctly filed to the right
client, (b) tagged with a specific, actionable next step instead of a
generic one, and (c) still unclaimed — meaning the dollar exposure or
compliance risk it represents is sitting open and countable. Everything
from here forward (the war-room narrative/findings/step-list/risk-score
work) is where recovery actually happens; "Ready" is what makes that work
possible to route and to measure.

---

## Known risk, both verticals: exclusion-code prefix collisions

This was verified against the real routing function (`deriveCheckStatus`),
not theoretical. The function checks `exclusionCode` **and** `documentType`
at each step — an earlier draft of this manual showed only the
`exclusionCode` side and missed the `documentType` conditions layered onto
the first two branches:

```
excCode.startsWith('PA-') OR docType includes 'PRIOR AUTH'
                                        → AUTH_BLOCK      (checked first)
excCode.startsWith('CO-') OR docType includes 'DENIAL'/'CLAIM APPEAL'
                                        → DENIAL_RISK
excCode.startsWith('OA-')/('PR-')      → PAYMENT_BLOCK
docType includes AUDIT/POLICY          → COMPLIANCE_BLOCK
docType includes FILING/CONTRACT       → LEGAL_HOLD
defects present                        → DOCUMENTATION_BLOCK
otherwise                              → ACTIVE
```

Because the classifier (Stage 3) has no instruction to use these prefixes
deliberately, a document whose own text happens to contain something like
"Denial code: PA-17" can have that string echoed back as the
`exclusionCode` — and because the `excCode.startsWith('PA-')` check is
first in the chain, it short-circuits `AUTH_BLOCK` before the function
ever reaches the `documentType` check, **even for a document correctly
classified as `DENIAL`.** A healthcare denial whose real story is
"authorization was already approved, payer didn't match it" can land on
prior-auth verification steps instead of appeal steps.

The `documentType` fallback conditions mean this collision is narrower
than it looks in isolation: a document the classifier correctly tags
`DENIAL` (or `CLAIM APPEAL`) reaches `DENIAL_RISK` through a *second,
independent* path even when `exclusionCode` is empty or doesn't start
with `CO-`. The exclusion-code prefix isn't the only route to the right
outcome — it's only the wrong outcome (via a `PA-`/`CO-` collision) that
requires the prefix specifically, and only when that prefix happens to be
checked before the matching `documentType` branch would have been
reached. Construction's equivalent case (a change order literally
labeled `CO-017`) happens to land on `DENIAL_RISK`, which is a reasonable
fit for a dispute/variance document — a lower-stakes coincidence, not a
fix.

There is no in-UI way to edit `exclusionCode` after a document routes. For
any document where this collision is plausible, the safe move is a
hand-seeded `DEMO_DOCS` record with a deliberately non-colliding
`exclusionCode` (e.g. `CO-50` instead of `PA-17` for a healthcare denial),
not reliance on live classification.
