/**
 * TSM College Doc-Search Relay Loader
 * ------------------------------------
 * Fixes the gap documented in document-processing-revenue-recovery-manual.html:
 * tsm-doc-search-multi.html writes TSM_COLLEGE_WAR_RELAY before opening any
 * College page, but none of the 5 College Command pages (nor the Strategist)
 * ever read it back — the button routes correctly but the page opens empty.
 *
 * IMPORTANT: College Command pages are model/JSON-driven dashboards (KPIs +
 * case tables from college-*-model.json), NOT free-text intake forms like
 * Construction's docPaste textarea. There is no single <input> to bind a
 * classified document into, and no field-ID mapping would be safe to guess
 * at generically. So this loader does NOT attempt Construction's
 * Object.entries()-into-<input> approach — it surfaces the relay payload as
 * a visible, dismissible banner (fileName / docType / client / ref / doc
 * excerpt) so the reviewer sees the classified document and can act on it,
 * instead of the fields silently disappearing.
 *
 * Read order mirrors Construction's proven pattern (sessionStorage first,
 * then localStorage) even though today only localStorage is ever written
 * (tsm-doc-search-multi.html's launchWarRoom()), so this keeps working if a
 * future write path adds a sessionStorage leg.
 *
 * Per the College architecture (5 domain Commands + a combined Strategist
 * view), the relay key is intentionally NOT removed after read — a reviewer
 * may open more than one College Command page against the same classified
 * document during one session. It clears only on explicit dismiss, or once
 * it is older than RELAY_MAX_AGE_MS.
 */
(function (global) {
  const RELAY_KEY = 'TSM_COLLEGE_WAR_RELAY';
  const RELAY_MAX_AGE_MS = 30 * 60 * 1000; // 30 min — stale relay, don't resurrect it forever

  function readRelay() {
    let raw = null;
    try { raw = sessionStorage.getItem(RELAY_KEY) || localStorage.getItem(RELAY_KEY); } catch (e) { /* noop */ }
    if (!raw) return null;
    let relay;
    try { relay = JSON.parse(raw); } catch (e) { return null; }
    if (!relay || !relay.docText) return null;
    if (relay.timestamp && (Date.now() - relay.timestamp) > RELAY_MAX_AGE_MS) {
      dismiss();
      return null;
    }
    return relay;
  }

  function dismiss() {
    try { sessionStorage.removeItem(RELAY_KEY); } catch (e) { /* noop */ }
    try { localStorage.removeItem(RELAY_KEY); } catch (e) { /* noop */ }
    const el = document.getElementById('tsm-college-relay-banner');
    if (el) el.remove();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function excerpt(text, n) {
    const t = String(text || '');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function renderBanner(relay) {
    if (document.getElementById('tsm-college-relay-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'tsm-college-relay-banner';
    banner.style.cssText = 'position:sticky;top:0;left:0;right:0;z-index:9999;background:rgba(77,163,255,.12);border-bottom:1px solid rgba(77,163,255,.35);padding:10px 20px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:12.5px;color:#4da3ff;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;';
    banner.innerHTML =
      '<div>' +
        '<div style="font-weight:700;letter-spacing:.3px;margin-bottom:3px;">⚡ INCOMING DOCUMENT — ' + escapeHtml(relay.docType || 'DOCUMENT') + '</div>' +
        '<div style="color:#c9d6e3;">' +
          (relay.fileName ? '<b>File:</b> ' + escapeHtml(relay.fileName) + '&nbsp;&nbsp;' : '') +
          (relay.client ? '<b>Client:</b> ' + escapeHtml(relay.client) + '&nbsp;&nbsp;' : '') +
          (relay.ref ? '<b>Ref:</b> ' + escapeHtml(relay.ref) : '') +
        '</div>' +
        '<div style="color:#8ea0b5;margin-top:4px;white-space:pre-wrap;max-width:900px;">' + escapeHtml(excerpt(relay.docText, 400)) + '</div>' +
        '<div style="color:#8ea0b5;margin-top:4px;font-size:11px;">Relayed from Doc Search — routed to the correct sub-domain, but this page does not auto-fill cases from free text. Use these details to locate or open the matching case above, or dismiss once reviewed.</div>' +
      '</div>' +
      '<button id="tsm-college-relay-dismiss" style="background:none;border:1px solid rgba(77,163,255,.4);color:#4da3ff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;white-space:nowrap;">Dismiss</button>';
    document.body.prepend(banner);
    document.getElementById('tsm-college-relay-dismiss').addEventListener('click', dismiss);
  }

  function init() {
    const relay = readRelay();
    if (!relay) return;
    renderBanner(relay);
    try {
      window.dispatchEvent(new CustomEvent('TSM_COLLEGE_DOC_RELAY_LOADED', { detail: relay }));
    } catch (e) { /* noop */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.TSMCollegeRelayLoader = { readRelay, dismiss };
})(window);
