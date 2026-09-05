# Finding: Silent write failure in ServiceNow work-note append

**Component:** `server/l1-copilot/servicenow-adapter.js` — `writeWorkNote()`
**Found:** PDI functional testing, Sep 2026
**Status:** Fixed — branch `l1-copilot-batch-read-analyze`, commit `Harden writeWorkNote against ServiceNow's silent ACL-blocked writes`
**Severity:** High (silent data loss in production usage, no error surfaced anywhere)

---

## What we assumed
A `PATCH` to `incident.work_notes` that returns HTTP 200 means the note was written. This is the standard REST assumption, and every other endpoint in the integration behaves this way.

## What testing found
It doesn't hold for this specific case. ServiceNow's Table API can return `200 OK` on a `PATCH` while an ACL silently drops the field being written — no error, no warning, no indication anywhere in the response that the write didn't take effect.

Reproduced directly:
1. Called `writeWorkNote()` against a real PDI test incident — call returned success, no exception thrown.
2. Read the ticket back — the note was not present. Confirmed visually in the ServiceNow UI: Activities showed only the incident's original field-change log, no work-note entry.
3. Traced the cause to the ACL on `incident.work_notes` (write operation), which requires the `sn_incident_write` role and blocks entirely when `incident_state` is 7 or 8 (Closed/Canceled by default).
4. The test account had read/create access but not that role — write silently no-opped.
5. Added the role, reran the same test — note landed correctly, and a second note confirmed append (not overwrite) behavior.

## Why this matters
`writeWorkNote()` backs the Resolution feature's optional ServiceNow write-back. Before this fix, if the scoped production account ever lost the `sn_incident_write` role — role revoked, account re-provisioned, permissions drift over time — the tool would report `success: true` to the agent while the drafted resolution silently vanished. No error in the UI, no error in logs, nothing to alert anyone until a ticket got closed with no documented fix and someone noticed later, if ever.

## Fix shipped
`writeWorkNote()` now performs a read-after-write check: immediately after the `PATCH`, it re-fetches the ticket and confirms the note text is actually present in the raw `work_notes` field before returning success. If it's not there, it throws a specific `WORK_NOTE_WRITE_UNVERIFIED` error naming the two likely causes (missing role, or ticket in a closed/canceled state) instead of reporting a false positive.

No behavior change to the not-configured / demo-mode path — this only activates once the integration is talking to a real instance.

## Takeaway
This is the kind of failure a code read-through would never catch — the code was correct by every normal REST convention. It only surfaced by testing against a real instance with a deliberately under-permissioned account, which is exactly why the PDI testing pass happened before requesting production scope rather than after.
