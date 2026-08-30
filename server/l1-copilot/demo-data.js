// Demo-data fallback for L1 Copilot status/lookup routes.
//
// When a connector (ServiceNow, AWS Cloud Ops, Graph/Intune, GCP) isn't
// configured, the real adapters honestly fail closed (503 + ok:false).
// This module gives call sites an opt-in way to instead serve clearly
// labeled canned data — useful for demos and local dev without live creds.
//
// Gated by L1_COPILOT_DEMO_MODE. Defaults ON. Set to "false" to force
// the honest 503 everywhere (e.g. CI).

function isDemoModeEnabled() {
  return process.env.L1_COPILOT_DEMO_MODE !== 'false';
}

function demoAsset(assetTag) {
  return {
    assetTag: assetTag || 'FIN-LT-0042',
    manufacturer: 'Dell',
    model: 'Latitude 7440',
    warrantyStatus: 'Active — expires 2027-03-01',
    owner: 'Jane Doe',
    department: 'Finance',
    purchaseDate: '2024-03-01',
    status: 'In Use',
    raw: null,
    demo: true
  };
}

function demoTicket(incidentId) {
  return {
    number: incidentId || 'INC0010042',
    priority: '2 - High',
    requester: 'Jane Doe',
    description: 'Laptop will not boot past the Dell logo screen after last night\'s update.',
    assignmentGroup: 'Desktop Support L1',
    state: 'In Progress',
    asset: 'FIN-LT-0042',
    sysId: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    raw: null,
    demo: true
  };
}

function demoAwsInstance(identifier) {
  const looksLikeId = /^i-/i.test(identifier || '');
  return {
    instanceId: looksLikeId ? identifier : 'i-0a1b2c3d4e5f6a7b8',
    name: looksLikeId ? 'demo-app-server-01' : (identifier || 'demo-app-server-01'),
    state: 'running',
    instanceType: 't3.medium',
    availabilityZone: 'us-east-1a',
    privateIp: '10.0.4.17',
    publicIp: '54.210.88.201',
    launchTime: '2026-06-02T14:31:00Z',
    systemStatus: 'ok',
    instanceStatus: 'ok',
    raw: null,
    demo: true
  };
}

function demoDevice(identifier) {
  return {
    deviceId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    deviceName: identifier || 'DESKTOP-FIN042',
    userPrincipalName: 'jane.doe@example.com',
    complianceState: 'compliant',
    managementState: 'managed',
    operatingSystem: 'Windows',
    osVersion: '10.0.22631',
    isEncrypted: true,
    lastSyncDateTime: '2026-08-20T09:12:00Z',
    manufacturer: 'Dell',
    model: 'Latitude 7440',
    autopilotEnrolled: true,
    raw: null,
    demo: true
  };
}

function demoGcpInstance(name) {
  return {
    instanceId: '4123456789012345678',
    name: name || 'demo-gcp-instance-01',
    zone: 'us-central1-a',
    status: 'RUNNING',
    machineType: 'e2-medium',
    privateIp: '10.128.0.14',
    publicIp: '34.72.100.55',
    creationTimestamp: '2026-05-14T08:00:00Z',
    raw: null,
    demo: true
  };
}

function demoImagingJob(assetTag, profileId) {
  return {
    jobId: 'IMG-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    assetTag: assetTag || 'FIN-LT-0042',
    profileId: profileId || 'default-win11',
    status: 'Running',
    percent: 10,
    demo: true
  };
}

function demoProvisionedAccount(name, email) {
  const local = (email || '').split('@')[0] || (name || 'new.hire').toLowerCase().replace(/\s+/g, '.');
  return {
    userId: local + '@example.com',
    mfaEnrollmentLink: 'https://mysignins.microsoft.com/security-info?demo=1',
    demo: true
  };
}

function demoUserSecurityStatus(query) {
  return {
    query: query || 'jane.doe',
    accountStatus: 'Active',
    mfaEnabled: true,
    riskLevel: 'Low',
    demo: true
  };
}

function demoDeviceSecurityStatus(asset) {
  return {
    asset: asset || 'FIN-LT-0042',
    complianceStatus: 'Compliant',
    demo: true
  };
}

module.exports = {
  isDemoModeEnabled,
  demoAsset,
  demoTicket,
  demoAwsInstance,
  demoDevice,
  demoGcpInstance,
  demoImagingJob,
  demoProvisionedAccount,
  demoUserSecurityStatus,
  demoDeviceSecurityStatus
};
