'use strict';

// Canonical 11 HC nodes — mirrors HC_NODE_KEYS in routes/hc.js and NODE_KEYS
// in hc-strategist/index.html. Single source of truth for intake routing so
// the three copies of this list can't drift out of sync silently.
const HC_NODES = [
  { key: 'operations', label: 'Operations',  keywords: ['intake', 'schedul', 'front desk', 'no-show', 'no show', 'staffing', 'throughput', 'check-in', 'checkin'] },
  { key: 'medical',    label: 'Medical',     keywords: ['chart', 'clinical', 'diagnos', 'progress note', 'physician', 'provider note', 'encounter'] },
  { key: 'pharmacy',   label: 'Pharmacy',    keywords: ['prescription', 'rx', 'medication', 'formulary', 'dispens', 'refill'] },
  { key: 'insurance',  label: 'Insurance',   keywords: ['prior auth', 'authorization', 'eligibility', 'payer', 'coverage', 'benefits verification'] },
  { key: 'billing',    label: 'Billing',     keywords: ['denial', 'claim', 'cpt', 'remit', 'era', 'eob', 'appeal', 'timely filing', 'co-29', 'modifier'] },
  { key: 'financial',  label: 'Financial',   keywords: ['ar aging', 'accounts receivable', 'collections', 'write-off', 'writeoff', 'payment plan', 'dso'] },
  { key: 'compliance', label: 'Compliance',  keywords: ['hipaa', 'audit', 'compliance', 'consent form', 'chart defect', 'documentation gap'] },
  { key: 'legal',      label: 'Legal',       keywords: ['subpoena', 'litigation', 'legal hold', 'contract dispute', 'malpractice'] },
  { key: 'grants',     label: 'Grants',      keywords: ['grant', 'funding award', 'grant compliance', 'grant reporting'] },
  { key: 'taxprep',    label: 'TaxPrep',     keywords: ['990', 'tax filing', 'tax exempt', 'irs'] },
  { key: 'vendors',    label: 'Vendors',     keywords: ['vendor', 'supplier', 'purchase order', 'contract renewal', 'sourcing'] },
];

const HC_NODE_KEYS = HC_NODES.map(n => n.key);

function nodeLabel(key) {
  const n = HC_NODES.find(x => x.key === key);
  return n ? n.label : key;
}

module.exports = { HC_NODES, HC_NODE_KEYS, nodeLabel };
