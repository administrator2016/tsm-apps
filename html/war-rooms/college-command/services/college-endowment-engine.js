/* ============================================================
   TSM COLLEGE ENDOWMENT ENGINE
   war-rooms/college-command/services/college-endowment-engine.js
   Mirrors college-finaid-engine.js / college-bursar-engine.js's method
   shape (loadSampleData/computeKpis/getFinancialSummary/getAiAnalysis/
   buildRelayPayload), generalized across Endowment's two entity kinds
   (underwater_funds, restriction_flags). Third College domain to get real
   backend wiring, following Financial Aid then Bursar.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_UNDERWATER_FUNDS = [
    { fund_id: 'END-0231', purpose: 'STEM Scholarship Fund', severity: 'HIGH', corpus_deficit: 184000, trend: 'Worsening' },
    { fund_id: 'END-0298', purpose: 'Library Acquisitions Fund', severity: 'MEDIUM', corpus_deficit: 42000, trend: 'Stable' },
    { fund_id: 'END-0355', purpose: 'Faculty Chair — Economics', severity: 'LOW', corpus_deficit: 6100, trend: 'Improving' }
  ];
  const SAMPLE_RESTRICTION_FLAGS = [
    { flag_id: 'DR-1102', fund: 'END-0231', issue: 'Spending exceeds donor-restricted purpose scope', severity: 'HIGH' },
    { flag_id: 'DR-1119', fund: 'END-0410', issue: 'Missing annual donor reporting letter', severity: 'MEDIUM' }
  ];

  class TSMCollegeEndowmentEngine {
    constructor() {
      this.data = { underwater_funds: [], restriction_flags: [] };
    }

    loadSampleData() {
      this.data.underwater_funds = [...SAMPLE_UNDERWATER_FUNDS];
      this.data.restriction_flags = [...SAMPLE_RESTRICTION_FLAGS];
    }

    loadRecords(entityKey, records) {
      if (!['underwater_funds', 'restriction_flags'].includes(entityKey)) {
        console.warn('TSMCollegeEndowmentEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_COLLEGE_ENDOWMENT_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMCollegeEndowmentEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_COLLEGE_ENDOWMENT_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.underwater_funds = Array.isArray(parsed.underwater_funds) ? parsed.underwater_funds : [];
        this.data.restriction_flags = Array.isArray(parsed.restriction_flags) ? parsed.restriction_flags : [];
        return true;
      } catch (e) {
        console.warn('TSMCollegeEndowmentEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_COLLEGE_ENDOWMENT_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      const totalDeficit = this.data.underwater_funds.reduce((sum, f) => sum + (f.corpus_deficit || 0), 0);
      return {
        total_funds_tracked: this.data.underwater_funds.length + 62, // sample healthy-fund baseline
        underwater_funds: this.data.underwater_funds.length,
        total_corpus_deficit: totalDeficit,
        donor_restriction_flags_open: this.data.restriction_flags.length
      };
    }

    // Financial exposure is computed server-side against a private rate
    // card (server/private-config/college/endowment-financial-model.json),
    // never shipped to the browser — see routes/college-endowment-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/college/endowment/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            underwater_funds: this.data.underwater_funds,
            restriction_flags: this.data.restriction_flags
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMCollegeEndowmentEngine: getFinancialSummary failed, falling back to deficit-only totals', e);
        const totalCorpusDeficit = this.computeKpis().total_corpus_deficit;
        return {
          currency: 'USD',
          income_foregone_exposure_total: 0,
          income_foregone_exposure_items: [],
          donor_restriction_exposure_total: 0,
          donor_restriction_exposure_items: [],
          total_corpus_deficit: totalCorpusDeficit,
          total_exposure: 0,
          note: 'Financial summary unavailable — showing raw corpus deficit only, no income-foregone/donor-restriction modeling.',
          income_foregone_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          donor_restriction_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed fund-compliance analysis — see
    // routes/college-endowment-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/college/endowment/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            underwater_funds: this.data.underwater_funds,
            restriction_flags: this.data.restriction_flags,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMCollegeEndowmentEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_COLLEGE_ENDOWMENT_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key COLLEGE_ENDOWMENT).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'college_endowment',
        domain: 'COLLEGE_ENDOWMENT',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          underwater_funds: this.data.underwater_funds,
          restriction_flags: this.data.restriction_flags
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMCollegeEndowmentEngine = TSMCollegeEndowmentEngine;
})(typeof window !== 'undefined' ? window : this);
