// Server-side preflight blockers for L1 Onboarding (imaging + account
// provisioning), independent of the client-side computeOnboardingReadiness()
// in html/l1-copilot/l1-ticket-copilot.html. The client check is UX (fast,
// no round-trip, catches most cases before the tech even clicks); this is
// the one that actually can't be bypassed by calling the route directly,
// since it re-derives device/user status via the injected lookups rather
// than trusting anything the client claims about its own state.
//
// Factored out of server.js (rather than defined inline) so it can be unit
// tested the same way server/l1-copilot/servicenow-adapter.js is: require
// the module directly, supply fake deps, assert on the result -- no live
// Graph/ServiceNow credentials or server.js's global demo-mode wiring
// needed. server.js wires the real getUserSecurityStatus/
// getDeviceSecurityStatus (backed by demoData/graphAdapter) as deps at
// call time; tests supply their own.

/**
 * @param {string} assetTag
 * @param {{ getDeviceSecurityStatus: (asset: string) => Promise<{complianceStatus?: string}|null> }} deps
 * @returns {Promise<string[]>} blockers -- empty array means ready
 */
async function imagingPreflightBlockers(assetTag, deps) {
  const blockers = [];
  const { getDeviceSecurityStatus } = deps;
  try {
    const device = await getDeviceSecurityStatus(assetTag);
    if (device && device.complianceStatus === 'Non-Compliant') {
      blockers.push(`Device ${assetTag} is reporting Non-Compliant in endpoint management.`);
    }
  } catch (e) {
    // Lookup failure isn't itself a blocker -- same "don't fabricate a
    // signal from nothing" stance the rest of this codebase takes for
    // unconfigured/unreachable adapters (see demo-data.js header comment).
  }
  return blockers;
}

/**
 * @param {string} requester
 * @param {{ getUserSecurityStatus: (query: string) => Promise<{accountStatus?: string, riskLevel?: string}|null> }} deps
 * @returns {Promise<string[]>} blockers -- empty array means ready
 */
async function provisioningPreflightBlockers(requester, deps) {
  const blockers = [];
  const { getUserSecurityStatus } = deps;
  if (requester) {
    const user = await getUserSecurityStatus(requester);
    if (user) {
      if (user.accountStatus === 'Suspended') blockers.push(`Requester account (${requester}) is Suspended in the identity provider.`);
      if (user.riskLevel === 'High' || user.riskLevel === 'Critical') blockers.push(`Requester identity risk level is ${user.riskLevel}.`);
    }
  }
  return blockers;
}

/**
 * Resolves who to run the provisioning identity check against.
 *
 * When an incident number is given, this pulls the requester from the
 * ITSM ticket itself via getTicket() -- a value the client can't spoof by
 * just typing a different name into the requester field, since it comes
 * from the CMDB/ITSM record, not the request body. A client-supplied
 * `fallbackRequester` is used only when no incident is given, or the
 * incident lookup can't produce one (not configured, ticket not found,
 * adapter error) -- best-effort in that case, same trust level as before
 * this function existed.
 *
 * @param {string|null|undefined} incident
 * @param {string|null|undefined} fallbackRequester
 * @param {{ getTicket: (incidentId: string) => Promise<{requester?: string}|null> }} deps
 * @returns {Promise<string|null>}
 */
async function resolveProvisioningRequester(incident, fallbackRequester, deps) {
  const { getTicket } = deps;
  if (incident) {
    try {
      const ticket = await getTicket(incident);
      if (ticket && ticket.requester) return ticket.requester;
    } catch (e) {
      // Ticket lookup failing isn't fatal to provisioning -- fall through
      // to the client-supplied requester, same "don't let an unrelated
      // adapter outage block the whole flow" stance as imagingPreflightBlockers'
      // catch above.
    }
  }
  return fallbackRequester || null;
}

module.exports = { imagingPreflightBlockers, provisioningPreflightBlockers, resolveProvisioningRequester };
