/**
 * TSM Delivery Package — Dependency Loader
 * --------------------------------------------------------------------------
 * tsm-delivery-package.js silently falls back to null/[] for any section
 * whose source engine isn't loaded on the page (by design — it never
 * fabricates data). This loader guarantees every optional dependency is
 * present, so pages that include TSMDeliveryPackage always get real
 * executiveSummary / recommendedActions / auditTrail instead of honest-empty
 * fallbacks.
 *
 * Usage: replace any single
 *   <script src="/html/shared/tsm-delivery-package.js"></script>
 * with just:
 *   <script src="/html/shared/tsm-delivery-package-deps.js"></script>
 *
 * This loader pulls in tsm-delivery-package.js itself plus everything it
 * optionally reads from (global.TSMExecutiveOutcome, global.TSM.evidenceLedger),
 * in the correct order, synchronously, so no page has to remember the full
 * dependency list or get the script order wrong.
 *
 * If a dependency file doesn't exist at the expected path on a given page,
 * the browser will 404 on that one script tag and log it in the console —
 * this loader doesn't swallow that, so missing files stay visible.
 * ========================================================================== */

(function () {
  'use strict';

  // Order matters: evidence-ledger and executive-outcome must load BEFORE
  // tsm-delivery-package.js, since delivery-package checks for their globals
  // at build()-call time, not at its own load time — but build() usually
  // runs from an inline <script> further down the page, so as long as all
  // three of these are loaded before that inline call, order among these
  // three doesn't actually matter. Listed here in a sensible reading order.
  var DEPENDENCIES = [
    '/html/shared/runtime/trust-evidence/evidence-ledger.js', // -> global.TSM.evidenceLedger (auditTrail)
    '/html/shared/tsm-executive-outcome.js',                  // -> global.TSMExecutiveOutcome (executiveSummary, recommendedActions)
    '/html/shared/tsm-delivery-package.js'                    // -> global.TSMDeliveryPackage (the assembler itself)
  ];

  DEPENDENCIES.forEach(function (src) {
    // document.write only works while the page is still parsing (i.e. this
    // loader must itself be included via a plain <script> tag, not deferred
    // or async) — this preserves load order exactly like hand-written
    // <script> tags would.
    document.write('<script src="' + src + '"><\/script>');
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (!window.TSMExecutiveOutcome) {
      console.warn('[tsm-delivery-package-deps] tsm-executive-outcome.js did not load — executiveSummary/recommendedActions will be empty.');
    }
    if (!(window.TSM && window.TSM.evidenceLedger)) {
      console.warn('[tsm-delivery-package-deps] evidence-ledger.js did not load or TSM.evidenceLedger is missing — auditTrail will be empty.');
    }
    if (!window.TSMDeliveryPackage) {
      console.warn('[tsm-delivery-package-deps] tsm-delivery-package.js did not load — TSMDeliveryPackage.build is unavailable.');
    }
  });
})();
