/* ============================================================
   TSM INSURANCE LICENSING & CE ENGINE
   war-rooms/insurance-command/services/insurance-licensing-engine.js
   Mirrors insurance-claims-engine.js's method shape, generalized
   across this domain's two entity kinds (producer_licenses,
   ce_requirements). Fourth of four Insurance Command domains to get
   real backend wiring — see routes/insurance-licensing-financial.js.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_LICENSES = [
    { agent_ref: 'NPN-501234', state: 'AZ', license_type: 'Life & Health', expires_in_days: 12 },
    { agent_ref: 'NPN-501987', state: 'CA', license_type: 'P&C', expires_in_days: 47 },
    { agent_ref: 'NPN-502210', state: 'AZ', license_type: 'Life & Health', expires_in_days: 210 }
  ];
  const SAMPLE_CE = [
    { agent_ref: 'NPN-501234', course: 'Ethics — AZ Statute Update', hours_required: 3, hours_completed: 0, deadline_days: 12 },
    { agent_ref: 'NPN-501987', course: 'P&C Annual CE', hours_required: 12, hours_completed: 8, deadline_days: 47 }
  ];

  class TSMInsuranceLicensingEngine {
    constructor() {
      this.data = { producer_licenses: [], ce_requirements: [] };
    }

    loadSampleData() {
      this.data.producer_licenses = [...SAMPLE_LICENSES];
      this.data.ce_requirements = [...SAMPLE_CE];
    }

    loadRecords(entityKey, records) {
      if (!['producer_licenses', 'ce_requirements'].includes(entityKey)) {
        console.warn('TSMInsuranceLicensingEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_INSURANCE_LICENSING_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMInsuranceLicensingEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_INSURANCE_LICENSING_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.producer_licenses = Array.isArray(parsed.producer_licenses) ? parsed.producer_licenses : [];
        this.data.ce_requirements = Array.isArray(parsed.ce_requirements) ? parsed.ce_requirements : [];
        return true;
      } catch (e) {
        console.warn('TSMInsuranceLicensingEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_INSURANCE_LICENSING_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      const RISK_WINDOW = 30;
      return {
        tracked_licenses: this.data.producer_licenses.length,
        licenses_expiring_soon: this.data.producer_licenses.filter(l => (l.expires_in_days || 0) <= RISK_WINDOW).length,
        open_ce_requirements: this.data.ce_requirements.length,
        ce_deficient_requirements: this.data.ce_requirements.filter(r => (r.hours_completed || 0) < (r.hours_required || 0)).length
      };
    }

    // Financial exposure computed server-side against a private rate card
    // (server/private-config/insurance/licensing-financial-model.json),
    // never shipped to the browser — see
    // routes/insurance-licensing-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/insurance/licensing/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            producer_licenses: this.data.producer_licenses,
            ce_requirements: this.data.ce_requirements
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMInsuranceLicensingEngine: getFinancialSummary failed', e);
        return {
          currency: 'USD',
          lapsed_license_revenue_at_risk_total: 0,
          lapsed_license_revenue_at_risk_items: [],
          ce_noncompliance_fine_total: 0,
          ce_noncompliance_fine_items: [],
          total_exposure: 0,
          note: 'Financial summary unavailable — no revenue-at-risk/fine modeling shown.',
          license_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          ce_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed licensing/CE analysis — see
    // routes/insurance-licensing-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/insurance/licensing/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            producer_licenses: this.data.producer_licenses,
            ce_requirements: this.data.ce_requirements,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMInsuranceLicensingEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_INSURANCE_LICENSING_RELAY (registered
    // in relay.core.js's RELAY_REGISTRY under domain key
    // INSURANCE_LICENSING).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'insurance_licensing',
        domain: 'INSURANCE_LICENSING',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          producer_licenses: this.data.producer_licenses,
          ce_requirements: this.data.ce_requirements
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMInsuranceLicensingEngine = TSMInsuranceLicensingEngine;
})(typeof window !== 'undefined' ? window : this);
