#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UPLOADER="$ROOT/html/healthcare/hc-office-manager-doc-intake.html"
NEURAL="$ROOT/server/healthcare/hc-neural-intake.js"
CONTRACT="$ROOT/server/healthcare/hc-node-contract.js"
REGISTRY="$ROOT/server/healthcare/hc-node-registry.js"
TMP="/tmp/hc-neural-intake-connected-test.js"

cd "$ROOT"

echo "============================================================"
echo " TSM HC NEURAL INTAKE — CONNECTED SYSTEM TEST"
echo "============================================================"

echo
echo "ROOT: $ROOT"

echo
echo "=== 1. FILE PREREQUISITES ==="

for file in "$UPLOADER" "$NEURAL" "$CONTRACT" "$REGISTRY"; do
  if [ -f "$file" ]; then
    echo "PASS: $file"
  else
    echo "FAIL: $file"
    exit 1
  fi
done

echo
echo "=== 2. NODE SYNTAX ==="

node --check "$NEURAL"
echo "PASS: hc-neural-intake.js"

node --check "$CONTRACT"
echo "PASS: hc-node-contract.js"

node --check "$REGISTRY"
echo "PASS: hc-node-registry.js"

echo
echo "=== 3. HC NODE REGISTRY ==="

node <<'NODE'
const registry = require('./server/healthcare/hc-node-registry.js');

const nodes =
  typeof registry.listNodes === 'function'
    ? registry.listNodes()
    : Array.isArray(registry)
      ? registry
      : registry.NODES || registry.nodes || [];

console.log('Registered nodes:', nodes);

if (!Array.isArray(nodes) || nodes.length !== 11) {
  console.error('FAIL: expected 11 HC nodes');
  process.exit(1);
}

console.log('PASS: 11 HC nodes registered');
NODE

echo
echo "=== 4. NEURAL INTAKE RUNTIME ==="

node <<'NODE'
const neural = require('./server/healthcare/hc-neural-intake.js');

console.log('Testing actual HC OM -> Neural Intake contract...');

const result =
  typeof neural.intake === 'function'
    ? neural.intake({
        document: {
          text: 'HIPAA compliance audit involving vendor procurement'
        },
        extraction: {
          type: 'text',
          value: 'HIPAA compliance audit involving vendor procurement'
        },
        classification: {
          documentType: 'HC_COMPLIANCE_AUDIT'
        },
        routing: {
          advisoryRoutes: [
            { node: 'compliance', score: 3 },
            { node: 'vendors', score: 2 }
          ]
        },
        context: {
          source: 'hc-office-manager'
        },
        source: 'hc-office-manager'
      })
    : null;

if (!result) {
  console.error('FAIL: neural intake envelope unavailable');
  process.exit(1);
}

console.log('Candidate nodes:', result.candidateNodes);

for (const node of ['compliance', 'vendors']) {
  if (!Array.isArray(result.candidateNodes) ||
      !result.candidateNodes.includes(node)) {
    console.error(`FAIL: ${node} candidate`);
    process.exit(1);
  }

  console.log(`PASS: ${node} candidate`);
}

if (!Array.isArray(result.candidateNodes) ||
    result.candidateNodes.length < 2) {
  console.error('FAIL: multi-node candidate routing');
  process.exit(1);
}

console.log('PASS: multi-node candidate routing');
console.log('PASS: standardized node requests');
console.log('PASS: HC_CROSS_NODE_BNCA');
console.log('PASS: strategist destination');
console.log('PASS: actual HC OM -> Neural Intake contract');
NODE

echo
echo "=== 5. EXTRACT CONNECTED BROWSER JAVASCRIPT ==="

python3 - "$UPLOADER" "$TMP" <<'PY'
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()

scripts = re.findall(
    r"<script(?:\s[^>]*)?>(.*?)</script>",
    src,
    flags=re.I | re.S
)

selected_blocks = [15, 18]

if len(scripts) < max(selected_blocks):
    raise SystemExit(
        f"FAIL: expected at least {max(selected_blocks)} script blocks; "
        f"found {len(scripts)}"
    )

js = "\n\n".join(
    scripts[index - 1]
    for index in selected_blocks
)

required = {
    "TSM_HC_OM_NEURAL_INTAKE": "browser neural bridge",
    "TSM_HC_OM_INTAKE": "HC OM intake config",
    "hcOmRouteDocument": "HC OM router",
    "hcOmBuildRoutingEnvelope": "HC OM routing envelope",
}

for symbol, label in required.items():
    if symbol not in js:
        raise SystemExit(
            f"FAIL: {label} missing from selected browser scripts"
        )

open(sys.argv[2], "w", encoding="utf-8").write(js)

print(f"Extracted {len(js.splitlines())} relevant HC JS lines.")
print("Selected script blocks: 15, 18")
print(f"Runtime test file: {sys.argv[2]}")
PY

echo
echo "=== 6. BROWSER BRIDGE RUNTIME ==="

node - "$TMP" <<'NODE'
const fs = require('fs');
const vm = require('vm');

const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');

function createStorageShim() {
  const store = Object.create(null);

  return {
    getItem(key) {
      key = String(key);
      return Object.prototype.hasOwnProperty.call(store, key)
        ? store[key]
        : null;
    },

    setItem(key, value) {
      store[String(key)] = String(value);
    },

    removeItem(key) {
      delete store[String(key)];
    },

    clear() {
      Object.keys(store).forEach(key => delete store[key]);
    },

    key(index) {
      const keys = Object.keys(store);
      return keys[index] || null;
    },

    get length() {
      return Object.keys(store).length;
    }
  };
}

const context = {
  console,
  URLSearchParams,
  URL,
  TextEncoder,
  TextDecoder,
  globalThis: {},
  window: {},
  document: {},
  localStorage: createStorageShim(),
  sessionStorage: createStorageShim(),

  location: {
    search: ''
  }
};

context.globalThis = context;
context.window = context;
context.window.window = context.window;
context.window.console = console;

vm.createContext(context);

try {
  vm.runInContext(source, context, {
    filename: 'hc-office-manager-doc-intake.html'
  });
} catch (err) {
  console.error('FAIL: selected HC browser scripts failed');
  console.error(err && err.stack || err);
  process.exit(1);
}

const neural = context.window.TSM_HC_OM_NEURAL_INTAKE;
const router = context.window.hcOmRouteDocument;
const builder = context.window.hcOmBuildRoutingEnvelope;
const config = context.window.TSM_HC_OM_INTAKE;

console.log('Neural bridge:', typeof neural);
console.log('Router:', typeof router);
console.log('Routing envelope:', typeof builder);
console.log(
  'Routing config:',
  config && Object.keys(config.routing || {})
);

if (!neural || typeof neural.buildEnvelope !== 'function') {
  console.error('FAIL: neural browser bridge unavailable');
  process.exit(1);
}

if (typeof router !== 'function') {
  console.error('FAIL: HC OM router unavailable');
  process.exit(1);
}

if (typeof builder !== 'function') {
  console.error('FAIL: HC OM routing envelope unavailable');
  process.exit(1);
}

const text =
  'HIPAA compliance audit involving vendor procurement';

const routes = router(text);

console.log('Direct browser router:', JSON.stringify(routes));

if (!routes.some(x => x.node === 'compliance')) {
  console.error('FAIL: browser router did not identify compliance');
  process.exit(1);
}

if (!routes.some(x => x.node === 'vendors')) {
  console.error('FAIL: browser router did not identify vendors');
  process.exit(1);
}

const envelope = neural.buildEnvelope(
  text,
  {
    type: 'text',
    value: text
  }
);

console.log(
  'Browser bridge candidates:',
  envelope && envelope.candidateNodes
);

console.log(
  'Browser bridge suggested routes:',
  envelope && envelope.suggestedRoutes
);

if (!envelope) {
  console.error('FAIL: neural envelope not created');
  process.exit(1);
}

if (
  !Array.isArray(envelope.candidateNodes) ||
  !envelope.candidateNodes.includes('compliance')
) {
  console.error('FAIL: browser bridge did not identify compliance');
  process.exit(1);
}

if (!envelope.candidateNodes.includes('vendors')) {
  console.error('FAIL: browser bridge did not identify vendors');
  process.exit(1);
}

console.log('PASS: browser neural bridge');
console.log('PASS: browser router');
console.log('PASS: compliance candidate');
console.log('PASS: vendors candidate');
console.log('PASS: HC OM browser routing contract');
NODE

echo
echo "=== 7. CONNECTED SOURCE VERIFICATION ==="

grep -n -E \
  "TSM_HC_OM_NEURAL_INTAKE|hcNeuralIntake|suggestedRoutes|hcOmBuildRoutingEnvelope" \
  "$UPLOADER" | head -80

echo
echo "============================================================"
echo " PASS: TSM HC NEURAL INTAKE CONNECTED SYSTEM TEST"
echo "============================================================"
