/**
 * TSM Exec Framework v1.0
 * --------------------------------------------------------------------------
 * Shared, reusable rendering layer for the TSM Exec Kit "explain" contract:
 *   { id, claim, confidence, severity, impact, rationale, sources, dataPoints }
 *
 * One render function, used by every vertical's strategist/executive-portal
 * page, instead of each page re-implementing its own risk register markup.
 *
 * Consumes the CSS var convention already defined in each page's :root
 * (--bg, --bg2, --cyan, --amber, --green, --red, --muted, --border, --text),
 * so it inherits the page's theme automatically — no extra vars required.
 *
 * Usage (inside an existing render() function):
 *   html += TSMExecFramework.renderRiskRegister(data.explain, { isExec: CFG.isExec });
 * ========================================================================== */

(function (global) {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  var SEVERITY_LABEL = { high: 'HIGH', med: 'MED', low: 'LOW' };
  var SEVERITY_RANK = { high: 0, med: 1, low: 2 };

  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .filter(function (it) { return it && it.claim; })
      .slice()
      .sort(function (a, b) { return (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3); });
  }

  /**
   * renderRiskRegister(items, opts)
   * items: array from engine.getExplainItems() — the raw contract shape.
   * opts.isExec: bool — expands the register (shows full rationale + data
   *   points inline) for executive portals; strategist pages get a
   *   collapsed <details> view to keep the page scannable.
   * opts.label: section header text (default "RISK REGISTER").
   * opts.emptyText: shown when there are no items.
   */
  function renderRiskRegister(items, opts) {
    opts = opts || {};
    var label = opts.label || 'RISK REGISTER';
    var norm = normalizeItems(items);

    if (!norm.length) {
      return '<div class="sec"><div class="sec-hdr">' + label + '</div>' +
        '<div class="no-items">' + (opts.emptyText || 'No explainable risk items \u2014 all clear.') + '</div></div>';
    }

    var rows = norm.map(function (it) {
      var sev = it.severity && SEVERITY_LABEL[it.severity] ? it.severity : 'med';
      var conf = (it.confidence != null) ? Math.round(it.confidence) + '%' : null;
      var sources = Array.isArray(it.sources) ? it.sources : [];
      var dataPoints = Array.isArray(it.dataPoints) ? it.dataPoints : [];

      var head =
        '<div class="risk-head">' +
          '<span class="risk-badge risk-' + sev + '">' + SEVERITY_LABEL[sev] + '</span>' +
          '<span class="risk-claim">' + escapeHtml(it.claim) + '</span>' +
          (conf ? '<span class="risk-conf">' + conf + ' conf.</span>' : '') +
        '</div>';

      var impact = it.impact ? '<div class="risk-impact">' + escapeHtml(it.impact) + '</div>' : '';

      var dp = dataPoints.length
        ? '<div class="risk-datapoints">' + dataPoints.map(function (d) {
            return '<span class="risk-dp"><span class="risk-dp-lbl">' + escapeHtml(d.label) + '</span>' +
              '<span class="risk-dp-val">' + escapeHtml(d.value) + '</span></span>';
          }).join('') + '</div>'
        : '';

      var rationale = it.rationale ? '<div class="risk-rationale">' + escapeHtml(it.rationale) + '</div>' : '';
      var src = sources.length ? '<div class="risk-sources">Source: ' + sources.map(escapeHtml).join(', ') + '</div>' : '';

      var body = impact + dp + rationale + src;

      if (opts.isExec) {
        // Executive portals: everything visible, no click required.
        return '<div class="risk-item risk-' + sev + '-item">' + head + body + '</div>';
      }
      // Strategist pages: collapsed by default, expand for the full trace.
      return '<details class="risk-item risk-' + sev + '-item"><summary>' + head + '</summary>' + body + '</details>';
    }).join('');

    return '<div class="sec"><div class="sec-hdr">' + label + ' &middot; ' + norm.length + '</div><div class="risk-register">' + rows + '</div></div>';
  }

  /**
   * stampStrategistReview(domain, data)
   * Fixes the "exec bypasses strategist" gap found across the generic
   * CFG-driven template verticals: strategist pages were reading the war
   * room's raw relay broadcast but never writing anything back, so exec
   * portals (reading that same relay key) had no way to tell a strategist
   * had actually reviewed the payload — they just displayed war room's
   * first hop directly. This re-stamps the same payload with a
   * stage:'strategist' hop + reviewedAt timestamp so a genuine second hop
   * exists in the relay event log, and exec can show a review badge.
   * Guarded by __strategistReviewed so it fires once per payload, not on
   * every render() re-run.
   */
  function stampStrategistReview(domain, data) {
    if (!data || data.__strategistReviewed) return data;
    data.reviewedAt = new Date().toISOString();
    data.__strategistReviewed = true;
    try {
      if (global.TSM && global.TSM.relay && global.TSM.relay.write) {
        global.TSM.relay.write(domain, data, { caseId: data.id, stage: 'strategist' });
      }
    } catch (e) {}
    return data;
  }

  /** renderReviewBadge(data) — shown on exec portals to confirm the strategist hop. */
  function renderReviewBadge(data) {
    if (!data || !data.reviewedAt) {
      return '<div class="meta-row"><span style="color:var(--muted)">Awaiting strategist review</span></div>';
    }
    var t;
    try { t = new Date(data.reviewedAt).toLocaleTimeString(); } catch (e) { t = data.reviewedAt; }
    return '<div class="meta-row">Strategist reviewed <span style="color:var(--green)">' + escapeHtml(String(t)) + '</span></div>';
  }

  function getPathLocal(obj, path) {
    if (!path) return obj;
    return path.split('.').reduce(function (o, k) { return (o && o[k] !== undefined) ? o[k] : undefined; }, obj);
  }

  /**
   * computeBNCA(cfg, kpiBase, explainItems)
   * Deterministic exposure projection via TSMBNCAExposureEngine, sourced
   * only from a real money-typed KPI already on the page (fmt:'money').
   * Verticals with no monetary KPI (e.g. approval, catalog, governance)
   * honestly report "unavailable" instead of fabricating a dollar figure —
   * matches the repo's anti-fabrication convention used elsewhere.
   */
  function computeBNCA(cfg, kpiBase) {
    if (!global.TSMBNCAExposureEngine) return null;
    var moneyKpi = (cfg.kpis || []).filter(function (k) { return k.fmt === 'money'; })[0];
    if (!moneyKpi) return { unavailable: true, reason: 'no monetary KPI on this vertical' };
    var baseExposure = Number(kpiBase[moneyKpi.key]);
    if (!isFinite(baseExposure) || baseExposure <= 0) {
      return { unavailable: true, reason: 'no exposure value present in this relay payload' };
    }
    var severity = 'MED', confidence = 70;
    return global.TSMBNCAExposureEngine.project({
      baseExposure: baseExposure, severity: severity, confidence: confidence, daysUntilDeadline: 0
    });
  }

  function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString(); }

  /** renderBNCA(bnca) — exposure panel, or an honest fallback message. */
  function renderBNCA(bnca) {
    if (!bnca) return '';
    if (bnca.unavailable) {
      return '<div class="sec"><div class="sec-hdr">BNCA EXPOSURE PROJECTION</div>' +
        '<div class="no-items">No monetary KPI &mdash; exposure projection unavailable.</div></div>';
    }
    return '<div class="sec"><div class="sec-hdr">BNCA EXPOSURE PROJECTION</div>' +
      '<div class="kpi-row">' +
        '<div class="kpi"><div class="kpi-val cyan">' + money(bnca.currentExposure) + '</div><div class="kpi-lbl">CURRENT EXPOSURE</div></div>' +
        '<div class="kpi"><div class="kpi-val green">' + money(bnca.ifActed.exposure) + '</div><div class="kpi-lbl">IF ACTED</div></div>' +
        '<div class="kpi"><div class="kpi-val red">' + money(bnca.ifIgnored.exposure) + '</div><div class="kpi-lbl">IF IGNORED</div></div>' +
      '</div><div class="no-items" style="margin-top:8px">' + escapeHtml(bnca.urgencyWindow || '') + '</div></div>';
  }

  /**
   * feedExceptions(sector, cfg, data)
   * Generic exception feeder for the exec portals that never pulled in
   * tsm-exceptions.js. Driven entirely by each vertical's own CFG.lists
   * data (already relayed, no fabricated fields), so it works identically
   * across every generic-template vertical without per-file wiring.
   *
   * Dedup: `key` is passed as `sourceKey` to TSMExceptions.add(), which
   * checks the persisted store itself (see findOpenBySourceKey) rather
   * than an in-memory set — so re-running this on a page reload finds the
   * same open exception instead of creating a duplicate every time.
   *
   * Case creation: every exception this feeder touches (new or an
   * already-open one returned by the sourceKey dedup) is also passed
   * through TSMCaseManager.createFromException() + requestApproval(), so
   * it becomes a real governed case. Both of those are themselves
   * dedup'd/idempotent (createFromException by exceptionId,
   * requestApproval by approval/execution status), so calling them on
   * every feed pass is safe and does not spin up duplicate cases or reset
   * an already-decided one.
   */
  function feedExceptions(sector, cfg, data) {
    if (!global.TSMExceptions || !data) return;
    (cfg.lists || []).forEach(function (l) {
      var items = getPathLocal(data, l.path);
      if (!Array.isArray(items)) return;
      items.forEach(function (it) {
        var text = (typeof it === 'string') ? it :
          (it && (it.message || it.description || it.reason || it.title || it.name));
        if (!text) return;
        var rawSeverity = String((it && (it.severity || it.priority || it.status)) || 'med');
        var key = sector + ':' + l.path + ':' + text.slice(0, 60);
        var severity = /high|crit|breach/i.test(rawSeverity) ? 'high' : (/med/i.test(rawSeverity) ? 'med' : 'low');
        try {
          var exceptionRecord = global.TSMExceptions.add({
            sourceKey: key,
            sector: sector,
            entityType: (cfg.domain || sector).toLowerCase() + '-item',
            entityId: key,
            title: text.slice(0, 140),
            severity: severity,
            source: cfg.title || cfg.domain
          });
          if (exceptionRecord && global.TSMCaseManager) {
            var caseRecord = global.TSMCaseManager.createFromException(exceptionRecord, { sector: sector });
            if (caseRecord) {
              global.TSMCaseManager.requestApproval(caseRecord.caseId, { note: 'Auto-fed from ' + (cfg.title || cfg.domain) });
            }
          }
        } catch (e) {}
      });
    });
  }

  global.TSMExecFramework = {
    renderRiskRegister: renderRiskRegister,
    normalizeItems: normalizeItems,
    stampStrategistReview: stampStrategistReview,
    renderReviewBadge: renderReviewBadge,
    computeBNCA: computeBNCA,
    renderBNCA: renderBNCA,
    feedExceptions: feedExceptions
  };

})(typeof window !== 'undefined' ? window : this);
