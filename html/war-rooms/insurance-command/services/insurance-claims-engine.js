/* ============================================================
   TSM INSURANCE CLAIMS & APPEALS ENGINE
   war-rooms/insurance-command/services/insurance-claims-engine.js
   Mirrors college-research-fa-engine.js's method shape
   (loadSampleData/computeKpis/getFinancialSummary/getAiAnalysis/
   buildRelayPayload), generalized across this domain's two entity
   kinds (claims, appeals). First of four Insurance Command domains
   to get real backend wiring — see routes/insurance-claims-financial.js.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_CLAIMS = [
    { claim_id: 'CLM-4401', policy_ref: 'POL-88231', line: 'Auto', severity: 'HIGH', days_open: 41, reserve_amount: 82000 },
    { claim_id: 'CLM-4417', policy_ref: 'POL-88450', line: 'Property', severity: 'MEDIUM', days_open: 18, reserve_amount: 34500 },
    { claim_id: 'CLM-4433', policy_ref: 'POL-88602', line: 'Auto', severity: 'LOW', days_open: 6, reserve_amount: 6200 }
  ];
  const SAMPLE_APPEALS = [
    { appeal_id: 'APL-2201', claim_ref: 'CLM-4290', reason: 'Denied coverage — policy exclusion dispute', severity: 'HIGH', days_pending: 12 },
    { appeal_id: 'APL-2214', claim_ref: 'CLM-4318', reason: 'Denied coverage — policy exclusion dispute', severity: 'MEDIUM', days_pending: 4 }
  ];

  class TSMInsuranceClaimsEngine {
    constructor() {
      this.data = { claims: [], appeals: [] };
    }

    loadSampleData() {
      this.data.claims = [...SAMPLE_CLAIMS];
      this.data.appeals = [...SAMPLE_APPEALS];
    }

    loadRecords(entityKey, records) {
      if (!['claims', 'appeals'].includes(entityKey)) {
        console.warn('TSMInsuranceClaimsEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_INSURANCE_CLAIMS_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMInsuranceClaimsEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_INSURANCE_CLAIMS_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.claims = Array.isArray(parsed.claims) ? parsed.claims : [];
        this.data.appeals = Array.isArray(parsed.appeals) ? parsed.appeals : [];
        return true;
      } catch (e) {
        console.warn('TSMInsuranceClaimsEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_INSURANCE_CLAIMS_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      return {
        open_claims: this.data.claims.length,
        claims_over_30_days: this.data.claims.filter(c => (c.days_open || 0) > 30).length,
        open_appeals: this.data.appeals.length,
        total_reserve_amount: this.data.claims.reduce((s, c) => s + (c.reserve_amount || 0), 0)
      };
    }

    // Financial exposure computed server-side against a private rate card
    // (server/private-config/insurance/claims-financial-model.json), never
    // shipped to the browser — see routes/insurance-claims-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/insurance/claims/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            claims: this.data.claims,
            appeals: this.data.appeals
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMInsuranceClaimsEngine: getFinancialSummary failed, falling back to reserve-only totals', e);
        const reserve = this.data.claims.reduce((s, c) => s + (c.reserve_amount || 0), 0);
        return {
          currency: 'USD',
          reserve_adequacy_risk_total: 0,
          reserve_adequacy_risk_items: [],
          appeal_handling_cost_total: 0,
          appeal_handling_cost_items: [],
          total_reserve_amount: reserve,
          total_exposure: 0,
          note: 'Financial summary unavailable — showing raw reserve total only, no risk/appeal modeling.',
          reserve_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          appeal_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed triage analysis — see
    // routes/insurance-claims-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/insurance/claims/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            claims: this.data.claims,
            appeals: this.data.appeals,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMInsuranceClaimsEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_INSURANCE_CLAIMS_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key INSURANCE_CLAIMS).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'insurance_claims',
        domain: 'INSURANCE_CLAIMS',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          claims: this.data.claims,
          appeals: this.data.appeals
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMInsuranceClaimsEngine = TSMInsuranceClaimsEngine;
})(typeof window !== 'undefined' ? window : this);
