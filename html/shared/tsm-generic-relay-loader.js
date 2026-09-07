/**
 * TSM Generic Doc-Search Relay Loader
 * ------------------------------------
 * Repo-wide fix for the "College gap" pattern: tsm-doc-search-multi.html's
 * launchWarRoom()/launchWarRoomDirect() write a classified document's data
 * to a vertical's relay key (both the lowercase tsm_x_docsearch_relay key
 * and the uppercase TSM_X_..._RELAY autoKey — same payload, either key is
 * valid) before opening that vertical's War Room, but this session's
 * repo-wide audit (2026-09-07, scripts/relay-wiring-certification.js)
 * found ~19 verticals where nothing on the target page ever read either
 * key back. The button routed to the right page; the classified document
 * silently went nowhere.
 *
 * These 19 verticals are model/JSON-driven dashboards (KPIs + case tables),
 * not free-text intake forms like Construction's docPaste textarea, and —
 * unlike College's 5 domain-specific Commands — there's no shared "which
 * field does this belong to" structure to bind into generically and no
 * single reliable per-vertical binding target either. So, same choice
 * College's loader made: this does NOT attempt to guess a form field to
 * populate. It surfaces the relay payload as a visible, dismissible banner
 * (fileName / docType / client / ref / doc excerpt) so the reviewer sees
 * the classified document and can act on it manually, instead of the
 * fields silently disappearing.
 *
 * USAGE — one line per target page, no inline script needed:
 *   <script src="/shared/tsm-generic-relay-loader.js"
 *           data-relay-key="tsm_x_docsearch_relay"
 *           data-auto-key="TSM_X_..._RELAY"></script>
 * Both data-* attributes should match the `relay` / `autoKey` values for
 * that vertical in tsm-doc-search-multi.html's WAR_ROOM_ROUTES table.
 *
 * Read order mirrors Construction's/College's proven pattern (sessionStorage
 * first, then localStorage; check both the lowercase relay key and the
 * uppercase autoKey since doc-search writes both identically).
 */
(function (global) {
  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var RELAY_KEY = scriptEl.getAttribute('data-relay-key');
  var AUTO_KEY = scriptEl.getAttribute('data-auto-key');
  var RELAY_MAX_AGE_MS = 30 * 60 * 1000;
  var BANNER_ID = 'tsm-generic-relay-banner';

  function getKey(key) {
    if (!key) return null;
    try { return sessionStorage.getItem(key) || localStorage.getItem(key); } catch (e) { return null; }
  }

  function clearKey(key) {
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch (e) {}
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function readRelay() {
    var raw = getKey(RELAY_KEY) || getKey(AUTO_KEY);
    if (!raw) return null;
    var relay;
    try { relay = JSON.parse(raw); } catch (e) { return null; }
    if (!relay) return null;
    var docText = relay.docText || relay.summary || (relay.doc ? JSON.stringify(relay.doc) : '');
    if (!docText) return null;
    if (relay.timestamp && (Date.now() - relay.timestamp) > RELAY_MAX_AGE_MS) {
      dismiss();
      return null;
    }
    relay.docText = docText;
    return relay;
  }

  function dismiss() {
    clearKey(RELAY_KEY);
    clearKey(AUTO_KEY);
    var el = document.getElementById(BANNER_ID);
    if (el) el.remove();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function excerpt(text, n) {
    var t = String(text || '');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function renderBanner(relay) {
    var meta = [];
    if (relay.fileName) meta.push('<span><span style="color:#64748b">FILE</span> ' + escapeHtml(relay.fileName) + '</span>');
    if (relay.client) meta.push('<span><span style="color:#64748b">CLIENT</span> ' + escapeHtml(relay.client) + '</span>');
    if (relay.ref) meta.push('<span><span style="color:#64748b">REF</span> ' + escapeHtml(relay.ref) + '</span>');

    var html =
      '<div id="' + BANNER_ID + '" style="position:relative;margin:0 0 16px 0;border:1px solid rgba(0,212,170,.35);' +
      'border-radius:8px;background:rgba(0,212,170,.08);box-shadow:0 0 14px rgba(0,212,170,.15);' +
      'font-family:inherit;overflow:hidden;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(0,0,0,.3);">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="font-size:.6rem;font-weight:700;letter-spacing:.08em;color:#00d4aa;padding:2px 8px;border:1px solid rgba(0,212,170,.4);border-radius:4px;">DOC RELAY</span>' +
            '<span style="font-size:.72rem;font-weight:600;color:#e7e7ea;">Routed from Document Search' + (relay.docType ? ' — ' + escapeHtml(relay.docType) : '') + '</span>' +
          '</div>' +
          '<button id="' + BANNER_ID + '-dismiss" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:.85rem;">✕</button>' +
        '</div>' +
        (meta.length ? '<div style="padding:7px 14px;background:rgba(0,0,0,.15);border-bottom:1px solid rgba(255,255,255,.06);font-size:.62rem;color:#94a3b8;display:flex;flex-wrap:wrap;gap:4px 10px;">' + meta.join('') + '</div>' : '') +
        '<div style="padding:14px;">' +
          '<div style="color:#94a3b8;font-size:.6rem;letter-spacing:.1em;margin-bottom:8px;">ROUTED CONTENT</div>' +
          (relay.docText
            ? '<pre style="white-space:pre-wrap;color:#cbd5e1;font-size:.72rem;line-height:1.6;margin:0;font-family:inherit;">' + escapeHtml(excerpt(relay.docText, 600)) + '</pre>'
            : '<p style="color:#475569;font-size:.7rem;margin:0;">No document text included — check the relevant tab for this record.</p>') +
        '</div>' +
      '</div>';

    var target = document.getElementById('main') || document.body;
    var wrapper = document.createElement('div');
    wrapper.id = 'tsm-generic-relay-wrapper';
    wrapper.innerHTML = html;
    target.insertBefore(wrapper, target.firstChild);

    var dismissBtn = document.getElementById(BANNER_ID + '-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
  }

  function init() {
    if (!RELAY_KEY && !AUTO_KEY) {
      console.warn('[tsm-generic-relay-loader] missing data-relay-key/data-auto-key on its <script> tag — nothing to read.');
      return;
    }
    var relay = readRelay();
    if (!relay) return;
    renderBanner(relay);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
