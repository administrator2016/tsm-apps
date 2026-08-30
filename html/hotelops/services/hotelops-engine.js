/* ============================================================
   TSM HOTELOPS ENGINE
   war-rooms/hotelops/services/hotelops-engine.js
   Mirrors war-rooms/mortgage/services/mortgage-engine.js's method
   shape, generalized across HotelOps's three trackable entity kinds
   (maintenance_tickets, ota_charges, compliance_items) plus a
   revenue snapshot (property) that isn't stage-based like the other
   three -- RevPAR/ADR/Occupancy are point-in-time metrics, not a
   pipeline with SLA breaches, so they get their own accessor rather
   than being forced into the ENTITY_KEYS/getSlaBreaches shape.
   ============================================================ */

(function (global) {
  'use strict';

  const ENTITY_KEYS = [
    'maintenance_tickets', 'ota_charges', 'compliance_items', 'iot_sensors',
    'reservations', 'front_desk_queue', 'vip_arrivals', 'housekeeping_tasks',
    'staff_shifts', 'incidents', 'airbnb_listings'
  ];
  const IOT_SEV_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
  const SEV_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

  class TSMHotelOpsEngine {
    constructor(model) {
      this.model = model || { entities: {}, kpis: [], sample_data: {}, portfolio: [] };
      this.data = {
        maintenance_tickets: [], ota_charges: [], compliance_items: [], iot_sensors: [],
        reservations: [], front_desk_queue: [], vip_arrivals: [], housekeeping_tasks: [],
        staff_shifts: [], incidents: []
      };
      this.property = null; // revenue/occupancy snapshot, set via loadSampleData()
      this.energyUsage = null; // energy_usage snapshot, set via loadSampleData()
      this.predictiveAlerts = []; // predictive_alerts list, set via loadSampleData()
    }

    /* ---------- Loading ---------- */

    loadSampleData() {
      const sample = this.model.sample_data || {};
      ENTITY_KEYS.forEach(k => { this.data[k] = [...(sample[k] || [])]; });
      this.property = sample.property ? { ...sample.property } : null;
      this.energyUsage = sample.energy_usage ? { ...sample.energy_usage } : null;
      this.predictiveAlerts = [...(sample.predictive_alerts || [])];
    }

    loadRecords(entityKey, records) {
      if (!ENTITY_KEYS.includes(entityKey)) {
        console.warn('TSMHotelOpsEngine: unknown entity key', entityKey);
        return;
      }
      this.data[entityKey] = [...(this.data[entityKey] || []), ...records];
    }

    /* ---------- Persistence ---------- */

    saveToStorage() {
      try {
        localStorage.setItem('TSM_HOTELOPS_DATA', JSON.stringify({ data: this.data, property: this.property }));
        return true;
      } catch (e) {
        console.warn('TSMHotelOpsEngine: saveToStorage failed', e);
        return false;
      }
    }

    loadFromStorage() {
      try {
        const raw = localStorage.getItem('TSM_HOTELOPS_DATA');
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        ENTITY_KEYS.forEach(k => { this.data[k] = Array.isArray(parsed.data && parsed.data[k]) ? parsed.data[k] : []; });
        this.property = parsed.property || this.property;
        return true;
      } catch (e) {
        console.warn('TSMHotelOpsEngine: loadFromStorage failed', e);
        return false;
      }
    }

    clearStorage() {
      try { localStorage.removeItem('TSM_HOTELOPS_DATA'); } catch (e) { /* noop */ }
    }

    /* ---------- Maintenance: SLA breach detection ----------
       Same "hours over" model Mortgage/NOC/CRM use. sla_hours by
       severity comes from the model, never hard-coded here. */

    _maintSlaHours(severity) {
      const slaMap = (this.model.entities && this.model.entities.maintenance_ticket &&
        this.model.entities.maintenance_ticket.sla_hours_by_severity) || {};
      return slaMap[severity] != null ? slaMap[severity] : null;
    }

    getMaintenanceBreaches() {
      return (this.data.maintenance_tickets || [])
        .filter(t => t.stage !== 'resolved')
        .map(t => {
          const slaHours = this._maintSlaHours(t.severity);
          if (slaHours == null) return null;
          const hoursOver = (t.opened_hours_ago || 0) - slaHours;
          if (hoursOver <= 0) return null;
          return { id: t.ticket_id, room: t.room, title: t.title, severity: t.severity, hours_over: Math.round(hoursOver * 10) / 10, record: t };
        })
        .filter(Boolean)
        .sort((a, b) => b.hours_over - a.hours_over);
    }

    /* ---------- OTA overcharge exposure ----------
       Real math from contracted_pct vs charged_pct * amount, never
       an invented flat number -- same "rate card from the model,
       computed from data" pattern as Mortgage's exposure calcs. */

    getOtaExposure() {
      const items = (this.data.ota_charges || []).map(c => {
        const overchargePct = Math.max(0, (c.charged_pct || 0) - (c.contracted_pct || 0));
        const overchargeAmount = Math.round((overchargePct / 100) * (c.booking_amount || 0));
        return { ...c, overcharge_pct: Math.round(overchargePct * 10) / 10, overcharge_amount: overchargeAmount };
      }).filter(c => c.overcharge_amount > 0)
        .sort((a, b) => b.overcharge_amount - a.overcharge_amount);
      const periodTotal = items.reduce((s, it) => s + it.overcharge_amount, 0);
      return {
        period_total: periodTotal,
        annualized_estimate: Math.round(periodTotal * 12),
        items
      };
    }

    /* ---------- Compliance risk register ---------- */

    getComplianceRisk() {
      return (this.data.compliance_items || [])
        .filter(c => c.stage !== 'cleared')
        .map(c => ({
          id: c.item_id,
          type: c.type,
          detail: c.detail,
          due_in_days: c.due_in_days,
          severity: c.due_in_days != null && c.due_in_days <= 14 ? 'HIGH' : (c.due_in_days != null && c.due_in_days <= 30 ? 'MED' : 'LOW')
        }))
        .sort((a, b) => (a.due_in_days ?? 999) - (b.due_in_days ?? 999));
    }

    /* ---------- IoT sensor alerts ----------
       Real sensor records (this.data.iot_sensors) carry type/status/reading/
       target/unit -- no pre-set severity or stage. Alerts are derived from
       actual sensor behavior: an offline device, a leak sensor in alert
       state, or a thermostat drifting from its setpoint. Occupancy sensors
       are informational only and never generate an alert. */

    /* Resolves a sensor's location label -- either its hotel room number
       (rooms) or its matched Airbnb listing's unit name + code (STR
       units). Falls back to a bare listing_id if the sensor references
       a listing_id not found in the currently-loaded airbnb_listings. */
    _iotLocationLabel(s) {
      if (s.listing_id) {
        const listing = (this.data.airbnb_listings || []).find(l => l.listing_id === s.listing_id);
        return listing ? `${listing.unit_name} (${listing.listing_id})` : `listing ${s.listing_id}`;
      }
      return `room ${s.room}`;
    }

    _iotSensorEvaluation(s) {
      const loc = this._iotLocationLabel(s);
      if ((s.status || '').toLowerCase() === 'offline') {
        return { severity: 'high', issue: 'Sensor offline', detail: `${s.type || 'Sensor'} in ${loc} is offline — no readings available.` };
      }
      if ((s.status || '').toLowerCase() === 'alert' || (s.type === 'water_leak' && s.reading === 'detected')) {
        return { severity: 'urgent', issue: 'Water leak detected', detail: `Water leak sensor in ${loc} reports a leak.` };
      }
      if (s.type === 'thermostat' && typeof s.reading === 'number' && typeof s.target === 'number') {
        const diff = Math.round(Math.abs(s.reading - s.target) * 10) / 10;
        const unit = s.unit || '';
        if (diff >= 8) return { severity: 'high', issue: 'Temperature drift', detail: `${loc} reading ${s.reading}${unit} vs target ${s.target}${unit} (${diff}${unit} off).` };
        if (diff >= 4) return { severity: 'medium', issue: 'Temperature drift', detail: `${loc} reading ${s.reading}${unit} vs target ${s.target}${unit} (${diff}${unit} off).` };
      }
      return null;
    }

    getIotAlerts() {
      const sensors = this.data.iot_sensors || [];
      return sensors
        .map(s => {
          const evalResult = this._iotSensorEvaluation(s);
          if (!evalResult) return null;
          const listing = s.listing_id ? (this.data.airbnb_listings || []).find(l => l.listing_id === s.listing_id) : null;
          return {
            id: s.sensor_id,
            room: s.room || null,
            listing_id: s.listing_id || null,
            unit_name: listing ? listing.unit_name : null,
            type: s.type,
            status: s.status,
            severity: evalResult.severity,
            issue: evalResult.issue,
            detail: evalResult.detail,
            reading: s.reading,
            target: s.target,
            unit: s.unit,
            record: s
          };
        })
        .filter(Boolean)
        .sort((a, b) => (IOT_SEV_ORDER[a.severity] ?? 4) - (IOT_SEV_ORDER[b.severity] ?? 4));
    }

    /* ---------- Reservations: payment failures, unconfirmed-near-arrival, waitlist risk ----------
       Threshold (unconfirmed_warning_hours) comes from the model, same
       "hours over" style as maintenance SLA, just framed as "hours until
       arrival" rather than "hours since opened". */

    _fmtAmount(amount) {
      return (amount != null && !isNaN(amount)) ? ` — $${Number(amount).toLocaleString()}` : '';
    }
    getReservationRisks() {
      const warnHours = (this.model.entities && this.model.entities.reservation &&
        this.model.entities.reservation.unconfirmed_warning_hours) != null
        ? this.model.entities.reservation.unconfirmed_warning_hours : 48;

      return (this.data.reservations || [])
        .map(r => {
          if (r.payment_status === 'failed') {
            return { id: r.res_id, guest: r.guest, type: 'payment_failed', severity: 'urgent',
              hours_to_arrival: r.hours_to_arrival,
              amount: r.amount, detail: `Payment failed — ${r.room_type}, arriving in ${r.hours_to_arrival}h.${this._fmtAmount(r.amount)}`, record: r };
          }
          if (r.status === 'unconfirmed' && r.hours_to_arrival <= warnHours) {
            const severity = r.hours_to_arrival <= warnHours / 4 ? 'urgent' : r.hours_to_arrival <= warnHours / 2 ? 'high' : 'medium';
            return { id: r.res_id, guest: r.guest, type: 'unconfirmed_near_arrival', severity,
              hours_to_arrival: r.hours_to_arrival,
              amount: r.amount, detail: `Still unconfirmed, arriving in ${r.hours_to_arrival}h.${this._fmtAmount(r.amount)}`, record: r };
          }
          if (r.status === 'waitlist') {
            const severity = r.hours_to_arrival <= warnHours / 4 ? 'urgent' : r.hours_to_arrival <= warnHours / 2 ? 'high' : 'medium';
            return { id: r.res_id, guest: r.guest, type: 'waitlist_risk', severity,
              hours_to_arrival: r.hours_to_arrival,
              amount: r.amount, detail: `On waitlist, arriving in ${r.hours_to_arrival}h — ${r.room_type} not yet secured.${this._fmtAmount(r.amount)}`, record: r };
          }
          return null;
        })
        .filter(Boolean)
        .sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4) || a.hours_to_arrival - b.hours_to_arrival);
    }

    /* ---------- Front Desk: check-in/out/request wait-time SLA breaches ----------
       sla_minutes_by_type comes from the model, mirrors the maintenance
       sla_hours_by_severity pattern but keyed by request type instead
       of severity, and measured in minutes since that's the real unit
       front-desk wait times are tracked in. */

    _frontDeskSlaMinutes(type) {
      const slaMap = (this.model.entities && this.model.entities.front_desk_ticket &&
        this.model.entities.front_desk_ticket.sla_minutes_by_type) || {};
      return slaMap[type] != null ? slaMap[type] : null;
    }

    getFrontDeskBreaches() {
      return (this.data.front_desk_queue || [])
        .filter(t => t.status !== 'complete')
        .map(t => {
          const slaMin = this._frontDeskSlaMinutes(t.type);
          if (slaMin == null) return null;
          const minutesOver = (t.waited_minutes || 0) - slaMin;
          if (minutesOver <= 0) return null;
          return { id: t.ticket_id, guest: t.guest, room: t.room, type: t.type,
            minutes_over: Math.round(minutesOver), waited_minutes: t.waited_minutes, record: t };
        })
        .filter(Boolean)
        .sort((a, b) => b.minutes_over - a.minutes_over);
    }

    /* ---------- VIP Arrivals: readiness gaps ahead of arrival ----------
       Gap detection is binary from the record (amenities_ready/host_assigned
       flags, not invented here); severity blends gap count with how close
       arrival is, using the readiness_warning_hours threshold from the model. */

    getVipReadiness() {
      const warnHours = (this.model.entities && this.model.entities.vip_arrival &&
        this.model.entities.vip_arrival.readiness_warning_hours) != null
        ? this.model.entities.vip_arrival.readiness_warning_hours : 24;

      return (this.data.vip_arrivals || [])
        .map(v => {
          const gaps = [];
          if (!v.amenities_ready) gaps.push('Amenities not staged');
          if (!v.host_assigned) gaps.push('Host not assigned');
          if (!gaps.length) return null;
          const close = v.arrival_hours_away <= warnHours / 4;
          const severity = close && gaps.length > 1 ? 'urgent' : close ? 'high' : gaps.length > 1 ? 'high' : 'medium';
          return { id: v.vip_id, guest: v.guest, room: v.room, tier: v.tier,
            arrival_hours_away: v.arrival_hours_away, gaps, severity, record: v };
        })
        .filter(Boolean)
        .sort((a, b) => a.arrival_hours_away - b.arrival_hours_away);
    }

    /* ---------- Housekeeping: task SLA breaches by type ----------
       Same shape as getMaintenanceBreaches, sla_hours_by_type from the
       model instead of sla_hours_by_severity since housekeeping tasks
       don't carry a severity field. */

    _housekeepingSlaHours(type) {
      const slaMap = (this.model.entities && this.model.entities.housekeeping_task &&
        this.model.entities.housekeeping_task.sla_hours_by_type) || {};
      return slaMap[type] != null ? slaMap[type] : null;
    }

    getHousekeepingBreaches() {
      return (this.data.housekeeping_tasks || [])
        .filter(t => t.stage !== 'complete')
        .map(t => {
          const slaHours = this._housekeepingSlaHours(t.type);
          if (slaHours == null) return null;
          const hoursOver = (t.started_hours_ago || 0) - slaHours;
          if (hoursOver <= 0) return null;
          return { id: t.task_id, room: t.room, type: t.type, assigned_to: t.assigned_to,
            hours_over: Math.round(hoursOver * 10) / 10, record: t };
        })
        .filter(Boolean)
        .sort((a, b) => b.hours_over - a.hours_over);
    }

    /* ---------- Staff Operations: staffing gaps vs required headcount ----------
       gap_pct_by_severity thresholds come from the model; gap is computed
       from required_headcount vs scheduled_headcount on each shift record,
       never a hard-coded headcount number. */

    getStaffingGaps() {
      const thresholds = (this.model.entities && this.model.entities.staff_shift &&
        this.model.entities.staff_shift.gap_pct_by_severity) || { high: 30, medium: 15 };

      return (this.data.staff_shifts || [])
        .map(s => {
          const gap = (s.required_headcount || 0) - (s.scheduled_headcount || 0);
          if (gap <= 0) return null;
          const gapPct = s.required_headcount > 0 ? Math.round((gap / s.required_headcount) * 1000) / 10 : 0;
          const severity = gapPct >= thresholds.high ? 'high' : gapPct >= thresholds.medium ? 'medium' : 'low';
          return { id: s.shift_id, department: s.department, shift: s.shift,
            required: s.required_headcount, scheduled: s.scheduled_headcount,
            gap, gap_pct: gapPct, severity, record: s };
        })
        .filter(Boolean)
        .sort((a, b) => b.gap_pct - a.gap_pct);
    }

    /* ---------- Incident Center: open incidents with response-time SLA escalation ----------
       response_sla_hours_by_severity from the model, same "hours over"
       shape as maintenance breaches. */

    _incidentSlaHours(severity) {
      const slaMap = (this.model.entities && this.model.entities.incident &&
        this.model.entities.incident.response_sla_hours_by_severity) || {};
      return slaMap[severity] != null ? slaMap[severity] : null;
    }

    getOpenIncidents() {
      return (this.data.incidents || [])
        .filter(i => i.status !== 'resolved')
        .map(i => {
          const slaHours = this._incidentSlaHours(i.severity);
          const hoursOver = slaHours != null ? Math.round(((i.reported_hours_ago || 0) - slaHours) * 10) / 10 : null;
          return { id: i.incident_id, type: i.type, area: i.room_or_area, severity: i.severity,
            status: i.status, reported_hours_ago: i.reported_hours_ago,
            hours_over: hoursOver, escalated: hoursOver != null && hoursOver > 0, record: i };
        })
        .sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4) || (b.hours_over ?? -999) - (a.hours_over ?? -999));
    }

    /* ---------- Energy usage summary ----------
       Straight passthrough of the energy_usage snapshot from the model
       (period/hvac_cost/lighting_cost/total_cost/trend/cost-per-room) --
       these are point-in-time facility metrics, not derived from other
       entity arrays, so there's nothing to compute here. */

    getEnergySummary() {
      return this.energyUsage ? { ...this.energyUsage } : null;
    }

    /* ---------- Predictive maintenance risk ----------
       Straight passthrough of the predictive_alerts snapshot, sorted
       worst-health-first so the highest-risk equipment surfaces on top. */

    getPredictiveRisk() {
      return [...(this.predictiveAlerts || [])]
        .sort((a, b) => (a.health_score ?? 100) - (b.health_score ?? 100));
    }

    /* ---------- Revenue KPIs ----------
       Field names match what hotelops-war-room.html reads directly:
       revpar, adr, occupancy_pct, gop_margin_pct, nps_score,
       section179_eligible, weekday_occ_pct, weekend_occ_pct. */

    computeKpis() {
      const p = this.property || {};
      const roomsAvailable = p.rooms_total || 0;
      const roomsSold = p.rooms_sold || 0;
      const roomRevenue = p.room_revenue || 0;
      const occupancyPct = roomsAvailable > 0 ? Math.round((roomsSold / roomsAvailable) * 1000) / 10 : 0;
      const adr = roomsSold > 0 ? Math.round((roomRevenue / roomsSold) * 100) / 100 : 0;
      const revpar = roomsAvailable > 0 ? Math.round((roomRevenue / roomsAvailable) * 100) / 100 : 0;
      const maintBreaches = this.getMaintenanceBreaches();
      const urgentTickets = (this.data.maintenance_tickets || []).filter(t => t.stage !== 'resolved' && t.severity === 'urgent').length;
      const openTickets = (this.data.maintenance_tickets || []).filter(t => t.stage !== 'resolved').length;
      const complianceRisk = this.getComplianceRisk();
      const iotAlerts = this.getIotAlerts();
      const reservationRisks = this.getReservationRisks();
      const frontDeskBreaches = this.getFrontDeskBreaches();
      const vipReadiness = this.getVipReadiness();
      const housekeepingBreaches = this.getHousekeepingBreaches();
      const staffingGaps = this.getStaffingGaps();
      const openIncidents = this.getOpenIncidents();

      return {
        revpar,
        adr,
        occupancy_pct: occupancyPct,
        gop_margin_pct: p.gop_margin_pct ?? null,
        gop_target_pct: p.gop_target_pct ?? null,
        nps_score: p.nps_score ?? null,
        nps_industry_avg: p.nps_industry_avg ?? null,
        section179_eligible: p.section179_eligible ?? null,
        weekday_occ_pct: p.weekday_occ_pct ?? null,
        weekend_occ_pct: p.weekend_occ_pct ?? null,
        open_maint_tickets: openTickets,
        urgent_maint_tickets: urgentTickets,
        maint_tickets_over_sla: maintBreaches.length,
        compliance_items_at_risk: complianceRisk.filter(c => c.severity !== 'LOW').length,
        active_iot_alerts: iotAlerts.length,
        urgent_iot_alerts: iotAlerts.filter(a => a.severity === 'urgent').length,
        reservation_risks: reservationRisks.length,
        reservation_payment_failures: reservationRisks.filter(r => r.type === 'payment_failed').length,
        front_desk_breaches: frontDeskBreaches.length,
        vip_readiness_gaps: vipReadiness.length,
        housekeeping_breaches: housekeepingBreaches.length,
        staffing_gaps: staffingGaps.length,
        open_incidents: openIncidents.length,
        escalated_incidents: openIncidents.filter(i => i.escalated).length
      };
    }

    getFinancialSummary() {
      const ota = this.getOtaExposure();
      const kpis = this.computeKpis();
      return {
        currency: 'USD',
        ota_overcharge_period: ota.period_total,
        ota_overcharge_annualized: ota.annualized_estimate,
        ota_items: ota.items,
        room_revenue: (this.property && this.property.room_revenue) || 0,
        gop_margin_pct: kpis.gop_margin_pct,
        total_exposure: ota.period_total
      };
    }

    /* ---------- Explainability: real per-record reason behind every
       flagged item across all categories. Every string below is built
       only from fields the category's own getter already computed
       (hours_over, overcharge_amount, gaps, gap_pct, etc.) -- nothing
       invented here, just cited in plain language. ---------- */

    getExplainItems() {
      const items = [];

      this.getMaintenanceBreaches().forEach(it => items.push({
        category: 'maintenance', id: it.id, severity: it.severity,
        explain: `${it.title} in ${it.room} — ${it.severity} severity, ${it.hours_over}h past SLA.`
      }));

      this.getOtaExposure().items.forEach(it => items.push({
        category: 'ota_overcharge', id: it.ota_id, severity: 'high',
        explain: `${it.ota}: charged ${it.charged_pct}% vs contracted ${it.contracted_pct}% → $${it.overcharge_amount} overcharge on a $${it.booking_amount} booking.`
      }));

      this.getComplianceRisk().forEach(it => items.push({
        category: 'compliance', id: it.id, severity: it.severity,
        explain: `${it.detail} — due in ${it.due_in_days} days.`
      }));

      this.getIotAlerts().forEach(it => items.push({
        category: 'iot', id: it.id, severity: it.severity,
        explain: it.detail
      }));

      this.getReservationRisks().forEach(it => items.push({
        category: 'reservation', id: it.id, severity: it.severity,
        explain: it.detail
      }));

      this.getFrontDeskBreaches().forEach(it => items.push({
        category: 'front_desk', id: it.id, severity: it.minutes_over > 30 ? 'high' : 'medium',
        explain: `${it.type} request for ${it.guest} in ${it.room} — waited ${it.waited_minutes}min, ${it.minutes_over}min past SLA.`
      }));

      this.getVipReadiness().forEach(it => items.push({
        category: 'vip', id: it.id, severity: it.severity,
        explain: `${it.guest} (${it.tier}) arriving in ${it.arrival_hours_away}h — ${it.gaps.join(', ')}.`
      }));

      this.getHousekeepingBreaches().forEach(it => items.push({
        category: 'housekeeping', id: it.id, severity: it.hours_over >= 4 ? 'high' : 'medium',
        explain: `${it.type} task in ${it.room} assigned to ${it.assigned_to} — ${it.hours_over}h past SLA.`
      }));

      this.getStaffingGaps().forEach(it => items.push({
        category: 'staffing', id: it.id, severity: it.severity,
        explain: `${it.department} ${it.shift} shift short ${it.gap} of ${it.required} required headcount (${it.gap_pct}% gap).`
      }));

      this.getOpenIncidents().forEach(it => items.push({
        category: 'incident', id: it.id, severity: it.severity,
        explain: `${it.type} incident in ${it.area} — reported ${it.reported_hours_ago}h ago${it.hours_over != null && it.hours_over > 0 ? `, ${it.hours_over}h past response SLA` : ''}.`
      }));

      this.getAirbnbRisks().items.forEach(it => items.push({
        category: 'airbnb', id: it.listing_id, severity: it.severity,
        explain: `${it.unit_name}: ${it.issue}`
      }));

      return items.sort((a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4));
    }

    /* ---------- AI + relay (mirrors Mortgage/NOC) ---------- */

    async runAnalysis() {
      // TSM FIX: this call was only forwarding 5 of the 12 operational
      // categories the engine actually tracks (see buildRelayPayload /
      // getExplainItems, which both treat all of these as one situation).
      // reservation_risks, front_desk_breaches, vip_readiness,
      // housekeeping_breaches, staffing_gaps, open_incidents, and
      // airbnb_risks were computed and relayed to the strategist as raw
      // data, but never reached the LLM synthesis prompt itself -- so
      // "AI OPERATIONS ANALYSIS" was silently blind to VIP arrivals,
      // staffing shortfalls, open incidents, etc. Added below; nothing
      // invented, these are the same engine getters buildRelayPayload uses.
      const res = await fetch('/api/hotelops/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kpis: this.computeKpis(),
          maintenance_breaches: this.getMaintenanceBreaches(),
          ota_exposure: this.getOtaExposure(),
          compliance_risk: this.getComplianceRisk(),
          iot_alerts: this.getIotAlerts(),
          reservation_risks: this.getReservationRisks(),
          front_desk_breaches: this.getFrontDeskBreaches(),
          vip_readiness: this.getVipReadiness(),
          housekeeping_breaches: this.getHousekeepingBreaches(),
          staffing_gaps: this.getStaffingGaps(),
          open_incidents: this.getOpenIncidents(),
          airbnb_risks: this.getAirbnbRisks()
        })
      });
      if (!res.ok) throw new Error('HotelOps analysis endpoint returned ' + res.status);
      return res.json();
    }

    buildRelayPayload(aiText) {
      return {
        vertical: 'hotelops',
        timestamp: Date.now(),
        kpis: this.computeKpis(),
        maintenance_breaches: this.getMaintenanceBreaches(),
        financials: this.getFinancialSummary(),
        compliance_risk: this.getComplianceRisk(),
        iot_alerts: this.getIotAlerts(),
        reservation_risks: this.getReservationRisks(),
        front_desk_breaches: this.getFrontDeskBreaches(),
        vip_readiness: this.getVipReadiness(),
        housekeeping_breaches: this.getHousekeepingBreaches(),
        staffing_gaps: this.getStaffingGaps(),
        open_incidents: this.getOpenIncidents(),
        airbnb_risks: this.getAirbnbRisks(),
        explain_items: this.getExplainItems(),
        records: {
          maintenance_tickets: this.data.maintenance_tickets,
          ota_charges: this.data.ota_charges,
          compliance_items: this.data.compliance_items,
          iot_sensors: this.data.iot_sensors,
          reservations: this.data.reservations,
          front_desk_queue: this.data.front_desk_queue,
          vip_arrivals: this.data.vip_arrivals,
          housekeeping_tasks: this.data.housekeeping_tasks,
          staff_shifts: this.data.staff_shifts,
          incidents: this.data.incidents,
          airbnb_listings: this.data.airbnb_listings
        },
        portfolio: this.getPortfolio(),
        ai_summary: aiText || null,
        ts: Date.now()
      };
    }

    getAirbnbRisks() {
      const listings = this.data.airbnb_listings || [];
      const items = [];
      listings.forEach(l => {
        if (l.turnover_status === 'overdue') {
          items.push({ listing_id: l.listing_id, unit_name: l.unit_name, issue: 'Turnover overdue before next check-in', severity: 'high' });
        }
        if (!l.calendar_synced) {
          items.push({ listing_id: l.listing_id, unit_name: l.unit_name, issue: `${l.platform} calendar not synced \u2014 double-booking risk`, severity: 'high' });
        }
        if (!l.lockbox_code_rotated) {
          items.push({ listing_id: l.listing_id, unit_name: l.unit_name, issue: 'Lockbox/access code not rotated since last guest', severity: 'medium' });
        }
        if (l.host_response_mins > 60) {
          items.push({ listing_id: l.listing_id, unit_name: l.unit_name, issue: `Host response time ${l.host_response_mins}min (SLA: 60min)`, severity: 'medium' });
        }
      });
      // IoT sensor-driven risks -- reuses the same real evaluation logic
      // as room-based sensors (offline / water leak / thermostat drift);
      // no new severity rules invented here.
      const listingsById = new Map(listings.map(l => [l.listing_id, l]));
      this.getIotAlerts()
        .filter(a => a.listing_id && listingsById.has(a.listing_id))
        .forEach(a => {
          const l = listingsById.get(a.listing_id);
          items.push({ listing_id: l.listing_id, unit_name: l.unit_name, issue: `${a.issue} \u2014 ${a.detail}`, severity: a.severity });
        });
      return { items, total_listings: listings.length, at_risk: items.length };
    }

    /* ---------- Portfolio (Executive Portal, multi-property) ----------
       Static per-property snapshot data lives in the model
       (portfolio array), not invented here -- this just formats it
       for the card view and flags which property is "this" one. */

    getPortfolio() {
      return this.model.portfolio || [];
    }
  }

  global.TSMHotelOpsEngine = TSMHotelOpsEngine;
})(typeof window !== 'undefined' ? window : this);
