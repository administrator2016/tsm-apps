# L1 Ticket Copilot — Backend & CMDB Integration Spec

This covers what needs to exist behind the current front-end so a company can point it at their real CMDB and roll it out to a team. The front-end (`l1-ticket-copilot.html`) is already built and expects these contracts — nothing here requires changing its UI logic.

**Status (2026-08-20): the ServiceNow adapter in §3 is now real, not just designed.** `server/l1-copilot/servicenow-adapter.js` implements `getAsset`/`getTicket`/`searchAssetsByUser`/`writeWorkNote`/`updateTicketStatus` against the actual ServiceNow Table API, wired into `/api/l1-copilot/servicenow/*` routes and into `analyze`/`resolution` for CMDB-enriched analysis and work-note writeback. It's config-driven (`SERVICENOW_INSTANCE_URL`, `SERVICENOW_USERNAME`/`SERVICENOW_PASSWORD` or `SERVICENOW_OAUTH_TOKEN`) — no per-customer code changes needed, per-customer field-name overrides supported via a `fieldMap`. 22/22 unit tests pass against a mock Table API server (`tests/unit/l1-copilot/servicenow-adapter.test.js`); **not yet smoke-tested against a real ServiceNow instance** — do that before rollout to a live customer. Everything else below (auth/multi-tenancy, other CMDB platforms, the assistant endpoint's own writeback) is unchanged from the original design.

**Status (2026-08-30): onboarding + security-context routes now exist (previously 404'd).** `/api/l1-copilot/onboarding/image`, `/api/l1-copilot/onboarding/provision`, `/api/l1-copilot/security/user-status`, `/api/l1-copilot/security/device-status` are wired server-side. `device-status` is genuinely real when Graph/Intune is configured (reuses `graph-intune-adapter.js`'s `getDevice()`). The other three honestly no-op to demo data (`L1_COPILOT_DEMO_MODE`, defaults on) until real write/risk adapters exist:
- `onboarding/image` needs an imaging-platform webhook at `L1_COPILOT_IMAGING_WEBHOOK_URL` (MDT/SCCM/Intune/JAMF trigger).
- `onboarding/provision` needs an identity-write webhook at `L1_COPILOT_PROVISIONING_WEBHOOK_URL` (Entra ID/Okta/Workspace) — intentionally NOT wired to the read-only Graph credentials already configured for AD/Intune device lookups, since provisioning is a real directory write and shouldn't silently inherit read-only scope.
- `security/user-status` has no live risk-signal adapter yet (would need `IdentityRiskyUser.Read.All` + auth-methods Graph scopes beyond what device-read requires) — always demo data until built.

---

## 1. Scope of the gap

The current app is 100% client-side: `localStorage` for state, no auth, no shared data, and two endpoints (`/api/l1-copilot/analyze` and the floating assistant) that don't exist server-side yet. To go multi-user and CMDB-connected, three things need to be built:

1. A backend that serves the API contract below
2. A CMDB adapter layer (one connector per ticketing/CMDB platform)
3. Basic auth + per-user/team data scoping

---

## 2. API Contract

### 2.1 `POST /api/l1-copilot/analyze`

Called when the tech hits **Run Analysis**. Takes the ticket as typed/loaded, returns structured triage output.

**Request body**
```json
{
  "ticket": {
    "incident": "INC0012345",
    "priority": "P2",
    "requester": "Jane Doe",
    "department": "Finance",
    "asset": "FIN-LT-0042",
    "manufacturer": "Dell",
    "model": "Latitude 7440",
    "warranty": "ProSupport Plus",
    "description": "User reports laptop will not boot..."
  }
}
```

**Response body**
```json
{
  "ok": true,
  "analysis": {
    "issue_summary": "string",
    "likely_causes": ["string", "string"],
    "recommended_path": "string",
    "confidence": 0,
    "severity": "Low | Medium | High | Critical",
    "affected_system": "string",
    "business_impact": "string",
    "extracted_fields": {
      "incident": "string",
      "requester": "string",
      "department": "string",
      "assignmentGroup": "string",
      "asset": "string",
      "manufacturer": "string",
      "model": "string",
      "warranty": "string",
      "priority": "P1 | P2 | P3 | P4"
    }
  }
}
```
`extracted_fields` is optional and only used to auto-fill blank ticket fields — the front-end already handles missing/partial keys. On failure: `{ "ok": false, "error": "human-readable reason" }`. The client already renders this as a caught, visible error — no change needed there.

**Server-side responsibilities**
- Call the LLM (Claude) with the ticket description + structured extraction prompt
- Optionally enrich the prompt with a live CMDB lookup (see §3) before calling the model, so "likely cause" reasoning has real asset history instead of just what the tech typed
- Rate-limit per user/org
- Log the request/response for audit (ticket data can be sensitive — see §4)

### 2.2 `POST /api/l1-copilot/assistant` (floating AI assistant)

Same shape idea — request includes the current ticket context plus the tech's free-text question; response is a plain-text or lightly structured reply. Recommend:

```json
// Request
{ "ticket": { ...same as above }, "message": "how do I check TPM status remotely?" }

// Response
{ "ok": true, "reply": "string", "suggested_actions": ["string"] }
```

### 2.3 `POST /api/l1-copilot/resolutions` (Generate Resolution → ticket history)

Not yet wired but implied by the "logged automatically when you GENERATE RESOLUTION" copy in the app. This should:
- Accept the final ticket + resolution notes
- Write it to the CMDB/ITSM platform as a resolution/work-note (via adapter, §3)
- Return a record the client can append to its local ticket history list

```json
// Request
{ "ticket": {...}, "resolution_notes": "string", "checklist_completed": ["step_id", "step_id"] }

// Response
{ "ok": true, "resolution_id": "string", "logged_to_cmdb": true }
```

---

## 3. CMDB Adapter Layer

This is the piece that makes "linked to our CMDB" real instead of typed-in text fields. One adapter interface, multiple implementations (ServiceNow, Jira Service Management, BMC Helix, etc.).

**Adapter interface (conceptual, language-agnostic):**

```
getAsset(assetTag) -> { manufacturer, model, warrantyStatus, owner, department, purchaseDate, ... }
getTicket(incidentId) -> { priority, status, requester, description, assignmentGroup, ... }
searchAssetsByUser(userId) -> [assetTag, ...]
writeWorkNote(incidentId, note) -> { success }
updateTicketStatus(incidentId, status) -> { success }
```

**Per-platform notes:**
- **ServiceNow**: Table API (`/api/now/table/cmdb_ci`, `/api/now/table/incident`) with OAuth2 or basic auth via a scoped service account. Warranty/asset fields map from `cmdb_ci_hardware`.
- **Jira Service Management**: REST API v3 + Assets (Insight) API for CMDB-equivalent data.
- **BMC Helix**: REST API against the CMDB and Incident Management modules.

**Where this plugs into the app:**
- When a tech types an asset tag or incident number, the backend calls `getAsset`/`getTicket` and returns matched fields — this is what would replace manual entry of manufacturer/model/warranty.
- `analyze` (§2.1) can call the adapter first to pull real warranty/asset history into the prompt context before generating analysis.
- `resolutions` (§2.3) calls `writeWorkNote`/`updateTicketStatus` so resolution data flows back into the source of truth instead of living only in this app.

**Config, not code, per customer**: each company's adapter instance needs its own credentials, base URL, and field-mapping config (their custom fields won't match a generic schema 1:1) — this should be an admin-configurable mapping layer, not a hardcoded integration per client.

---

## 4. Auth & Multi-Tenancy (minimum viable)

- SSO (SAML/OIDC) ideally, tied into whatever IdP the company already uses
- Ticket/session data scoped per user, with team-level visibility if managers need to see team queues
- Server-side session/ticket state replaces `localStorage` as source of truth; `localStorage` can stay as a local cache/offline fallback
- Audit log for CMDB writes (who resolved what, when) — likely a compliance requirement for most ITSM shops

---

## 5. Suggested build order

1. Stand up the backend + `/api/l1-copilot/analyze` against a real LLM call (fastest way to make the existing UI fully functional, no CMDB yet)
2. Add auth + server-side ticket persistence (moves off `localStorage`)
3. Build one CMDB adapter (start with whatever platform the company already runs) and wire asset/ticket lookups
4. Wire `resolutions` endpoint to write back to the CMDB
5. Add the assistant endpoint last — it's the least critical path to a usable multi-user tool

This gets the front-end you already have fully "real" without touching its UI code — every hook it needs is already calling the right shaped endpoints, they just need a backend on the other end.