'use strict';

/**
 * TSM Healthcare Node Registry
 *
 * Canonical registry for the HC Neural Intake specialist network.
 *
 * The registry establishes node identity and capability metadata.
 * It does not force implementation details onto individual nodes.
 */

const NODE_DEFINITIONS = {
  billing: {
    id: 'billing',
    label: 'Billing',
    domain: 'revenue-cycle',
    active: true
  },

  compliance: {
    id: 'compliance',
    label: 'Compliance',
    domain: 'regulatory',
    active: true
  },

  financial: {
    id: 'financial',
    label: 'Financial',
    domain: 'finance',
    active: true
  },

  grants: {
    id: 'grants',
    label: 'Grants',
    domain: 'funding',
    active: true
  },

  insurance: {
    id: 'insurance',
    label: 'Insurance',
    domain: 'payer',
    active: true
  },

  legal: {
    id: 'legal',
    label: 'Legal',
    domain: 'legal',
    active: true
  },

  medical: {
    id: 'medical',
    label: 'Medical',
    domain: 'clinical',
    active: true
  },

  operations: {
    id: 'operations',
    label: 'Operations',
    domain: 'operations',
    active: true
  },

  pharmacy: {
    id: 'pharmacy',
    label: 'Pharmacy',
    domain: 'pharmacy',
    active: true
  },

  taxprep: {
    id: 'taxprep',
    label: 'Tax Preparation',
    domain: 'tax',
    active: true
  },

  vendors: {
    id: 'vendors',
    label: 'Vendors',
    domain: 'procurement',
    active: true
  }
};

function listNodes() {
  return Object.keys(NODE_DEFINITIONS);
}

function getNode(nodeId) {
  return NODE_DEFINITIONS[nodeId] || null;
}

function hasNode(nodeId) {
  return Boolean(NODE_DEFINITIONS[nodeId]);
}

function getActiveNodes() {
  return listNodes().filter(function (nodeId) {
    return NODE_DEFINITIONS[nodeId].active === true;
  });
}

function validateRegistry() {
  const nodes = listNodes();

  return {
    valid: nodes.length === 11 &&
      nodes.every(function (nodeId) {
        return NODE_DEFINITIONS[nodeId].id === nodeId;
      }),
    count: nodes.length,
    nodes: nodes
  };
}

module.exports = {
  NODE_DEFINITIONS,
  listNodes,
  getNode,
  hasNode,
  getActiveNodes,
  validateRegistry
};
