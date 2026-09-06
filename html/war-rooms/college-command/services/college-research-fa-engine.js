/* ============================================================
   TSM COLLEGE RESEARCH / F&A ENGINE
   war-rooms/college-command/services/college-research-fa-engine.js
   Mirrors college-bursar-engine.js's method shape
   (loadSampleData/computeKpis/getFinancialSummary/getAiAnalysis/
   buildRelayPayload), generalized across this domain's two entity kinds
   (awards, effort_reports). Fourth College domain to get real backend
   wiring, following Finaid → Bursar → Endowment.
   ============================================================ */

(function (global) {
  'use strict';

  // Numeric fields (planned_budget/actual_spend) replace the earlier
  // descriptive "burn_variance" string — server-side exposure math needs
  // real numbers, not a display-only percentage string.
  const SAMPLE_AWARDS = [
    { award_id: 'AWD-7710', pi: 'Dr. Alvarez', sponsor: 'NSF', severity: 'HIGH', planned_budget: 210000, actual_spend: 289800 },
    { award_id: 'AWD-7742', pi: 'Dr. Okafor', sponsor: 'NIH', severity: 'MEDIUM', planned_budget: 340000, actual_spend: 387600 },
    { award_id: 'AWD-7799', pi: 'Dr. Lindqvist', sponsor: 'DOE', severity: 'LOW', planned_budget: 155000, actual_spend: 148800 }
  ];
  const SAMPLE_EFFORT_REPORTS = [
    { report_id: 'EFF-3301', pi: 'Dr. Alvarez', award: 'AWD-7710', days_overdue: 22 },
    { report_id: 'EFF-3318', pi: 'Dr. Chen', award: 'AWD-7688', days_overdue: 9 }
  ];
  const SAMPLE_FA_RECOVERY_SHORTFALL = 61500; // institution-reported — indirect cost recovery shortfall vs negotiated rate

  class TSMCollegeResearchFaEngine {
    constructor() {
      this.data = { awards: [], effort_reports: [], fa_recovery_shortfall: 0 };
    }

    loadSampleData() {
      this.data.awards = [...SAMPLE_AWARDS];
      this.data.effort_reports = [...SAMPLE_EFFORT_REPORTS];
      this.data.fa_recovery_shortfall = SAMPLE_FA_RECOVERY_SHORTFALL;
    }

    loadRecords(entityKey, records) {
      if (!['awards', 'effort_reports'].includes(entityKey)) {
        console.warn('TSMCollegeResearchFaEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_COLLEGE_RESEARCH_FA_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMCollegeResearchFaEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_COLLEGE_RESEARCH_FA_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.awards = Array.isArray(parsed.awards) ? parsed.awards : [];
        this.data.effort_reports = Array.isArray(parsed.effort_reports) ? parsed.effort_reports : [];
        this.data.fa_recovery_shortfall = Number(parsed.fa_recovery_shortfall) || 0;
        return true;
      } catch (e) {
        console.warn('TSMCollegeResearchFaEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_COLLEGE_RESEARCH_FA_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      const overBurn = this.data.awards.filter(a => (a.actual_spend || 0) > (a.planned_budget || 0));
      return {
        open_awards: this.data.awards.length,
        awards_over_burn_rate: overBurn.length,
        fa_recovery_shortfall: this.data.fa_recovery_shortfall,
        effort_reports_overdue: this.data.effort_reports.filter(r => (r.days_overdue || 0) > 0).length
      };
    }

    // Financial exposure computed server-side against a private rate card
    // (server/private-config/college/research-fa-financial-model.json),
    // never shipped to the browser — see routes/college-research-fa-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/college/research-fa/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            awards: this.data.awards,
            effort_reports: this.data.effort_reports,
            fa_recovery_shortfall: this.data.fa_recovery_shortfall
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMCollegeResearchFaEngine: getFinancialSummary failed, falling back to shortfall-only totals', e);
        const shortfall = this.data.fa_recovery_shortfall;
        return {
          currency: 'USD',
          overburn_exposure_total: 0,
          overburn_exposure_items: [],
          effort_noncompliance_exposure_total: 0,
          effort_noncompliance_exposure_items: [],
          fa_recovery_shortfall: shortfall,
          total_exposure: shortfall,
          note: 'Financial summary unavailable — showing raw F&A recovery shortfall only, no over-burn/effort modeling.',
          overburn_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          effort_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed compliance analysis — see
    // routes/college-research-fa-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/college/research-fa/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            awards: this.data.awards,
            effort_reports: this.data.effort_reports,
            fa_recovery_shortfall: this.data.fa_recovery_shortfall,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMCollegeResearchFaEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_COLLEGE_RESEARCH_FA_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key COLLEGE_RESEARCH_FA).
    async buildRelayPayload(aiText) {
      return {
        vertical: 'college_research_fa',
        domain: 'COLLEGE_RESEARCH_FA',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: await this.getFinancialSummary(),
        records: {
          awards: this.data.awards,
          effort_reports: this.data.effort_reports
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMCollegeResearchFaEngine = TSMCollegeResearchFaEngine;
})(typeof window !== 'undefined' ? window : this);