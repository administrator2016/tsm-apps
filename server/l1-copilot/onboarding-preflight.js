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
 * @param {string|null|undefined} requester -- optional; the ticket's
 *   requester field, when the client has one to send. No requester means
 *   no requester-identity blocker is possible (there's nothing to check),
 *   not that the check passed.
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

module.exports = { imagingPreflightBlockers, provisioningPreflightBlockers };
