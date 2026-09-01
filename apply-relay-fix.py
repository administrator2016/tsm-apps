#!/usr/bin/env python3
"""
Applies the relay-in fix directly to html/finops-suite/finops-accounting.html.
Run from the repo root: python3 apply-relay-fix.py
Safe to re-run: exits with a clear error (not a partial edit) if a target
string isn't found, e.g. because it's already been applied.
"""
import sys

PATH = "html/finops-suite/finops-accounting.html"

EDITS = [
    (
        """let groqKey = localStorage.getItem('finops_groq_key') || '';
let groqModel = localStorage.getItem('finops_groq_model') || 'openai/gpt-oss-120b';
let currentDoc = 'invoice';
let outputs = {1:'',2:'',3:'',4:''};

// \u2500\u2500 INIT \u2500\u2500
if (groqKey) setKeyStatus(true);
checkRelayIn();""",
        """let groqKey = localStorage.getItem('finops_groq_key') || '';
let groqModel = localStorage.getItem('finops_groq_model') || 'openai/gpt-oss-120b';
let currentDoc = 'invoice';
let outputs = {1:'',2:'',3:'',4:''};
let relayedDocText = null; // set by checkRelayIn() when a War Room doc is waiting; consumed once by fireAll()

// \u2500\u2500 INIT \u2500\u2500
if (groqKey) setKeyStatus(true);
// TSM_KERNEL (from /core/tsm-kernel.js) isn't loaded until further down the
// page, after this script block \u2014 calling checkRelayIn() synchronously here
// would hit "TSM_KERNEL is undefined". Defer it to window 'load', by which
// point every script tag (including the kernel) has run.
window.addEventListener('load', checkRelayIn);"""
    ),
    (
        """// \u2500\u2500 RELAY CHECK \u2500\u2500
function checkRelayIn() {
  try {
    const r = JSON.parse(localStorage.getItem('tsm_remediation_relay') || 'null');
    if (!r || !r.doc) return;
    const age = (Date.now() - r.timestamp) / 1000 / 60;
    if (age > 60) return;
    document.getElementById('relay-banner').classList.add('show');
    document.getElementById('relay-banner-txt').textContent =
      `Doc received from ${r.appName || 'War Room'} \u00b7 ${r.docType?.toUpperCase() || 'DOCUMENT'} \u00b7 ${Math.round(age)}m ago`;
  } catch(e) {}
}
""",
        """// \u2500\u2500 RELAY CHECK \u2500\u2500
// The War Room hands off documents through TSM_KERNEL.setRelay('finops-suite', ...)
// (localStorage key tsm_war_relay_finops-suite), not through tsm_remediation_relay.
// That other key is this page's own OUTGOING relay \u2014 fireAll() below writes
// it after processing, for the Strategist to read. Reading it here meant this
// page was picking up its own prior run and displaying itself as the sender
// ("Doc received from FinOps Accounting"), while never actually loading any
// data \u2014 hence the banner claiming a doc arrived while every engine still
// showed "AWAITING DOCUMENT" and the fire button still asked to fill fields.
const WAR_ROOM_DOC_TYPE_MAP = {
  'AP Aging': 'invoice', 'Vendor Report': 'invoice',
  'AR Aging': 'ar',
  'Bank Recon': 'bankrec',
  'Budget Variance': 'pl'
  // GL Extract, Tax / 1099, and ERA Batch have no matching form here \u2014
  // left unmapped so the currently-selected doc type is left as-is.
};
function checkRelayIn() {
  if (typeof TSM_KERNEL === 'undefined') return; // kernel script failed to load \u2014 skip gracefully
  try {
    const relay = TSM_KERNEL.getRelay('finops-suite');
    if (!relay || !relay.p) return;
    const p = JSON.parse(relay.p);
    if (!p.docText) return;
    const age = (Date.now() - (relay.ts || p.timestamp || 0)) / 1000 / 60;
    if (age > 60) return;

    relayedDocText = p.docText;
    const mappedType = WAR_ROOM_DOC_TYPE_MAP[p.selectedDocType];
    if (mappedType && FORMS[mappedType] && mappedType !== currentDoc) {
      const btn = Array.from(document.querySelectorAll('.doc-btn'))
        .find(b => b.getAttribute('onclick') === `setDoc('${mappedType}',this)`);
      setDoc(mappedType, btn);
    }

    document.getElementById('relay-banner').classList.add('show');
    document.getElementById('relay-banner-txt').textContent =
      `Doc received from War Room \u00b7 ${p.selectedDocType || 'DOCUMENT'} \u00b7 ${Math.round(age)}m ago`;
    document.getElementById('fire-status').textContent = 'RELAYED DOC READY \u2014 FIRE WHEN READY';
  } catch(e) {}
}

"""
    ),
    (
        """async function fireAll(){
  const docText=serializeDoc();
  outputs={1:'',2:'',3:'',4:''};""",
        """async function fireAll(){
  // A War Room relay takes priority on the run that consumes it (it's the
  // real analyzed document text); after that, revert to whatever's in the
  // on-screen form so subsequent manual edits are respected.
  const docText = relayedDocText || serializeDoc();
  relayedDocText = null;
  outputs={1:'',2:'',3:'',4:''};"""
    ),
]

def main():
    with open(PATH, "r", encoding="utf-8") as f:
        content = f.read()

    for i, (old, new) in enumerate(EDITS, 1):
        count = content.count(old)
        if count == 0:
            print(f"EDIT {i}: target text not found \u2014 aborting with NO changes written.")
            print("This usually means the file doesn't match the expected pre-fix state.")
            print("First 200 chars of what we searched for:")
            print(old[:200])
            sys.exit(1)
        if count > 1:
            print(f"EDIT {i}: target text found {count} times (expected exactly 1) \u2014 aborting.")
            sys.exit(1)
        content = content.replace(old, new)
        print(f"EDIT {i}: applied.")

    with open(PATH, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"\nAll edits applied successfully to {PATH}")

if __name__ == "__main__":
    main()
