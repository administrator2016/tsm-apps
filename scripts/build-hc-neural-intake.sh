#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
HC_DIR="$ROOT/server/healthcare"
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — BUILD"
echo "============================================================"
echo
echo "ROOT: $ROOT"
echo "STAMP: $STAMP"
echo

cd "$ROOT"

echo "=== 1. VERIFY REPOSITORY ==="

test -d .git || {
  echo "ERROR: Not a git repository."
  exit 1
}

test -f html/healthcare/hc-office-manager-doc-intake.html || {
  echo "ERROR: HC OM uploader not found."
  exit 1
}

echo "PASS: repository"
echo "PASS: HC OM uploader"

echo
echo "=== 2. VERIFY EXISTING HC OM ROUTER ==="

grep -q 'window.TSM_HC_OM_INTAKE' \
  html/healthcare/hc-office-manager-doc-intake.html

grep -q 'window.hcOmRouteDocument' \
  html/healthcare/hc-office-manager-doc-intake.html

grep -q 'window.hcOmBuildRoutingEnvelope' \
  html/healthcare/hc-office-manager-doc-intake.html

echo "PASS: TSM_HC_OM_INTAKE"
echo "PASS: hcOmRouteDocument"
echo "PASS: hcOmBuildRoutingEnvelope"

echo
echo "=== 3. CREATE HEALTHCARE DIRECTORY ==="

mkdir -p "$HC_DIR"

echo "PASS: $HC_DIR"

echo
echo "=== 4. BACKUP EXISTING CORE FILES ==="

for FILE in \
  "$HC_DIR/hc-node-contract.js" \
  "$HC_DIR/hc-node-registry.js" \
  "$HC_DIR/hc-neural-intake.js"
do
  if [ -f "$FILE" ]; then
    BACKUP="${FILE}.pre-neural-intake-${STAMP}"
    cp "$FILE" "$BACKUP"
    echo "BACKUP: $BACKUP"
  fi
done

echo
echo "=== 5. CREATE HC NODE CONTRACT ==="

cat > "$HC_DIR/hc-node-contract.js" <<'NODE'
'use strict';

/**
 * TSM Healthcare Node Contract
 *
 * Every HC specialist node receives the same canonical input
 * and returns the same canonical finding shape.
 *
 * This is intentionally transport-agnostic.
 * A node may later be implemented locally, through an API,
 * through an AI engine, or through another TSM service.
 */

const REQUIRED_INPUT_FIELDS = [
  'document',
  'extraction',
  'classification'
];

const OUTPUT_FIELDS = [
  'node',
  'relevance',
  'confidence',
  'findings',
  'risks',
  'recommendations',
  'evidence'
];

function createNodeRequest(input) {
  const source = input || {};

  return {
    document: source.document || {},
    extraction: source.extraction || {},
    classification: source.classification || {},
    routing: source.routing || {},
    context: source.context || {},
    timestamp: new Date().toISOString()
  };
}

function createNodeResult(node, data) {
  const source = data || {};

  return {
    node: String(node || ''),
    relevance: Number(source.relevance || 0),
    confidence: Number(source.confidence || 0),
    findings: Array.isArray(source.findings)
      ? source.findings
      : [],
    risks: Array.isArray(source.risks)
      ? source.risks
      : [],
    recommendations: Array.isArray(source.recommendations)
      ? source.recommendations
      : [],
    evidence: Array.isArray(source.evidence)
      ? source.evidence
      : [],
    timestamp: new Date().toISOString()
  };
}

function validateNodeRequest(request) {
  const missing = REQUIRED_INPUT_FIELDS.filter(function (field) {
    return !Object.prototype.hasOwnProperty.call(request || {}, field);
  });

  return {
    valid: missing.length === 0,
    missing: missing
  };
}

function validateNodeResult(result) {
  const missing = OUTPUT_FIELDS.filter(function (field) {
    return !Object.prototype.hasOwnProperty.call(result || {}, field);
  });

  return {
    valid: missing.length === 0,
    missing: missing
  };
}

module.exports = {
  REQUIRED_INPUT_FIELDS,
  OUTPUT_FIELDS,
  createNodeRequest,
  createNodeResult,
  validateNodeRequest,
  validateNodeResult
};
NODE

echo "PASS: hc-node-contract.js"

echo
echo "=== 6. CREATE HC NODE REGISTRY ==="

cat > "$HC_DIR/hc-node-registry.js" <<'NODE'
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
NODE

echo "PASS: hc-node-registry.js"

echo
echo "=== 7. CREATE HC NEURAL INTAKE ==="

cat > "$HC_DIR/hc-neural-intake.js" <<'NODE'
'use strict';

/**
 * TSM HC Neural Intake
 *
 * Neural front door for the Healthcare specialist network.
 *
 * Responsibilities:
 *
 *   1. Accept canonical document input.
 *   2. Preserve existing classifier decisions.
 *   3. Consume HC OM suggested routing.
 *   4. Determine candidate specialist nodes.
 *   5. Create standardized node requests.
 *   6. Collect standardized node findings.
 *   7. Correlate findings across nodes.
 *   8. Build a Strategist-ready envelope.
 *
 * IMPORTANT:
 * This module does not replace routeDocument().
 * Existing classifier routing remains authoritative.
 */

const registry = require('./hc-node-registry');
const contract = require('./hc-node-contract');

function unique(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter(Boolean)
        .map(String)
    )
  );
}

function collectCandidateNodes(input) {
  const source = input || {};
  const classification = source.classification || {};
  const routing = classification.routing || {};

  const candidates = [];

  if (Array.isArray(source.suggestedNodes)) {
    candidates.push.apply(candidates, source.suggestedNodes);
  }

  if (Array.isArray(routing.nodes)) {
    candidates.push.apply(candidates, routing.nodes);
  }

  if (Array.isArray(routing.healthcare && routing.healthcare.nodes)) {
    candidates.push.apply(
      candidates,
      routing.healthcare.nodes
    );
  }

  return unique(candidates).filter(function (node) {
    return registry.hasNode(node);
  });
}

function createIntakeEnvelope(input) {
  const source = input || {};

  const envelope = {
    platform: 'TSM',
    vertical: 'healthcare',
    intake: {
      source: source.source || 'hc-office-manager-doc-intake',
      persona: source.persona || 'Office Manager',
      timestamp: new Date().toISOString()
    },
    document: source.document || {},
    extraction: source.extraction || {},
    classification: source.classification || {},
    routing: source.routing || {},
    candidateNodes: collectCandidateNodes(source),
    nodeRequests: [],
    nodeFindings: [],
    correlations: [],
    strategist: null
  };

  envelope.nodeRequests = envelope.candidateNodes.map(function (node) {
    return {
      node: node,
      request: contract.createNodeRequest({
        document: envelope.document,
        extraction: envelope.extraction,
        classification: envelope.classification,
        routing: envelope.routing,
        context: {
          source: envelope.intake.source,
          persona: envelope.intake.persona
        }
      })
    };
  });

  return envelope;
}

function collectNodeFinding(envelope, node, result) {
  if (!registry.hasNode(node)) {
    throw new Error('Unknown HC node: ' + node);
  }

  const normalized = contract.createNodeResult(node, result);

  envelope.nodeFindings.push(normalized);

  return normalized;
}

function correlateFindings(envelope) {
  const findings = Array.isArray(envelope.nodeFindings)
    ? envelope.nodeFindings
    : [];

  const active = findings.filter(function (finding) {
    return Number(finding.relevance) > 0 ||
      finding.findings.length > 0 ||
      finding.risks.length > 0;
  });

  envelope.correlations = active.map(function (finding) {
    return {
      node: finding.node,
      relevance: finding.relevance,
      confidence: finding.confidence,
      findingCount: finding.findings.length,
      riskCount: finding.risks.length,
      evidenceCount: finding.evidence.length
    };
  });

  return envelope.correlations;
}

function buildStrategistEnvelope(envelope) {
  correlateFindings(envelope);

  envelope.strategist = {
    destination: '/html/healthcare/hc-strategist/index.html',
    mode: 'HC_CROSS_NODE_BNCA',
    persona: envelope.intake.persona,
    candidateNodes: envelope.candidateNodes,
    nodeFindings: envelope.nodeFindings,
    correlations: envelope.correlations
  };

  return envelope.strategist;
}

function intake(input) {
  const envelope = createIntakeEnvelope(input);

  return {
    envelope: envelope,
    candidateNodes: envelope.candidateNodes,
    strategist: buildStrategistEnvelope(envelope)
  };
}

module.exports = {
  intake,
  createIntakeEnvelope,
  collectCandidateNodes,
  collectNodeFinding,
  correlateFindings,
  buildStrategistEnvelope
};
NODE

echo "PASS: hc-neural-intake.js"

echo
echo "=== 8. NODE SYNTAX ==="

node --check "$HC_DIR/hc-node-contract.js"
node --check "$HC_DIR/hc-node-registry.js"
node --check "$HC_DIR/hc-neural-intake.js"

echo "PASS: all HC Neural Intake modules"

echo
echo "=== 9. REGISTRY RUNTIME TEST ==="

node - <<'NODE'
const registry = require('./server/healthcare/hc-node-registry');

const expected = [
  'billing',
  'compliance',
  'financial',
  'grants',
  'insurance',
  'legal',
  'medical',
  'operations',
  'pharmacy',
  'taxprep',
  'vendors'
];

const actual = registry.listNodes();

if (actual.length !== expected.length) {
  throw new Error(
    `Expected ${expected.length} HC nodes; found ${actual.length}`
  );
}

for (const node of expected) {
  if (!registry.hasNode(node)) {
    throw new Error(`Missing HC node: ${node}`);
  }
}

console.log('PASS: 11 HC nodes registered');
console.log(actual.join(', '));
NODE

echo
echo "=== 10. NEURAL INTAKE RUNTIME TEST ==="

node - <<'NODE'
const intake = require('./server/healthcare/hc-neural-intake');

const result = intake.intake({
  source: 'hc-office-manager-doc-intake',
  persona: 'Office Manager',

  document: {
    name: 'HIPAA_Vendor_Audit.pdf'
  },

  extraction: {
    type: 'text',
    value: 'HIPAA compliance audit involving vendor procurement'
  },

  classification: {
    verticals: ['healthcare'],
    routing: {
      healthcare: {
        nodes: ['compliance', 'vendors']
      }
    }
  }
});

console.log('Candidate nodes:');
console.log(result.candidateNodes);

if (!result.candidateNodes.includes('compliance')) {
  throw new Error('Missing compliance candidate');
}

if (!result.candidateNodes.includes('vendors')) {
  throw new Error('Missing vendors candidate');
}

if (!result.strategist) {
  throw new Error('Strategist envelope missing');
}

if (
  result.strategist.mode !== 'HC_CROSS_NODE_BNCA'
) {
  throw new Error('Incorrect strategist mode');
}

console.log('PASS: multi-node intake');
console.log('PASS: strategist envelope');
console.log('PASS: HC_CROSS_NODE_BNCA');
NODE

echo
echo "=== 11. HC OM REGRESSION CHECK ==="

grep -q 'routing.hcOmSuggested' \
  html/healthcare/hc-office-manager-doc-intake.html

grep -q 'Existing classifier routes FIRST' \
  html/healthcare/hc-office-manager-doc-intake.html

grep -q 'suggestedNodes' \
  html/healthcare/hc-office-manager-doc-intake.html

echo "PASS: HC OM advisory routing preserved"

echo
echo "=== 12. GIT DIFF CHECK ==="

git diff --check

echo "PASS: git diff --check"

echo
echo "=== 13. CREATED FILES ==="

ls -lh \
  "$HC_DIR/hc-node-contract.js" \
  "$HC_DIR/hc-node-registry.js" \
  "$HC_DIR/hc-neural-intake.js"

echo
echo "============================================================"
echo " HC NEURAL INTAKE BUILD COMPLETE"
echo "============================================================"
echo
echo "STATUS:"
echo "  ✓ HC Node Contract"
echo "  ✓ 11-node HC Registry"
echo "  ✓ HC Neural Intake"
echo "  ✓ Multi-node candidate routing"
echo "  ✓ Standardized node requests"
echo "  ✓ Standardized node findings"
echo "  ✓ Cross-node correlation foundation"
echo "  ✓ Strategist envelope"
echo "  ✓ HC OM regression protection"
echo
echo "NOT YET CONNECTED:"
echo "  → Existing uploader runtime"
echo "  → Live specialist node execution"
echo "  → BNCA execution"
echo
echo "NEXT STEP:"
echo "  ./scripts/connect-hc-neural-intake.sh"
echo
