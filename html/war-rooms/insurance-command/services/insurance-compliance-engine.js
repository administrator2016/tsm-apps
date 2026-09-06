/* ============================================================
   TSM INSURANCE COMPLIANCE & LEGAL ENGINE
   war-rooms/insurance-command/services/insurance-compliance-engine.js
   Mirrors insurance-claims-engine.js's method shape, generalized
   across this domain's two entity kinds (regulatory_findings,
   legal_matters). Third of four Insurance Command domains to get
   real backend wiring — see routes/insurance-compliance-financial.js.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_FINDINGS = [
    { finding_id: 'REG-3301', regulation: 'Unfair Claims Settlement Practices Act', severity: 'HIGH', days_open: 28, jurisdiction: 'AZ' },
    { finding_id: 'REG-3318', regulation: 'Producer Licensing Disclosure', severity: 'MEDIUM', days_open: 11, jurisdiction: 'CA' }
  ];
  const SAMPLE_LEGAL_MATTERS = [
    { matter_id: 'LGL-1102', type: 'Bad Faith Claim', severity: 'HIGH', status: 'In litigation', days_open: 64 },
    { matter_id: 'LGL-1119', type: 'Coverage Dispute', severity: 'MEDIUM', status: 'Discovery', days_open: 22 },
    { matter_id: 'LGL-1131', type: 'Coverage Dispute', severity: 'LOW', status: 'Pre-suit', days_open: 5 }
  ];

  class TSMInsuranceComplianceEngine {
    constructor() {
      this.data = { regulatory_findings: [], legal_matters: [] };
    }

    loadSampleData() {
      this.data.regulatory_findings = [...SAMPLE_FINDINGS];
      this.data.legal_matters = [...SAMPLE_LEGAL_MATTERS];
    }

    loadRecords(entityKey, records) {
      if (!['regulatory_findings', 'legal_matters'].includes(entityKey)) {
        console.warn('TSMInsuranceComplianceEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_INSURANCE_COMPLIANCE_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMInsuranceComplianceEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_INSURANCE_COMPLIANCE_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.regulatory_findings = Array.isArray(parsed.regulatory_findings) ? parsed.regulatory_findings : [];
        this.data.legal_matters = Array.isArray(parsed.legal_matters) ? parsed.legal_matters : [];
        return true;
      } catch (e) {
        console.warn('TSMInsuranceComplianceEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_INSURANCE_COMPLIANCE_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      const activeStatuses = ['In litigation', 'Discovery'];
      return {
        open_regulatory_findings: this.data.regulatory_findings.length,
        high_severity_findings: this.data.regulatory_findings.filter(f => String(f.severity).toUpperCase() === 'HIGH').length,
        open_legal_matters: this.data.legal_matters.length,
        matters_in_active_litigation: this.data.legal_matters.filter(m => activeStatuses.includes(m.status)).length
      };
    }

    // Financial exposure computed server-side against a private rate card
    // (server/private-config/insurance/compliance-financial-model.json),
    // never shipped to the browser — see
    // routes/insurance-compliance-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/insurance/compliance/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            regulatory_findings: this.data.regulatory_findings,
            legal_matters: this.data.legal_matters
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMInsuranceComplianceEngine: getFinancialSummary failed', e);
        return {
          currency: 'USD',
          regulatory_fine_exposure_total: 0,
          regulatory_fine_exposure_items: [],
          litigation_reserve_total: 0,
          litigation_reserve_items: [],
          total_exposure: 0,
          note: 'Financial summary unavailable — no fine/reserve modeling shown.',
          fine_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          litigation_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed compliance/litigation analysis — see
    // routes/insurance-compliance-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/insurance/compliance/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            regulatory_findings: this.data.regulatory_findings,
            legal_matters: this.data.legal_matters,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMInsuranceComplianceEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_INSURANCE_COMPLIANCE_RELAY (registered
    // in relay.core.js's RELAY_REGISTRY under domain key
    // INSURANCE_COMPLIANCE).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'insurance_compliance',
        domain: 'INSURANCE_COMPLIANCE',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          regulatory_findings: this.data.regulatory_findings,
          legal_matters: this.data.legal_matters
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMInsuranceComplianceEngine = TSMInsuranceComplianceEngine;
})(typeof window !== 'undefined' ? window : this);
