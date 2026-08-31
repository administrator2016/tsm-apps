// html/healthcare/js/guide-panel-engine.js
//
// Shared "node guide" engine for the healthcare vertical pages.
//
// hc-billing, hc-insurance, hc-financial, hc-compliance, and hc-legal each
// independently implemented the same four functions (updateGuide,
// guideAction, submitStep, callAPI) with only the meta-field names, the
// vertical noun in the prompt strings, and the callAPI system prompt
// actually differing between pages. This engine holds that logic once;
// each page now just declares a small config object.
//
// hc-grants, hc-operations, and hc-pharmacy were NOT folded in here — grants
// drives its guide panel off intake-field inputs rather than TAB_CONFIG,
// and operations/pharmacy don't call the AI at all in guideAction/submitStep
// (they're click-state-only stubs with no callAPI). Forcing those into this
// shape would change their behavior, not just de-duplicate it.
//
// Usage on a page (after tsm's own <script> that defines TAB_CONFIG):
//
//   <script src="../js/guide-panel-engine.js"></script>
//   <script>
//     var currentTab = 'dash';
//     HCGuidePanel.init({
//       vertical: 'billing',
//       metaFields: [
//         { key: 'patient', label: 'Patient' },
//         { key: 'claim',   label: 'Claim' },
//         { key: 'payer',   label: 'Payer' }
//       ],
//       systemPrompt: 'You are a healthcare billing and claims expert ...',
//       actionPrompts: {
//         explain: function(stepText, cfg) { return '...'; },
//         risk:    function(stepText, cfg) { return '...'; },
//         talk:    function(stepText, cfg) { return '...'; }
//       },
//       submitPrompt: function(stepText, cfg) { return '...'; }
//     });
//   </script>
//
// init() attaches updateGuide / guideAction / submitStep / callAPI onto
// `window` so the existing inline onclick="guideAction('explain',1)"
// markup on every page keeps working unmodified.

(function (global) {
  'use strict';

  function init(config) {
    if (!config || typeof config.vertical !== 'string') {
      console.error('[HCGuidePanel] init() requires at least { vertical }');
      return;
    }

    var metaFields = config.metaFields || [];
    var stepsCompleted = { 1: false, 2: false };

    function currentCfg() {
      var tab = global.currentTab;
      var TAB_CONFIG = global.TAB_CONFIG || {};
      return TAB_CONFIG[tab] || TAB_CONFIG['dash'] || {};
    }

    // If the anomaly bridge (tsm-doc-anomaly-bridge.js) has landed a live
    // remediation checklist that targets THIS node (config.vertical matches
    // TSM_ANB.nodeId), return its steps array. Otherwise null, so callers
    // fall back to the page's own generic TAB_CONFIG steps unchanged.
    function liveAnomalySteps() {
      // A manually-applied client mission (SET MISSION FROM CLIENT DATA)
      // always wins over the auto-routed anomaly checklist. Without this,
      // resolveCfg() below silently discards whatever the operator just
      // typed into the intake form and keeps using the generic routed
      // checklist text for every AI prompt, even though the visible step
      // text (written directly to the DOM by applyIntake/rebuildStepsFromClient)
      // shows the intake data. That mismatch is what makes it look like the
      // intake form "isn't registering."
      if (global.TSM_INTAKE_APPLIED) return null;
      var anb = global.TSM_ANB;
      if (!anb || !anb.payload || !anb.nodeId) return null;
      if (anb.nodeId !== config.vertical) return null;
      var steps = anb.payload.steps;
      if (!Array.isArray(steps) || steps.length < 2) return null;
      return steps;
    }

    // Single place that decides "what are step 1 / step 2 right now" —
    // used by updateGuide, guideAction, and submitStep so all three stay
    // in sync whether or not a live checklist is active.
    function resolveCfg(baseCfg) {
      var liveSteps = liveAnomalySteps();
      if (!liveSteps) return { cfg: baseCfg, live: false };
      // Shallow-copy so we don't mutate the page's TAB_CONFIG entry.
      var cfg = {};
      for (var k in baseCfg) { if (Object.prototype.hasOwnProperty.call(baseCfg, k)) cfg[k] = baseCfg[k]; }
      cfg.steps = [liveSteps[0], liveSteps[1]];
      return { cfg: cfg, live: true };
    }

    function renderMeta(cfg) {
      return metaFields
        .map(function (f) {
          return f.label + ': <span>' + (cfg[f.key] != null ? cfg[f.key] : '') + '</span>';
        })
        .join(' &nbsp;\u00b7&nbsp; ');
    }

    function updateGuide(id) {
      var TAB_CONFIG = global.TAB_CONFIG || {};
      var baseCfg = TAB_CONFIG[id] || TAB_CONFIG['dash'] || {};
      var resolved = resolveCfg(baseCfg);
      var cfg = resolved.cfg;

      var meta = document.getElementById('guide-meta');
      if (meta) meta.innerHTML = renderMeta(cfg);

      var label = document.getElementById('guide-step-label');
      if (label) label.textContent = 'STEP 1 OF 2' + (resolved.live ? ' \u00b7 LIVE CHECKLIST' : '');

      var s1 = document.getElementById('guide-step-1-text');
      var s2 = document.getElementById('guide-step-2-text');
      if (s1 && cfg.steps) s1.textContent = 'Step 1: `' + cfg.steps[0] + '`';
      if (s2 && cfg.steps) s2.textContent = 'Step 2: `' + cfg.steps[1] + '`';

      ['guide-res-1', 'guide-res-2'].forEach(function (resId) {
        var el = document.getElementById(resId);
        if (el) {
          el.textContent = '';
          el.classList.remove('visible');
        }
      });

      var step1 = document.getElementById('guide-step-1');
      var step2 = document.getElementById('guide-step-2');
      if (step1) step1.classList.add('active-step');
      if (step2) step2.classList.remove('active-step');

      stepsCompleted[1] = false;
      stepsCompleted[2] = false;
    }

    function guideAction(type, stepNum) {
      var cfg = resolveCfg(currentCfg()).cfg;
      var stepText = cfg.steps ? cfg.steps[stepNum - 1] : '';
      var res = document.getElementById('guide-res-' + stepNum);

      var builder = config.actionPrompts && config.actionPrompts[type];
      var prompt = builder ? builder(stepText, cfg) : '';

      if (res) {
        res.classList.add('visible');
        res.innerHTML = '<span class="guide-spinner">\u27f3</span> Processing...';
      }

      callAPI(prompt)
        .then(function (reply) {
          if (res) res.textContent = reply;
        })
        .catch(function (err) {
          if (res) res.textContent = '> ERROR: ' + err.message;
        });
    }

    function submitStep(stepNum) {
      var resolved = resolveCfg(currentCfg());
      var cfg = resolved.cfg;
      var stepText = cfg.steps ? cfg.steps[stepNum - 1] : '';
      var res = document.getElementById('guide-res-' + stepNum);

      var prompt = config.submitPrompt ? config.submitPrompt(stepText, cfg) : '';

      if (res) {
        res.classList.add('visible');
        res.innerHTML = '<span class="guide-spinner">\u27f3</span> Generating response...';
      }

      var step1 = document.getElementById('guide-step-1');
      var step2 = document.getElementById('guide-step-2');
      if (step1) step1.classList.toggle('active-step', stepNum === 1);
      if (step2) step2.classList.toggle('active-step', stepNum === 2);

      var liveSuffix = resolved.live ? ' \u00b7 LIVE CHECKLIST' : '';
      var label = document.getElementById('guide-step-label');
      if (label) label.textContent = 'STEP ' + stepNum + ' OF 2' + liveSuffix;

      callAPI(prompt)
        .then(function (reply) {
          if (res) res.textContent = reply;
          stepsCompleted[stepNum] = true;
          if (stepsCompleted[1] && stepsCompleted[2]) {
            var next = document.getElementById('guide-next-actions');
            if (next) next.style.display = 'block';
            if (label) label.textContent = 'STEPS 1 & 2 COMPLETE' + liveSuffix;
          }
        })
        .catch(function (err) {
          if (res) res.textContent = '> ERROR: ' + err.message;
        });
    }

    async function callAPI(prompt) {
      var r = await fetch('/api/hc/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: config.systemPrompt || '',
          message: prompt,
          stream: false,
          max_tokens: 1000
        })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var d = await r.json();
      var reply =
        d.answer ||
        d.output ||
        d.response ||
        d.content ||
        (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) ||
        'No response';
      return (
        '> TSM NEURAL [' + new Date().toLocaleTimeString() + ']\n\n' +
        reply
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/#{1,3}\s*/g, '')
          .trim()
      );
    }

    // Expose on window so existing inline onclick="guideAction(...)" /
    // onclick="submitStep(...)" markup, and each page's own switchTab(),
    // keep calling these by their original global names.
    global.updateGuide = updateGuide;
    global.guideAction = guideAction;
    global.submitStep = submitStep;
    global.callAPI = callAPI;

    // The anomaly bridge (tsm-doc-anomaly-bridge.js) is loaded AFTER this
    // engine and sets window.TSM_ANB from its own DOMContentLoaded handler,
    // which can run after this page's own DOMContentLoaded already called
    // updateGuide() once with generic fallback text. renderBanner() fires
    // this event right after it sets TSM_ANB, so we self-correct the panel
    // the moment the live checklist actually lands — no tab switch needed.
    global.addEventListener('tsm-anomaly-ready', function () {
      updateGuide(global.currentTab);
    });

    return { updateGuide: updateGuide, guideAction: guideAction, submitStep: submitStep, callAPI: callAPI, liveAnomalySteps: liveAnomalySteps };
  }

  global.HCGuidePanel = { init: init };
})(window);
