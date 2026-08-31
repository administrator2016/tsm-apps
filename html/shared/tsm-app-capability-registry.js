'use strict';

/**
 * TSM Application Capability Registry
 *
 * Purpose:
 *   Provide a canonical, lightweight registry describing what each
 *   TSM application can do.
 *
 * Design:
 *   - Browser-safe / CommonJS-safe UMD-style export.
 *   - No application page dependencies.
 *   - No network calls.
 *   - No mutation of application state.
 *   - Safe to load before individual vertical applications.
 *
 * The Intelligent Guide can use this registry to determine:
 *   1. What capability is relevant to a finding.
 *   2. Which application owns that capability.
 *   3. Which action the user can take next.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TSMAppCapabilityRegistry = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  var REGISTRY_VERSION = '1.0.0';

  var CAPABILITIES = {
    insurance: [
      {
        id: 'insurance.bnca.operations',
        label: 'Review Insurance Operations',
        description: 'Review the Insurance Command operations analysis and identify the highest-priority operational issue and immediate owner actions.',
        action: 'review-operations',
        route: 'insurance',
        findingTypes: ['operations', 'operational', 'claims', 'agent', 'quote', 'underwriting', 'compliance', 'revenue']
      },
      {
        id: 'insurance.document.analysis',
        label: 'Analyze Insurance Documents',
        description: 'Analyze insurance documents for findings, anomalies, missing information, and recovery opportunities.',
        action: 'analyze-document',
        route: 'insurance',
        findingTypes: ['document', 'document-analysis', 'missing-information']
      },
      {
        id: 'insurance.anomaly.review',
        label: 'Review Insurance Anomaly',
        description: 'Review an insurance anomaly and determine whether additional investigation or remediation is required.',
        action: 'review-anomaly',
        route: 'insurance',
        findingTypes: ['anomaly', 'anomalies', 'exception', 'finding']
      },
      {
        id: 'insurance.remediation',
        label: 'Start Insurance Remediation',
        description: 'Move an identified insurance finding into a remediation workflow.',
        action: 'start-remediation',
        route: 'insurance',
        findingTypes: ['remediation', 'recovery', 'unresolved']
      }
    ],

    healthcare: [
      {
        id: 'healthcare.denial.analysis',
        label: 'Analyze Healthcare Denial',
        description: 'Analyze a denial, identify likely causes, and determine recovery actions.',
        action: 'analyze-denial',
        route: 'healthcare'
      }
    ],

    construction: [
      {
        id: 'construction.exception.analysis',
        label: 'Analyze Construction Exception',
        description: 'Analyze construction workflow exceptions and identify the next operational action.',
        action: 'analyze-exception',
        route: 'construction'
      }
    ],

    mortgage: [
      {
        id: 'mortgage.exception.analysis',
        label: 'Analyze Mortgage Exception',
        description: 'Analyze mortgage workflow exceptions and identify the appropriate remediation path.',
        action: 'analyze-exception',
        route: 'mortgage'
      }
    ],

    real_estate: [
      {
        id: 'real-estate.exception.analysis',
        label: 'Analyze Real Estate Exception',
        description: 'Analyze real estate workflow exceptions and identify the appropriate remediation path.',
        action: 'analyze-exception',
        route: 'real-estate'
      }
    ],

    bpo: [
      {
        id: 'bpo.case.analysis',
        label: 'Analyze BPO Case',
        description: 'Analyze a BPO case and determine the next operational action.',
        action: 'analyze-case',
        route: 'bpo'
      }
    ]
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getVertical(vertical) {
    if (!vertical) return [];
    return clone(CAPABILITIES[String(vertical).toLowerCase()] || []);
  }

  function getAll() {
    return clone(CAPABILITIES);
  }

  function findById(capabilityId) {
    if (!capabilityId) return null;

    var verticals = Object.keys(CAPABILITIES);

    for (var i = 0; i < verticals.length; i += 1) {
      var capabilities = CAPABILITIES[verticals[i]];

      for (var j = 0; j < capabilities.length; j += 1) {
        if (capabilities[j].id === capabilityId) {
          return clone(capabilities[j]);
        }
      }
    }

    return null;
  }

  function findByAction(action) {
    if (!action) return [];

    var matches = [];
    var verticals = Object.keys(CAPABILITIES);

    for (var i = 0; i < verticals.length; i += 1) {
      var vertical = verticals[i];
      var capabilities = CAPABILITIES[vertical];

      for (var j = 0; j < capabilities.length; j += 1) {
        if (capabilities[j].action === action) {
          var item = clone(capabilities[j]);
          item.vertical = vertical;
          matches.push(item);
        }
      }
    }

    return matches;
  }

  return {
    version: REGISTRY_VERSION,
    capabilities: getAll,
    getVertical: getVertical,
    findById: findById,
    findByAction: findByAction
  };
});
