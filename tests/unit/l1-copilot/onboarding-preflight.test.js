// Standalone test (node tests/unit/l1-copilot/onboarding-preflight.test.js).
// Exercises the blocker logic with fake getDeviceSecurityStatus/
// getUserSecurityStatus deps -- no live Graph/ServiceNow credentials or
// server.js's demo-mode wiring needed, same reasoning as
// servicenow-adapter.test.js's "no live instance reachable from this
// sandbox, so this is the honest substitute" stance.

const {
  imagingPreflightBlockers,
  provisioningPreflightBlockers
} = require('../../../server/l1-copilot/onboarding-preflight');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

async function main() {
  // ── imagingPreflightBlockers ──────────────────────────────────────────

  const compliantDevice = { getDeviceSecurityStatus: async () => ({ complianceStatus: 'Compliant' }) };
  const clean1 = await imagingPreflightBlockers('FIN-LT-0042', compliantDevice);
  check('imaging: no blockers when device is Compliant', clean1.length === 0);

  const nonCompliantDevice = { getDeviceSecurityStatus: async () => ({ complianceStatus: 'Non-Compliant' }) };
  const blocked1 = await imagingPreflightBlockers('FIN-LT-0042', nonCompliantDevice);
  check('imaging: blocks when device is Non-Compliant', blocked1.length === 1);
  check('imaging: blocker message names the asset tag', blocked1[0].includes('FIN-LT-0042'));

  const unknownDevice = { getDeviceSecurityStatus: async () => ({ complianceStatus: 'Unknown' }) };
  const clean2 = await imagingPreflightBlockers('FIN-LT-0042', unknownDevice);
  check('imaging: does not block on Unknown compliance state (only explicit Non-Compliant blocks)', clean2.length === 0);

  const noDeviceFound = { getDeviceSecurityStatus: async () => null };
  const clean3 = await imagingPreflightBlockers('FIN-LT-0042', noDeviceFound);
  check('imaging: no blockers when device lookup returns null (nothing to flag)', clean3.length === 0);

  const lookupThrows = { getDeviceSecurityStatus: async () => { throw new Error('adapter unreachable'); } };
  let threwPastImaging = false;
  let clean4 = null;
  try { clean4 = await imagingPreflightBlockers('FIN-LT-0042', lookupThrows); } catch (e) { threwPastImaging = true; }
  check('imaging: a lookup failure does not throw out of the blocker check', !threwPastImaging);
  check('imaging: a lookup failure is not itself treated as a blocker', clean4 && clean4.length === 0);

  // ── provisioningPreflightBlockers ─────────────────────────────────────

  const activeLowRiskUser = { getUserSecurityStatus: async () => ({ accountStatus: 'Active', riskLevel: 'Low' }) };
  const clean5 = await provisioningPreflightBlockers('jane.doe', activeLowRiskUser);
  check('provisioning: no blockers when requester is Active/Low risk', clean5.length === 0);

  const suspendedUser = { getUserSecurityStatus: async () => ({ accountStatus: 'Suspended', riskLevel: 'Low' }) };
  const blocked2 = await provisioningPreflightBlockers('jane.doe', suspendedUser);
  check('provisioning: blocks when requester account is Suspended', blocked2.some(b => /Suspended/.test(b)));
  check('provisioning: blocker message names the requester', blocked2.some(b => b.includes('jane.doe')));

  const highRiskUser = { getUserSecurityStatus: async () => ({ accountStatus: 'Active', riskLevel: 'High' }) };
  const blocked3 = await provisioningPreflightBlockers('jane.doe', highRiskUser);
  check('provisioning: blocks when requester risk level is High', blocked3.some(b => /High/.test(b)));

  const criticalRiskUser = { getUserSecurityStatus: async () => ({ accountStatus: 'Active', riskLevel: 'Critical' }) };
  const blocked4 = await provisioningPreflightBlockers('jane.doe', criticalRiskUser);
  check('provisioning: blocks when requester risk level is Critical', blocked4.some(b => /Critical/.test(b)));

  const suspendedAndHighRisk = { getUserSecurityStatus: async () => ({ accountStatus: 'Suspended', riskLevel: 'High' }) };
  const blocked5 = await provisioningPreflightBlockers('jane.doe', suspendedAndHighRisk);
  check('provisioning: both Suspended and High risk each contribute their own blocker', blocked5.length === 2);

  let userLookupCalled = false;
  const shouldNotBeCalled = { getUserSecurityStatus: async () => { userLookupCalled = true; return { accountStatus: 'Suspended' }; } };
  const clean6 = await provisioningPreflightBlockers(null, shouldNotBeCalled);
  check('provisioning: no requester means no lookup is attempted', !userLookupCalled);
  check('provisioning: no requester means no blockers (nothing to check, not "checked and clean")', clean6.length === 0);

  const clean7 = await provisioningPreflightBlockers('', shouldNotBeCalled);
  check('provisioning: empty-string requester is treated the same as no requester', clean7.length === 0);

  const noUserFound = { getUserSecurityStatus: async () => null };
  const clean8 = await provisioningPreflightBlockers('jane.doe', noUserFound);
  check('provisioning: no blockers when user lookup returns null', clean8.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
