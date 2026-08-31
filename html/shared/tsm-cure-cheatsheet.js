/**
 * TSM CURE CHEATSHEET  v1.0
 * Reads TSM_CURE_RELAY from localStorage, calls the vertical's API endpoint to map
 * document anomalies → target app fields, renders a draggable floating panel.
 *
 * Usage: <script src="/shared/tsm-cure-cheatsheet.js"></script>
 * Optionally set window.TSM_CURE_FIELDS before this script to pass the field schema.
 * e.g. window.TSM_CURE_FIELDS = [{id:'inv-vendor',label:'Vendor'}, ...]
 */
(function () {
  'use strict';

  const RELAY_KEY = 'TSM_CURE_RELAY';
  const STYLE_ID  = 'tsm-cure-cheatsheet-style';
  // localStorage is used (not sessionStorage) so relay survives the new-tab open

  // ── Inject CSS once ──────────────────────────────────────────────────────────
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
#tsm-cure-sheet {
  position: fixed; bottom: 24px; right: 24px; z-index: 99999;
  width: 340px; max-height: 72vh;
  background: #06091a; border: 1px solid rgba(0,229,255,0.35);
  border-radius: 4px; box-shadow: 0 0 32px rgba(0,229,255,0.12);
  display: flex; flex-direction: column; font-family: 'JetBrains Mono', monospace;
  transition: box-shadow .2s;
}
#tsm-cure-sheet.dragging { box-shadow: 0 0 48px rgba(0,229,255,0.22); }
#tsm-cure-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; background: rgba(0,229,255,0.07);
  border-bottom: 1px solid rgba(0,229,255,0.15);
  cursor: move; user-select: none; flex-shrink: 0;
}
#tsm-cure-header .cs-dot {
  width: 7px; height: 7px; border-radius: 50%; background: #00e5ff;
  box-shadow: 0 0 6px #00e5ff; flex-shrink: 0; animation: csBlink 1.8s ease-in-out infinite;
}
@keyframes csBlink { 0%,100%{opacity:1} 50%{opacity:.35} }
#tsm-cure-header .cs-title {
  font-size: 8px; letter-spacing: 1.5px; color: #00e5ff; text-transform: uppercase; flex: 1;
}
#tsm-cure-header .cs-source {
  font-size: 7px; color: #3a5a7a; letter-spacing: .5px; max-width: 120px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#tsm-cure-header .cs-dismiss {
  font-size: 10px; color: #3a5a7a; cursor: pointer; padding: 0 4px; line-height: 1;
  border: none; background: none;
}
#tsm-cure-header .cs-dismiss:hover { color: #ff3d57; }
#tsm-cure-body {
  overflow-y: auto; padding: 10px 12px; flex: 1;
}
#tsm-cure-body::-webkit-scrollbar { width: 4px; }
#tsm-cure-body::-webkit-scrollbar-track { background: transparent; }
#tsm-cure-body::-webkit-scrollbar-thumb { background: rgba(0,229,255,0.2); border-radius: 2px; }
.cs-context-row {
  font-size: 8px; color: #4a6080; line-height: 1.6; margin-bottom: 10px;
  padding-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.cs-field-row {
  display: flex; flex-direction: column; gap: 3px;
  padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
}
.cs-field-row:last-child { border-bottom: none; }
.cs-field-header { display: flex; align-items: center; justify-content: space-between; }
.cs-field-label {
  font-size: 7px; letter-spacing: 1px; color: #5a7a9a; text-transform: uppercase;
}
.cs-fill-btn {
  font-size: 7px; letter-spacing: .8px; color: #00e5ff;
  border: 1px solid rgba(0,229,255,0.3); background: rgba(0,229,255,0.06);
  padding: 2px 7px; cursor: pointer; border-radius: 2px; font-family: inherit;
  white-space: nowrap; flex-shrink: 0;
}
.cs-fill-btn:hover { background: rgba(0,229,255,0.14); }
.cs-fill-btn.filled { color: #00e676; border-color: rgba(0,230,118,0.3); background: rgba(0,230,118,0.06); }
.cs-field-value {
  font-size: 9.5px; color: #c8d8f0; line-height: 1.5;
  word-break: break-word;
}
.cs-field-reason {
  font-size: 8px; color: #3a5a70; line-height: 1.4; font-style: italic;
}
.cs-loading {
  font-size: 9px; color: #3a5a7a; padding: 20px 0; text-align: center; line-height: 2;
}
.cs-loading span { display: block; }
.cs-error { font-size: 9px; color: #ff3d57; padding: 12px 0; text-align: center; }
#tsm-cure-footer {
  padding: 8px 12px; border-top: 1px solid rgba(255,255,255,0.05);
  display: flex; gap: 8px; flex-shrink: 0;
}
.cs-fill-all-btn {
  flex: 1; font-size: 7.5px; letter-spacing: 1px; color: #00e5ff;
  border: 1px solid rgba(0,229,255,0.3); background: rgba(0,229,255,0.06);
  padding: 6px; cursor: pointer; font-family: inherit; border-radius: 2px; text-transform: uppercase;
}
.cs-fill-all-btn:hover { background: rgba(0,229,255,0.12); }
.cs-clear-btn {
  font-size: 7.5px; letter-spacing: 1px; color: #5a6f90;
  border: 1px solid rgba(255,255,255,0.08); background: transparent;
  padding: 6px 10px; cursor: pointer; font-family: inherit; border-radius: 2px; text-transform: uppercase;
}
.cs-clear-btn:hover { color: #ff3d57; border-color: rgba(255,61,87,0.3); }
.cs-relay-btn {
  flex: 1; font-size: 7.5px; letter-spacing: 1px; color: #00e676;
  border: 1px solid rgba(0,230,118,0.3); background: rgba(0,230,118,0.06);
  padding: 6px; cursor: pointer; font-family: inherit; border-radius: 2px; text-transform: uppercase;
}
.cs-relay-btn:hover { background: rgba(0,230,118,0.14); }
.cs-relay-btn:disabled { opacity: .4; cursor: default; }
.cs-relay-btn.sent { color: #00e5ff; border-color: rgba(0,229,255,0.3); background: rgba(0,229,255,0.06); }
    `;
    document.head.appendChild(s);
  }

  // ── Build field schema from DOM if not provided ───────────────────────────────
  function gatherFields() {
    if (window.TSM_CURE_FIELDS && window.TSM_CURE_FIELDS.length) return window.TSM_CURE_FIELDS;
    const seen = new Set();
    const fields = [];
    const SKIP_IDS = /groq|key|password|api|token|model|theme|tab|btn|button|toggle|nav|search|filter/i;
    const SKIP_TYPES = /password|file|hidden|submit|reset|button|checkbox|radio/i;

    // Broad selector: catches .fi, .form-input, .fi-ta, .field, textarea/input/select with id
    const candidates = document.querySelectorAll(
      'input[id], textarea[id], select[id], ' +
      'input.fi, textarea.fi-ta, select.fi, ' +
      'input.form-input, textarea.form-input, ' +
      'input.field, textarea.field, select.field'
    );
    candidates.forEach(el => {
      if (!el.id || seen.has(el.id)) return;
      if (SKIP_IDS.test(el.id)) return;
      if (SKIP_TYPES.test(el.type || '')) return;
      seen.add(el.id);
      // Label resolution: .flbl, .field-lbl, .form-label siblings, then placeholder, then id
      const fg = el.closest('.field-group, .form-group, .fi-row, .field-wrap');
      const lbl = (fg?.querySelector('.flbl, .field-lbl, .form-label, label')?.textContent?.trim())
               || el.getAttribute('placeholder')
               || el.id.replace(/[-_]/g, ' ');
      if (lbl && lbl.length < 80) {
        fields.push({ id: el.id, label: lbl, type: el.tagName.toLowerCase() });
      }
    });
    return fields;
  }

  // ── Detect the right API endpoint for this app ───────────────────────────────
  // A page can set window.TSM_CURE_ENDPOINT before loading this script to
  // override auto-detection — needed for pages whose own AI endpoint is
  // stored in a variable (e.g. const AI='/api/financial/query') rather than
  // a literal fetch('/api/...') call, which the regex below can't see, or
  // whose folder path doesn't match any vertical pattern below.
  function detectEndpoint() {
    if (window.TSM_CURE_ENDPOINT) return window.TSM_CURE_ENDPOINT;
    const url = window.location.pathname;
    const scripts = Array.from(document.querySelectorAll('script:not([src])'))
      .map(s => s.textContent).join(' ');
    const endpointMatch = scripts.match(/fetch\(['\"`](\/api\/[^'\"`?]+)/);
    if (endpointMatch) return endpointMatch[1];
    if (/\/healthcare\/|\/hc-/.test(url))     return '/api/hc/query';
    if (/\/finops-/.test(url))                return '/api/financial/query';
    if (/\/legal-|\/bpo-legal/.test(url))     return '/api/legal/query';
    if (/\/bpo\/|\/bpo-/.test(url))           return '/api/bpo/query';
    if (/\/construction/.test(url))           return '/api/construction/query';
    if (/\/insurance|\/ins-/.test(url))       return '/api/insurance/query';
    if (/\/re-|\/real-estate/.test(url))      return '/api/re/query';
    return '/api/hc/query';
  }

  // ── Detect which vertical's strategist relay key to write cure results to ───
  // A page can set window.TSM_CURE_STRATEGIST_KEY before loading this script
  // to override auto-detection — needed for pages whose folder path doesn't
  // map cleanly to one vertical (e.g. auditops-pro.html lives at html/ root
  // but should relay to Construction's strategist). Only verticals that have
  // been confirmed against a real strategist-relay reader are listed below;
  // an unrecognized page returns null and simply won't show a relay button
  // rather than guessing a key nothing reads.
  function detectStrategistRelay() {
    if (window.TSM_CURE_STRATEGIST_KEY) return window.TSM_CURE_STRATEGIST_KEY;
    const url = window.location.pathname;
    if (/\/construction/.test(url))        return 'TSM_CONSTRUCTION_STRATEGIST_RELAY';
    if (/\/finops-/.test(url))             return 'TSM_FINOPS_STRATEGIST_RELAY';
    if (/\/healthcare\/|\/hc-/.test(url))  return 'TSM_HEALTHCARE_STRATEGIST_RELAY';
    return null;
  }

  // ── Write cure results back to the strategist page, additively ──────────────
  // Merges into whatever's already at this key rather than overwriting it —
  // the real war-room→strategist relay object at this same key carries its
  // own analysis payload, and clobbering it would silently break that
  // existing flow (the exact "key/storage mismatch" bug class this project
  // has hit before). Writes to both localStorage and sessionStorage since
  // different verticals' strategist pages read from different ones.
  function relayToStrategist(relay, filledFields) {
    const key = detectStrategistRelay();
    if (!key || !filledFields.length) return false;
    const addendum = {
      cureApplied: true,
      curedAt: new Date().toISOString(),
      curedFrom: relay.appName || document.title || location.pathname,
      curedFields: filledFields.map(f => ({ id: f.id, label: f.label, value: f.value }))
    };
    [window.localStorage, window.sessionStorage].forEach(store => {
      let existing = null;
      try { existing = JSON.parse(store.getItem(key) || 'null'); } catch (e) { existing = null; }
      const merged = (existing && typeof existing === 'object' && !Array.isArray(existing))
        ? Object.assign({}, existing, addendum)
        : addendum;
      try { store.setItem(key, JSON.stringify(merged)); } catch (e) { /* storage unavailable/full — skip */ }
    });
    try { window.dispatchEvent(new CustomEvent('TSM_CURE_STRATEGIST_UPDATE', { detail: { key } })); } catch (e) {}
    return true;
  }

  // ── Build request body matching each endpoint's expected shape ───────────────
  function buildBody(endpoint, system, question) {
    if (endpoint === '/api/groq') {
      return JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: question }], max_tokens: 900 });
    }
    return JSON.stringify({ system, question, maxTokens: 900 });
  }

  // ── Call AI to map doc → fields ──────────────────────────────────────────────
  async function getFieldMappings(relay, fields) {
    const fieldList  = fields.map(f => `${f.id} — ${f.label}`).join('\n');
    const docPreview = (relay.docText || relay.documentMeta?.preview || '').slice(0, 2000);
    const anomalies  = (relay.anomalies || []).map(a => `• ${a}`).join('\n') || 'See document above.';
    const howTo      = relay.appHowTo || '';

    const system = 'You are a precise field-mapping assistant for the TSM platform. Respond only with valid JSON arrays, no markdown, no preamble.';
    const question = `You are mapping a source document to target app fields to help cure detected anomalies.

DOCUMENT (excerpt):
${docPreview}

ANOMALIES DETECTED:
${anomalies}

HOW TO USE THIS APP FOR THIS ISSUE:
${howTo}

TARGET APP FIELDS (id — label):
${fieldList}

For each field that can be populated from the document, return a JSON array.
Each object: { "id": "<field-id>", "label": "<label>", "value": "<extracted value>", "reason": "<1 sentence why this value matters for curing the anomaly>" }
Only include fields with a concrete value from the document. Return ONLY a valid JSON array.`;

    const endpoint = detectEndpoint();
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildBody(endpoint, system, question)
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    const data = await resp.json();
    const raw  = (data.answer || data.response || data.text || data.content || '').trim()
                   .replace(/^```json|^```|```$/g, '').trim();
    return JSON.parse(raw);
  }

  // ── Fill a single field ──────────────────────────────────────────────────────
  // Returns true if the field was actually filled (used to track which fields
  // have been cured, for the relay-to-strategist write-back).
  function fillField(fieldId, value, btn) {
    const el = document.getElementById(fieldId);
    if (!el) return false;
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.style.transition = 'background .4s';
    el.style.background = 'rgba(0,230,118,0.12)';
    setTimeout(() => { el.style.background = ''; }, 1200);
    if (btn) { btn.textContent = '✓ FILLED'; btn.classList.add('filled'); }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  // ── Build the panel ──────────────────────────────────────────────────────────
  function buildPanel(relay) {
    const panel = document.createElement('div');
    panel.id = 'tsm-cure-sheet';
    panel.innerHTML = `
      <div id="tsm-cure-header">
        <div class="cs-dot"></div>
        <div class="cs-title">Field Cheat Sheet</div>
        <div class="cs-source">${relay.appName || 'Relay'}</div>
        <button class="cs-dismiss" title="Dismiss" id="tsm-cure-dismiss">✕</button>
      </div>
      <div id="tsm-cure-body">
        <div class="cs-loading">
          <span>⬡ Mapping document to fields...</span>
          <span style="color:#2a3a52;font-size:8px">Analyzing anomalies + document context</span>
        </div>
      </div>
      <div id="tsm-cure-footer" style="display:none">
        <button class="cs-fill-all-btn" id="tsm-cure-fill-all">⬡ FILL ALL FIELDS</button>
        <button class="cs-clear-btn" id="tsm-cure-clear">CLEAR</button>
      </div>
    `;
    // Relay-to-strategist row is added separately (only when this vertical
    // has a known strategist relay key) so pages with no mapping don't get
    // a button that can never do anything.
    if (detectStrategistRelay()) {
      const relayRow = document.createElement('div');
      relayRow.id = 'tsm-cure-relay-row';
      relayRow.style.cssText = 'padding:0 12px 8px;flex-shrink:0;display:none';
      relayRow.innerHTML = '<button class="cs-relay-btn" id="tsm-cure-relay" disabled>⚡ RELAY TO STRATEGIST</button>';
      panel.appendChild(relayRow);
    }
    document.body.appendChild(panel);

    panel.querySelector('#tsm-cure-dismiss').onclick = () => {
      panel.remove();
      localStorage.removeItem(RELAY_KEY);
    };

    makeDraggable(panel, panel.querySelector('#tsm-cure-header'));
    return panel;
  }

  function renderMappings(panel, relay, mappings) {
    const body   = panel.querySelector('#tsm-cure-body');
    const footer = panel.querySelector('#tsm-cure-footer');
    const relayRow = panel.querySelector('#tsm-cure-relay-row');
    const relayBtn = panel.querySelector('#tsm-cure-relay');
    const curedFields = []; // tracks fields actually filled, for relay-to-strategist

    if (!mappings.length) {
      body.innerHTML = '<div class="cs-error">No field matches found in this document for the current page.</div>';
      return;
    }

    const preview = (relay.docText || (relay.documentMeta && relay.documentMeta.preview) || '').slice(0, 140);
    body.innerHTML = preview
      ? '<div class="cs-context-row">' + preview.replace(/</g, '&lt;') + (preview.length >= 140 ? '…' : '') + '</div>'
      : '';

    function updateRelayButtonState() {
      if (!relayBtn) return;
      relayRow.style.display = curedFields.length ? 'block' : 'none';
      relayBtn.disabled = !curedFields.length;
    }

    mappings.forEach(m => {
      const row = document.createElement('div');
      row.className = 'cs-field-row';
      row.innerHTML =
        '<div class="cs-field-header">' +
          '<div class="cs-field-label">' + (m.label || m.id) + '</div>' +
          '<button class="cs-fill-btn">FILL</button>' +
        '</div>' +
        '<div class="cs-field-value">' + String(m.value || '').replace(/</g, '&lt;') + '</div>' +
        (m.reason ? '<div class="cs-field-reason">' + m.reason.replace(/</g, '&lt;') + '</div>' : '');
      const btn = row.querySelector('.cs-fill-btn');
      btn.onclick = () => {
        if (fillField(m.id, m.value, btn)) {
          curedFields.push(m);
          updateRelayButtonState();
        }
      };
      body.appendChild(row);
    });

    footer.style.display = 'flex';
    panel.querySelector('#tsm-cure-fill-all').onclick = () => {
      body.querySelectorAll('.cs-fill-btn:not(.filled)').forEach(btn => btn.click());
    };
    panel.querySelector('#tsm-cure-clear').onclick = () => {
      panel.remove();
      localStorage.removeItem(RELAY_KEY);
    };

    if (relayBtn) {
      relayBtn.onclick = () => {
        if (relayToStrategist(relay, curedFields)) {
          relayBtn.textContent = '✓ RELAYED';
          relayBtn.classList.add('sent');
          setTimeout(() => {
            relayBtn.textContent = '⚡ RELAY TO STRATEGIST';
            relayBtn.classList.remove('sent');
          }, 2200);
        }
      };
    }
  }

  // ── Make a panel draggable by its header ─────────────────────────────────────
  function makeDraggable(panel, handle) {
    let dragging = false, offsetX = 0, offsetY = 0;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      panel.classList.add('dragging');
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.top  = (e.clientY - offsetY) + 'px';
    });
    document.addEventListener('mouseup', () => {
      dragging = false;
      panel.classList.remove('dragging');
    });
  }

  // ── Entry point ─────────────────────────────────────────────────────────────
  async function init() {
    let relay;
    try {
      relay = JSON.parse(localStorage.getItem(RELAY_KEY) || 'null');
    } catch (e) {
      relay = null;
    }
    if (!relay) return;

    injectStyle();
    const panel  = buildPanel(relay);
    const fields = gatherFields();

    if (!fields.length) {
      renderMappings(panel, relay, []);
      return;
    }

    try {
      const mappings = await getFieldMappings(relay, fields);
      renderMappings(panel, relay, Array.isArray(mappings) ? mappings : []);
    } catch (e) {
      panel.querySelector('#tsm-cure-body').innerHTML =
        '<div class="cs-error">Could not map fields: ' + String(e.message || 'unknown error').replace(/</g, '&lt;') + '</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
