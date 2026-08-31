// /shared/tsm-relay-populate.js
//
// Reads TSM_CURE_RELAY -- the relay key every war room's launchApp() actually
// writes (Construction, Legal, Insurance, RE, FinOps itself) -- and auto-fills
// the destination app's form fields from the relayed document text.
//
// Previously this listened for 'tsm_finops_war_relay' / 'TSM_FINOPS_WAR_RELAY',
// keys nothing in the codebase ever wrote, so it never fired for any vertical.
(function(){
  const raw = localStorage.getItem('TSM_CURE_RELAY');
  if (!raw) return;

  let relay;
  try { relay = JSON.parse(raw); } catch(e) { return; }
  if (!relay.docText) return;

  // Stale relay guard -- same 60-minute convention used elsewhere in this codebase.
  const ageMin = (Date.now() - (relay.timestamp || 0)) / 1000 / 60;
  if (ageMin > 60) return;

  const docText = relay.docText;

  const extract = (label) => {
    const m = docText.match(new RegExp('(?:' + label + ')\\s*:?\\s*([^\\n.]+)', 'im'));
    return m ? m[1].trim().slice(0, 120) : '';
  };

  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:32px;left:0;right:0;z-index:9000;background:rgba(0,180,100,.12);border-bottom:1px solid rgba(0,180,100,.3);padding:8px 20px;font-family:"Share Tech Mono",monospace;font-size:10px;color:#00d4aa;letter-spacing:1px;display:flex;justify-content:space-between;align-items:center;';
  banner.innerHTML = '<span>\u26a1 ' + (relay.vertical||'WAR ROOM') + ' RELAY ACTIVE \u2014 ' + (relay.docType||'Document') + ' \u00b7 populating...</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#00d4aa;cursor:pointer;">\u2715</button>';
  document.body.prepend(banner);

  // -- PER-PAGE CONFIG --------------------------------
  const path = window.location.pathname;

  const PAGE_CONFIG = {
    'finops-accounting.html': {
      docTypeMap: { 'AP Aging':'AP Invoice','GL Extract':'Journal Entry','Bank Recon':'Bank Recon','Invoice Audit':'AP Invoice','Budget Var.':'PnL','ERA Batch':'AR Invoice','Cash Flow':'PnL','Vendor Rpt':'AP Invoice','Tax / 1099':'Month-End Close' },
      fields: {
        invoiceNum: { selector: '#inv-num', extract: 'INVOICE\\s*#?|INVOICE NUMBER' },
        poNum:      { selector: '#inv-po, input[placeholder*="PO-"]', extract: 'PO\\s*#?|PURCHASE ORDER' },
        vendor:     { selector: '#inv-vendor, input[placeholder*="Vendor name"]', extract: 'VENDOR|KEY PARTIES|VENDOR NAME|PAYER|PAYEE|PARTIES' },
      },
      notesSelector: '#inv-notes, .textarea-field, textarea',
      fireBtnText: ['PROCESS DOCUMENT','FIRE ALL 4 ENGINES'],
    },
    'finops-operations.html': {
      docTypeMap: {},
      fields: {
        vendor:     { selector: '#inv-vendor, input[placeholder*="Vendor name"]', extract: 'VENDOR|KEY PARTIES|VENDOR NAME|PAYER|PAYEE' },
      },
      notesSelector: '#op-notes, textarea',
      fireBtnText: ['PROCESS','FIRE ALL'],
    },
    'financial-ui.html': {
      docTypeMap: {},
      fields: {},
      notesSelector: 'textarea',
      fireBtnText: ['PROCESS','FIRE ALL'],
    },
  };

  const pageKey = Object.keys(PAGE_CONFIG).find(k => path.endsWith(k));
  const cfg = pageKey ? PAGE_CONFIG[pageKey] : null;
  if (!cfg) { banner.remove(); return; }

  if (cfg.docTypeMap) {
    const targetLabel = cfg.docTypeMap[relay.docType] || Object.values(cfg.docTypeMap)[0];
    if (targetLabel) {
      const tabBtn = [...document.querySelectorAll('button, [role="button"], .doc-type-btn')]
        .find(b => b.textContent.trim().toUpperCase() === targetLabel.toUpperCase());
      if (tabBtn) tabBtn.click();
    }
  }

  setTimeout(() => {
    Object.values(cfg.fields).forEach(f => {
      const el = document.querySelector(f.selector);
      const val = extract(f.extract);
      if (el && val) el.value = val;
    });

    const notes = document.querySelector(cfg.notesSelector);
    if (notes) {
      notes.value = '[' + (relay.vertical||'WAR ROOM').toUpperCase() + ' RELAY \u2014 ' + (relay.docType||'Document') + ']\n\n' + docText.slice(0, 1500);
    }

    banner.querySelector('span').textContent = '\u26a1 ' + (relay.vertical||'WAR ROOM') + ' RELAY ACTIVE \u2014 ' + (relay.docType||'Document') + ' \u00b7 fields populated \u00b7 click PROCESS to run';

    setTimeout(() => {
      const fireBtn = [...document.querySelectorAll('button')]
        .find(b => cfg.fireBtnText.some(t => b.textContent.includes(t)));
      // Auto-fire disabled -- user must click manually
      // if (fireBtn && !fireBtn.disabled) fireBtn.click();
    }, 2000);
  }, 400);
})();
