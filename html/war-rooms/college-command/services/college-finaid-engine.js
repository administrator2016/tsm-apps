/* ============================================================
   TSM COLLEGE FINANCIAL AID ENGINE
   war-rooms/college-command/services/college-finaid-engine.js
   Mirrors war-rooms/schools-command/services/schools-engine.js's method
   shape (loadSampleData/computeKpis/getSlaBreaches/getFinancialSummary/
   buildRelayPayload), generalized across the Financial Aid domain's three
   entity kinds (r2t4_case, verification_case, cohort_default_flag).
   This is the priority-domain engine for the College vertical — the first
   of five domains (Financial Aid/Bursar/Endowment/Research-F&A/Accreditation)
   getting real backend wiring, matching how Schools was built first among
   its peers.
   ============================================================ */

(function (global) {
  'use strict';

  const ENTITY_KEYS = ['r2t4_cases', 'verification_cases', 'cohort_default_flags'];
  const CLOSED_R2T4_STAGES = ['closed'];
  const CLEARED_VERIFICATION_STAGES = ['cleared'];

  class TSMCollegeFinaidEngine {
    constructor(model) {
      this.model = model || { entities: {}, kpis: [] };
      this.data = { r2t4_cases: [], verification_cases: [], cohort_default_flags: [] };
      this._canonicalCore = null;
    }

    loadSampleData() {
      const sample = this.model.sample_data || {};
      ENTITY_KEYS.forEach(k => { this.data[k] = [...(sample[k] || [])]; });
    }

    loadRecords(entityKey, records) {
      if (!ENTITY_KEYS.includes(entityKey)) {
        console.warn('TSMCollegeFinaidEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    saveToStorage() {
      try {
        localStorage.setItem('TSM_COLLEGE_FINAID_DATA', JSON.stringify(this.data));
        return true;
      } catch (e) {
        console.warn('TSMCollegeFinaidEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_COLLEGE_FINAID_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        ENTITY_KEYS.forEach(k => { this.data[k] = Array.isArray(parsed[k]) ? parsed[k] : []; });
        return true;
      } catch (e) {
        console.warn('TSMCollegeFinaidEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_COLLEGE_FINAID_DATA'); } catch (e) { /* noop */ }
    }

    _idField(entityKey) {
      return { r2t4_cases: 'case_id', verification_cases: 'case_id', cohort_default_flags: 'flag_id' }[entityKey];
    }

    _entityDef(entityKey) {
      const singular = { r2t4_cases: 'r2t4_case', verification_cases: 'verification_case', cohort_default_flags: 'cohort_default_flag' }[entityKey];
      return (this.model.entities || {})[singular] || { stages: [] };
    }

    // R2T4 and verification cases carry an explicit days_late/days_open field
    // (federal 45-day return deadline and verification SLA respectively) —
    // simpler than Schools' hours-since-entered-stage model, since the
    // regulatory clock here starts at a specific reported event, not at
    // stage entry.
    getSlaBreaches(entityKey) {
      const idField = this._idField(entityKey);
      if (entityKey === 'r2t4_cases') {
        return (this.data.r2t4_cases || [])
          .filter(r => (r.days_late || 0) > 0)
          .map(r => ({ id: r[idField], stage: r.stage, days_late: r.days_late, record: r }))
          .sort((a, b) => b.days_late - a.days_late);
      }
      if (entityKey === 'verification_cases') {
        const def = this._entityDef(entityKey);
        const stageMap = {};
        (def.stages || []).forEach(s => { stageMap[s.id] = s; });
        return (this.data.verification_cases || [])
          .map(r => {
            const stage = stageMap[r.stage];
            if (!stage || stage.sla_hours == null) return null;
            const hoursOpen = (r.days_open || 0) * 24;
            if (hoursOpen <= stage.sla_hours) return null;
            return { id: r[idField], stage: stage.label, days_open: r.days_open, record: r };
          })
          .filter(Boolean)
          .sort((a, b) => b.days_open - a.days_open);
      }
      return [];
    }

    computeKpis() {
      const openR2t4 = this.data.r2t4_cases.filter(r => !CLOSED_R2T4_STAGES.includes(r.stage)).length;
      const r2t4OverSla = this.getSlaBreaches('r2t4_cases').length;
      const openVerification = this.data.verification_cases.filter(v => !CLEARED_VERIFICATION_STAGES.includes(v.stage)).length;
      const verificationOverSla = this.getSlaBreaches('verification_cases').length;
      const activePellDisbursed = this.data.verification_cases
        .filter(v => v.stage !== 'conflicting_info')
        .reduce((sum, v) => sum + (v.pell_amount_held || 0), 0);
      const cohortDefaultFlagsOpen = this.data.cohort_default_flags.filter(f => f.band !== 'monitoring').length;

      return {
        open_r2t4_cases: openR2t4,
        r2t4_over_sla: r2t4OverSla,
        open_verification_cases: openVerification,
        verification_over_sla: verificationOverSla,
        active_pell_disbursed: activePellDisbursed,
        cohort_default_flags_open: cohortDefaultFlagsOpen
      };
    }

    // Financial exposure is computed server-side against a private rate
    // card (server/private-config/college/financial-model.json), never
    // shipped to the browser — see routes/college-finaid-financial.js.
    async getFinancialSummary() {
      try {
        const res = await fetch('/api/college/finaid/financial-summary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            r2t4_breaches: this.getSlaBreaches('r2t4_cases'),
            verification_backlog: this.getSlaBreaches('verification_cases'),
            cohort_default_flags: this.data.cohort_default_flags.filter(f => f.band !== 'monitoring')
          })
        });
        if (!res.ok) throw new Error('financial-summary endpoint returned ' + res.status);
        return res.json();
      } catch (e) {
        console.warn('TSMCollegeFinaidEngine: getFinancialSummary failed, falling back to zeroed totals', e);
        return {
          currency: 'USD',
          r2t4_exposure_total: 0,
          r2t4_exposure_items: [],
          verification_exposure_total: 0,
          verification_exposure_items: [],
          cohort_default_exposure_total: 0,
          cohort_default_exposure_items: [],
          active_pell_disbursed: this.computeKpis().active_pell_disbursed,
          total_exposure: 0,
          note: 'Financial summary unavailable.',
          r2t4_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          verification_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' },
          cohort_default_confidence: { confidence: 0, note: ' Financial summary endpoint unreachable.' }
        };
      }
    }

    // Real Groq-backed compliance analysis — see routes/college-finaid-financial.js's
    // POST /analysis. Same try/catch shape as getFinancialSummary() above:
    // the endpoint itself is already resilient (always 200, degraded flag
    // instead of throwing), but the fetch itself can still fail (network,
    // route unmounted, etc.), so this still needs its own fallback message
    // rather than letting the war room page's await throw uncaught.
    async getAiAnalysis(context) {
      try {
        const res = await fetch('/api/college/finaid/analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kpis: this.computeKpis(),
            r2t4_breaches: this.getSlaBreaches('r2t4_cases'),
            verification_backlog: this.getSlaBreaches('verification_cases'),
            cohort_default_flags: this.data.cohort_default_flags.filter(f => f.band !== 'monitoring'),
            context: context || undefined
          })
        });
        if (!res.ok) throw new Error('analysis endpoint returned ' + res.status);
        const data = await res.json();
        return { answer: data.answer || 'No response.', degraded: !!data.degraded };
      } catch (e) {
        console.warn('TSMCollegeFinaidEngine: getAiAnalysis failed', e);
        return { answer: 'AI analysis unavailable — ' + e.message, degraded: true };
      }
    }

    // Relay payload written to TSM_COLLEGE_FINAID_RELAY (registered in
    // relay.core.js's RELAY_REGISTRY under domain key COLLEGE_FINAID).
    // Shape deliberately includes a top-level `domain` + `timestamp` so
    // college-strategist.html's aggregator can list/sort alerts across all
    // five college domains without per-domain special-casing.
    async buildRelayPayload(aiText) {
      return {
        vertical: 'college_finaid',
        domain: 'FINAID',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        r2t4_breaches: this.getSlaBreaches('r2t4_cases'),
        verification_breaches: this.getSlaBreaches('verification_cases'),
        financials: await this.getFinancialSummary(),
        records: {
          r2t4_cases: this.data.r2t4_cases,
          verification_cases: this.data.verification_cases,
          cohort_default_flags: this.data.cohort_default_flags
        },
        ai_summary: aiText || null
      };
    }

    // ── CanonicalCore integration ──────────────────────────────────────
    // Mirrors schools-engine.js's _canonical()/_riskLevelFor()/
    // getCanonicalRecords() exactly, generalized across this domain's three
    // entity kinds. Unlike Schools (which uses vertical: 'sch' — a value
    // never actually registered in architecture/canonical/entities.json's
    // enum, a pre-existing gap), 'college_finaid' IS registered there, so
    // validate() won't flag every record as having an unrecognized vertical.
    async _canonical() {
      if (this._canonicalCore) return this._canonicalCore;
      if (typeof window === 'undefined' || !window.CanonicalCore) {
        console.warn('TSMCollegeFinaidEngine: CanonicalCore not available -- include /runtime/kernel/canonical-core.js before college-finaid-engine.js to enable getCanonicalRecords().');
        return null;
      }
      const cc = new window.CanonicalCore();
      await cc.load();
      this._canonicalCore = cc;
      return cc;
    }

    _riskLevelFor(entityKey, record) {
      const idField = this._idField(entityKey);
      const breaches = this.getSlaBreaches(entityKey);
      const breach = breaches.find(b => b.id === record[idField]);
      if (!breach) return 'low';
      const measure = breach.days_late != null ? breach.days_late : breach.days_open;
      return measure > 10 ? 'critical' : measure > 3 ? 'high' : 'medium';
    }

    async getCanonicalRecords() {
      const cc = await this._canonical();
      if (!cc) return this.data;

      const kindConfig = [
        { key: 'r2t4_cases',          type: 'col_r2t4_case',           idField: 'case_id', ownerField: 'owner', statusField: 'stage', warRoom: '/html/war-rooms/college-command/college-finaid-command.html' },
        { key: 'verification_cases',  type: 'col_verification_case',   idField: 'case_id', ownerField: 'owner', statusField: 'stage', warRoom: '/html/war-rooms/college-command/college-finaid-command.html' },
        { key: 'cohort_default_flags',type: 'col_cohort_default_flag', idField: 'flag_id', ownerField: 'owner', statusField: 'band',  warRoom: '/html/war-rooms/college-command/college-finaid-command.html' }
      ];

      const out = {};
      for (const cfg of kindConfig) {
        const breaches = cfg.key !== 'cohort_default_flags' ? this.getSlaBreaches(cfg.key) : [];
        const breachIds = new Set(breaches.map(b => b.id));
        out[cfg.key] = this.data[cfg.key].map(r => {
          const def = this._entityDef(cfg.key);
          const stageOrBand = (def.stages || []).find(s => s.id === (r.stage || r.band));
          const { record } = cc.process({
            id: r[cfg.idField],
            type: cfg.type,
            vertical: 'college_finaid',
            owner: (cfg.ownerField && r[cfg.ownerField]) || 'Unassigned',
            status: stageOrBand ? stageOrBand.label : (r.stage || r.band),
            current_stage: r.stage || r.band,
            risk_level: cfg.key !== 'cohort_default_flags' ? this._riskLevelFor(cfg.key, r) : (r.band === 'sanction' ? 'critical' : r.band === 'warning' ? 'high' : 'medium'),
            sla_state: breachIds.has(r[cfg.idField]) ? 'breached' : 'on_track',
            linked_war_room: cfg.warRoom,
            ...r
          });
          return record;
        });
      }
      return out;
    }
  }

  global.TSMCollegeFinaidEngine = TSMCollegeFinaidEngine;
})(typeof window !== 'undefined' ? window : this);
