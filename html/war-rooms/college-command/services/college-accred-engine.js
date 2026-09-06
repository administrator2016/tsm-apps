/* ============================================================
   TSM COLLEGE ACCREDITATION ENGINE
   war-rooms/college-command/services/college-accred-engine.js
   Mirrors college-bursar-engine.js's method shape, but computes a
   readiness RISK SCORE (points, no currency) instead of dollar exposure —
   see routes/college-accred-financial.js for why. Fifth and final College
   domain to get real backend wiring.
   ============================================================ */

(function (global) {
  'use strict';

  const SAMPLE_FINDINGS = [
    { finding_id: 'FND-501', standard: 'Standard 3 — Institutional Resources', severity: 'HIGH', days_open: 61, owner: 'Provost Office' },
    { finding_id: 'FND-512', standard: 'Standard 7 — Governance', severity: 'MEDIUM', days_open: 24, owner: 'General Counsel' },
    { finding_id: 'FND-519', standard: 'Standard 4 — Academic Program', severity: 'LOW', days_open: 8, owner: 'Academic Affairs' }
  ];
  const SAMPLE_STANDARDS_AT_RISK = [
    { standard_id: 'STD-3', description: 'Institutional Resources — financial sustainability evidence overdue', severity: 'HIGH' },
    { standard_id: 'STD-7', description: 'Governance — board self-assessment not yet filed', severity: 'MEDIUM' }
  ];
  const SAMPLE_DAYS_TO_SITE_VISIT = 47;

  class TSMCollegeAccredEngine {
    constructor() {
      this.data = { findings: [], standards_at_risk: [], days_to_site_visit: 0 };
    }

    loadSampleData() {
      this.data.findings = [...SAMPLE_FINDINGS];
      this.data.standards_at_risk = [...SAMPLE_STANDARDS_AT_RISK];
      this.data.days_to_site_visit = SAMPLE_DAYS_TO_SITE_VISIT;
    }

    loadRecords(entityKey, records) {
      if (!['findings', 'standards_at_risk'].includes(entityKey)) {
        console.warn('TSMCollegeAccredEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_COLLEGE_ACCRED_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMCollegeAccredEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_COLLEGE_ACCRED_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        this.data.findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        this.data.standards_at_risk = Array.isArray(parsed.standards_at_risk) ? parsed.standards_at_risk : [];
        this.data.days_to_site_visit = Number(parsed.days_to_site_visit) || 0;
        return true;
      } catch (e) {
        console.warn('TSMCollegeAccredEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_COLLEGE_ACCRED_DATA'); } catch (e) { /* noop */ }
    }

    computeKpis() {
      const pastDue = this.data.findings.filter(f => (f.days_open || 0) > 45);
      return {
        open_findings: this.data.findings.length,
        findings_past_due: pastDue.length,
        standards_at_risk: this.data.standards_at_risk.length,
        days_to_next_site_visit: this.data.days_to_site_visit
      };
    }

    // Readiness score computed server-side against a private rate card
    // (server/private-config/college/accred-financial-model.json), never
    // shipped to the browser — see routes/college-accred-financial.js.
    // Deliberately NOT named getFinancialSummary(): this domain has no
    // dollar exposure, so the method and response are named for what they
    // actually are.
    async getReadinessSummary() {
      try {
        const res = await fetch('/api/college/accred/readiness-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            findings: this.data.findings,
            standards_at_risk: this.data.standards_at_risk,
            days_to_site_visit: this.data.days_to_site_visit
          })
        });
        if (!res.ok) throw new Error('readiness-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMCollegeAccredEngine: getReadinessSummary failed, falling back to count-only totals', e);
        const kpis = this.computeKpis();
        return {
          findings_risk_total: 0,
          findings_risk_items: [],
          standards_risk_total: 0,
          standards_risk_items: [],
          site_visit_proximity_bonus: 0,
          days_to_site_visit: kpis.days_to_next_site_visit,
          total_readiness_risk_score: 0,
          note: 'Readiness summary unavailable — showing raw finding/standard counts only, no risk scoring.',
          findings_confidence: { confidence: 0, note: ' Readiness summary endpoint unreachable.' },
          standards_confidence: { confidence: 0, note: ' Readiness summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed readiness analysis — see
    // routes/college-accred-financial.js's POST /analysis.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/college/accred/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            findings: this.data.findings,
            standards_at_risk: this.data.standards_at_risk,
            days_to_site_visit: this.data.days_to_site_visit,
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMCollegeAccredEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_COLLEGE_ACCRED_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key COLLEGE_ACCRED).
    // `financials: null` is explicit (not omitted) so a college-strategist
    // aggregator that reads payload.financials?.total_exposure across all
    // five domains gets a clean null rather than an undefined-property
    // crash — `readiness` carries this domain's actual risk signal instead.
    // VERIFY: confirm against college-strategist.html's actual aggregator
    // contract and adjust if it expects something different for this domain.
    async buildRelayPayload(aiText) {
      return {
        vertical: 'college_accred',
        domain: 'COLLEGE_ACCRED',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        financials: null,
        readiness: await this.getReadinessSummary(),
        records: {
          findings: this.data.findings,
          standards_at_risk: this.data.standards_at_risk
        },
        ai_summary: aiText || null
      };
    }
  }

  global.TSMCollegeAccredEngine = TSMCollegeAccredEngine;
})(typeof window !== 'undefined' ? window : this);