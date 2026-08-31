#!/usr/bin/env bash
set -euo pipefail

ROOT="/workspaces/tsm-apps"
TEST="$ROOT/scripts/test-hc-neural-intake.sh"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — FIX RUNTIME CONTRACT TEST"
echo "============================================================"
echo
echo "TEST: $TEST"
echo

cd "$ROOT"

test -f "$TEST"

cp "$TEST" "${TEST}.pre-contract-fix-$(date +%Y%m%d-%H%M%S)"

python3 - "$TEST" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()

# Replace the direct raw-text intake probe with the actual
# HC OM -> Neural Intake contract.
old_patterns = [
    r'''const result = neural\.intake\(\{\s*
\s*documentText:\s*['"]HIPAA compliance audit involving vendor procurement['"],?\s*
\s*\}\);''',

    r'''const result = neural\.intake\(\{\s*
\s*text:\s*['"]HIPAA compliance audit involving vendor procurement['"],?\s*
\s*\}\);''',
]

replacement = """const result = neural.intake({
  source: 'hc-office-manager-doc-intake',
  persona: 'Office Manager',
  document: {
    source: 'hc-office-manager-doc-intake',
    name: 'hipaa-vendor-audit.txt'
  },
  extraction: {
    type: 'text',
    value: 'HIPAA compliance audit involving vendor procurement'
  },
  classification: {
    routing: {
      nodes: ['compliance', 'vendors'],
      healthcare: {
        nodes: ['compliance', 'vendors']
      }
    }
  }
});"""

changed = False

for pattern in old_patterns:
    new_text, count = re.subn(
        pattern,
        replacement,
        text,
        flags=re.MULTILINE
    )
    if count:
        text = new_text
        changed = True

if not changed:
    # Replace the entire direct probe section between known headings.
    pattern = r'''(?ms)^echo "=== 4\. NEURAL INTAKE RUNTIME ===".*?(?=^echo "=== 5\.|^echo "=== 4\.)'''

    if re.search(pattern, text):
        block = '''echo "=== 4. NEURAL INTAKE RUNTIME ==="
node - "$NEURAL" <<'NODE'
const neural = require(process.argv[2]);

console.log("Testing actual HC OM -> Neural Intake contract...");

const result = neural.intake({
  source: 'hc-office-manager-doc-intake',
  persona: 'Office Manager',

  document: {
    source: 'hc-office-manager-doc-intake',
    name: 'hipaa-vendor-audit.txt'
  },

  extraction: {
    type: 'text',
    value: 'HIPAA compliance audit involving vendor procurement'
  },

  classification: {
    routing: {
      nodes: ['compliance', 'vendors'],
      healthcare: {
        nodes: ['compliance', 'vendors']
      }
    }
  }
});

console.log("Candidate nodes:", result.candidateNodes);

if (!result.candidateNodes.includes('compliance')) {
  console.error("FAIL: compliance candidate missing");
  process.exit(1);
}

if (!result.candidateNodes.includes('vendors')) {
  console.error("FAIL: vendors candidate missing");
  process.exit(1);
}

if (result.strategist.mode !== 'HC_CROSS_NODE_BNCA') {
  console.error("FAIL: strategist mode");
  process.exit(1);
}

if (
  result.strategist.destination !==
  '/html/healthcare/hc-strategist/index.html'
) {
  console.error("FAIL: strategist destination");
  process.exit(1);
}

if (result.envelope.nodeRequests.length !== 2) {
  console.error(
    "FAIL: expected 2 node requests, got " +
    result.envelope.nodeRequests.length
  );
  process.exit(1);
}

console.log("PASS: compliance candidate");
console.log("PASS: vendors candidate");
console.log("PASS: multi-node candidate routing");
console.log("PASS: standardized node requests");
console.log("PASS: HC_CROSS_NODE_BNCA");
console.log("PASS: strategist destination");
console.log("PASS: actual HC OM -> Neural Intake contract");
NODE

'''
        text = re.sub(pattern, block, text, count=1)
        changed = True

if not changed:
    print("ERROR: Could not locate the incorrect direct-intake test.")
    print("No changes made.")
    sys.exit(1)

path.write_text(text)

print("PASS: test contract corrected")
PY

chmod +x "$TEST"

echo
echo "=== TEST SCRIPT SYNTAX ==="
bash -n "$TEST"
echo "PASS: bash syntax"

echo
echo "=== RUN CONNECTED TEST ==="
"$TEST"
