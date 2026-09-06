/* ============================================================
   TSM INSURANCE PROPERTY & CASUALTY ENGINE
   war-rooms/insurance-command/services/insurance-pc-engine.js
   Mirrors insurance-claims-engine.js's method shape, generalized
   across this domain's two entity kinds (underwriting_submissions,
   liability_exposures). Second of four Insurance Command domains
   to get real backend wiring — see routes/insurance-pc-financial.js.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_SUBMISSIONS = [
    { submission_id: 'SUB-9010', applicant: 'Meridian Logistics', line: 'Commercial Auto Fleet', severity: 'HIGH', premium_estimate: 145000, days_in_queue: 9 },
    { submission_id: 'SUB-9026', applicant: 'Coastal Property Group', line: 'Commercial Property', severity: 'MEDIUM', premium_estimate: 62000, days_in_queue: 3 },
    { submission_id: 'SUB-9041', applicant: 'Sunrise Retail LLC', line: 'General Liability', severity: 'LOW', premium_estimate: 18500, days_in_queue: 1 }
  ];
  const SAMPLE_LIABILITY = [
    { exposure_id: 'LIA-6601', policy_ref: 'POL-77120', type: 'Premises Liability', severity: 'HIGH', reserve_amount: 210000 },
    { exposure_id: 'LIA-6614', policy_ref: 'POL-77284', type: 'Product Liability', severity: 'MEDIUM', reserve_amount: 88000 }
  ];

  class TSMInsurancePcEngine {
    constructor() {
      this.data = { underwriting_submissions: [], liability_exposures: [] };
    }

    loadSampleData() {
      this.data.underwriting_submissions = [...SAMPLE_SUBMISSIONS];
      this.data.liability_exposures = [...SAMPLE_LIABILITY];
    }

    loadRecords(entityKey, records) {
      if (!['underwriting_submissions', 'liability_exposures'].includes(entityKey)) {
        console.warn('TSMInsurancePcEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_INSURANCE_PC_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMInsurancePcEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_INSURANCE_PC_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.underwriting_submissions = Array.isArray(parsed.underwriting_submissions) ? parsed.underwriting_submissions : [];
        this.data.liability_exposures = Array.isArray(parsed.liability_exposures) ? parsed.liability_exposures : [];
        return true;
      } catch (e) {
        console.warn('TSMInsurancePcEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_INSURANCE_PC_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      return {
        open_submissions: this.data.underwriting_submissions.length,
        submissions_needing_senior_review: this.data.underwriting_submissions.filter(s => String(s.severity).toUpperCase() === 'HIGH').length,
        open_liability_exposures: this.data.liability_exposures.length,
        total_premium_in_queue: this.data.underwriting_submissions.reduce((s, x) => s + (x.premium_estimate || 0), 0)
      };
    }

    // Financial exposure computed server-side against a private rate card
    // (server/private-config/insurance/pc-financial-model.json), never
    // shipped to the browser — see routes/insurance-pc-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/insurance/pc/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            underwriting_submissions: this.data.underwriting_submissions,
            liability_exposures: this.data.liability_exposures
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMInsurancePcEngine: getFinancialSummary failed, falling back to premium-only totals', e);
        const premium = this.data.underwriting_submissions.reduce((s, x) => s + (x.premium_estimate || 0), 0);
        return {
          currency: 'USD',
          senior_review_cost_total: 0,
          senior_review_cost_items: [],
          liability_reserve_risk_total: 0,
          liability_reserve_risk_items: [],
          total_premium_in_queue: premium,
          total_exposure: 0,
          note: 'Financial summary unavailable — showing raw premium-in-queue total only, no review-cost/reserve modeling.',
          review_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          reserve_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed underwriting/liability prioritization — see
    // routes/insurance-pc-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/insurance/pc/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            underwriting_submissions: this.data.underwriting_submissions,
            liability_exposures: this.data.liability_exposures,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMInsurancePcEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_INSURANCE_PC_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key INSURANCE_PC).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'insurance_pc',
        domain: 'INSURANCE_PC',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          underwriting_submissions: this.data.underwriting_submissions,
          liability_exposures: this.data.liability_exposures
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMInsurancePcEngine = TSMInsurancePcEngine;
})(typeof window !== 'undefined' ? window : this);
