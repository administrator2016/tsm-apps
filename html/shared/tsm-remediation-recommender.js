'use strict';

/**
 * TSM Remediation Recommender
 *
 * Purpose:
 *   Convert an application finding into a deterministic recommended
 *   next action using the shared TSM capability registry.
 *
 * Design principles:
 *   - Recommendation only; does not execute actions.
 *   - Does not call APIs.
 *   - Does not mutate application state.
 *   - Explainable output.
 *   - Safe for browser and CommonJS environments.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./tsm-app-capability-registry')
    );
  } else {
    root.TSMRemediationRecommender = factory(
      root.TSMAppCapabilityRegistry
    );
  }
})(typeof self !== 'undefined' ? self : this, function (registry) {

  if (!registry) {
    throw new Error('TSM remediation recommender requires the capability registry.');
  }

  var PRIORITY_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1
  };

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeFinding(finding) {
    finding = finding || {};

    return {
      vertical: normalize(finding.vertical),
      type: normalize(finding.type || finding.findingType || finding.category),
      severity: normalize(finding.severity || finding.priority),
      capabilityId: finding.capabilityId || finding.capability_id || null,
      action: finding.action || null,
      title: finding.title || finding.name || 'Untitled finding',
      description: finding.description || ''
    };
  }

  function severityScore(severity) {
    return PRIORITY_ORDER[normalize(severity)] || 0;
  }

  function capabilityMatches(capability, finding) {
    if (finding.capabilityId && capability.id === finding.capabilityId) {
      return true;
    }

    if (finding.action && capability.action === finding.action) {
      return true;
    }

    if (
      finding.type &&
      Array.isArray(capability.findingTypes) &&
      capability.findingTypes.indexOf(finding.type) !== -1
    ) {
      return true;
    }

    return false;
  }

  function findCandidates(finding) {
    var normalized = normalizeFinding(finding);
    var candidates = [];

    if (normalized.capabilityId) {
      var exact = registry.findById(normalized.capabilityId);
      if (exact) {
        candidates.push(exact);
        return candidates;
      }
    }

    if (normalized.action) {
      candidates = registry.findByAction(normalized.action);

      if (normalized.vertical) {
        candidates = candidates.filter(function (candidate) {
          return candidate.route === normalized.vertical;
        });
      }

      if (candidates.length) {
        return candidates;
      }
    }

    if (normalized.vertical) {
      candidates = registry.getVertical(normalized.vertical);

      if (normalized.type) {
        var typedCandidates = candidates.filter(function (candidate) {
          return capabilityMatches(candidate, normalized);
        });

        if (typedCandidates.length) {
          return typedCandidates;
        }
      }
    }

    return candidates;
  }

  function recommend(finding) {
    var normalized = normalizeFinding(finding);
    var candidates = findCandidates(normalized);

    if (!candidates.length) {
      return {
        recommended: false,
        reason: 'No registered remediation capability matches this finding.',
        finding: normalized,
        candidates: []
      };
    }

    var selected = candidates[0];

    return {
      recommended: true,
      finding: normalized,
      recommendation: {
        capabilityId: selected.id,
        label: selected.label,
        description: selected.description,
        action: selected.action,
        route: selected.route,
        priority: normalized.severity || 'medium'
      },
      explanation: buildExplanation(normalized, selected),
      candidates: candidates
    };
  }

  function buildExplanation(finding, capability) {
    var severity = finding.severity || 'medium';

    return [
      'Finding "' + finding.title + '" was classified as ' + severity + '.',
      'The registered capability "' + capability.label + '" is the closest matching next-step action.',
      'The recommender does not execute the action; the owning application remains responsible for execution and user confirmation.'
    ].join(' ');
  }

  function comparePriority(a, b) {
    return severityScore(b.severity) - severityScore(a.severity);
  }

  function rank(findings) {
    return (findings || [])
      .map(normalizeFinding)
      .sort(comparePriority)
      .map(recommend);
  }

  return {
    recommend: recommend,
    rank: rank,
    normalizeFinding: normalizeFinding
  };
});
