/**
 * TSM ServiceNow Career Adapter
 * Bridges ServiceNow CSA/CIS training metrics, ACL simulation scores, and workflow automation labs into the TSM Career Engine.
 */
(function() {
  window.TSMServiceNowCareerAdapter = {
    trackId: 'servicenow-admin',
    modules: [
      { id: 'sn-security', name: 'Access Control Lists & User Security', weight: 0.25 },
      { id: 'sn-workflow', name: 'Flow Designer & Subflows', weight: 0.25 },
      { id: 'sn-itsm', name: 'ITSM Data Architecture & Tables', weight: 0.25 },
      { id: 'sn-integration', name: 'REST APIs & Transform Maps', weight: 0.25 }
    ],
    calculateReadiness(progressData) {
      return this.modules.reduce((acc, mod) => {
        const score = progressData[mod.id] || 0;
        return acc + (score * mod.weight);
      }, 0);
    }
  };
  console.log('[TSM] ServiceNow Career Adapter loaded.');
})();
