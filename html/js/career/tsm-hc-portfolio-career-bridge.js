'use strict';

/**
 * TSM Healthcare Portfolio → Career Bridge
 *
 * Purpose:
 *   Transport an ALREADY-PRODUCED canonical Healthcare Portfolio Twin
 *   into the RCM Career Training Platform.
 *
 * Architecture:
 *
 *   Healthcare Portfolio Intelligence
 *          ↓
 *   canonical Portfolio Twin
 *          ↓
 *   this thin bridge
 *          ↓
 *   TSMHCPortfolioTwin
 *          ↓
 *   TSMRevenueLeakageCareer
 *          ↓
 *   LEAKAGE-001
 *
 * IMPORTANT:
 *   This bridge does NOT:
 *     - fetch /api/hc/portfolio-intelligence
 *     - bypass authentication
 *     - scrape DOM/KPIs
 *     - read the HonorHealth demo snapshot
 *     - infer exposure
 *     - manufacture leakage opportunities
 *
 * The producer remains responsible for creating the canonical Twin.
 */

(function (global) {
  var VERSION = '1.0.0';

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validateTwin(twin) {
    if (!isObject(twin)) {
      return {
        valid: false,
        reason: 'portfolio_twin_missing'
      };
    }

    if (!Array.isArray(twin.leakageOpportunities)) {
      return {
        valid: false,
        reason: 'leakageOpportunities_missing'
      };
    }

    return {
      valid: true,
      reason: null,
      count: twin.leakageOpportunities.length
    };
  }

  function publish(twin) {
    var validation = validateTwin(twin);

    if (!validation.valid) {
      return {
        ok: false,
        published: false,
        version: VERSION,
        reason: validation.reason,
        count: 0
      };
    }

    /*
     * Canonical browser-side handoff.
     *
     * Keep the complete Twin intact. Career consumers can inspect
     * leakageOpportunities without losing the surrounding portfolio
     * context or provenance.
     */
    global.TSMHCPortfolioTwin = twin;

    var career =
      global.TSMRevenueLeakageCareer &&
      typeof global.TSMRevenueLeakageCareer.setPortfolioTwin === 'function'
        ? global.TSMRevenueLeakageCareer
        : null;

    if (career) {
      career.setPortfolioTwin(twin);
    }

    return {
      ok: true,
      published: true,
      careerConnected: !!career,
      version: VERSION,
      count: validation.count
    };
  }

  function getPortfolioTwin() {
    return (
      global.TSMHCPortfolioTwin &&
      isObject(global.TSMHCPortfolioTwin)
    )
      ? global.TSMHCPortfolioTwin
      : null;
  }

  function getLeakageOpportunities() {
    var twin = getPortfolioTwin();

    return twin && Array.isArray(twin.leakageOpportunities)
      ? twin.leakageOpportunities.slice()
      : [];
  }

  function clear() {
    try {
      delete global.TSMHCPortfolioTwin;
    } catch (e) {
      global.TSMHCPortfolioTwin = null;
    }

    return {
      ok: true,
      cleared: true,
      version: VERSION
    };
  }

  global.TSMHealthcarePortfolioCareerBridge = {
    version: VERSION,
    publish: publish,
    getPortfolioTwin: getPortfolioTwin,
    getLeakageOpportunities: getLeakageOpportunities,
    validateTwin: validateTwin,
    clear: clear
  };
})(window);
