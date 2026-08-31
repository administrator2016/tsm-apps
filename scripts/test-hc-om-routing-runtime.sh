#!/usr/bin/env bash
set -euo pipefail

FILE="html/healthcare/hc-office-manager-doc-intake.html"
TMP="/tmp/hc-om-routing-runtime.js"

echo "============================================================"
echo " TSM HC OM — RUNTIME ROUTING VALIDATION"
echo "============================================================"
echo
echo "FILE: $FILE"
echo

echo "=== 1. EXTRACT HC OM ROUTING MODULE ==="

python3 - "$FILE" "$TMP" <<'PY'
import re
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
out_file = Path(sys.argv[2])

cfg_match = re.search(
    r'window\.TSM_HC_OM_INTAKE\s*=\s*\{.*?\n\};',
    src,
    re.S
)

if not cfg_match:
    raise SystemExit("FAIL: HC OM configuration not found")

module_match = re.search(
    r'\(function\s*\(\)\s*\{\s*'
    r'const cfg = window\.TSM_HC_OM_INTAKE;.*?'
    r'\}\)\(\);',
    src,
    re.S
)

if not module_match:
    raise SystemExit("FAIL: HC OM routing module not found")

config_assignment = cfg_match.group(0)
module_js = module_match.group(0)

# Keep the actual browser assignment intact.
# The VM harness will provide window before executing this file.
runtime_js = """'use strict';

globalThis.window = globalThis;

""" + config_assignment + """

""" + module_js + "\n"

out_file.write_text(runtime_js)

print("HC OM configuration extracted.")
print("HC OM routing module extracted.")
print(f"Runtime module: {out_file}")
PY

echo
echo "=== 2. NODE SYNTAX ==="
node --check "$TMP"
echo "PASS: Node syntax"

echo
echo "=== 3. RUNTIME ROUTER TEST ==="

node - "$TMP" <<'NODE'
const fs = require("fs");
const vm = require("vm");

const file = process.argv[2];

const context = {
  console,
  Date,
  String,
  Number,
  Array,
  Object,
  JSON
};

// Browser-like global.
// window and globalThis deliberately point at the SAME object.
context.globalThis = context;
context.window = context;

vm.createContext(context);

const source = fs.readFileSync(file, "utf8");

vm.runInContext(source, context, {
  filename: file
});

console.log("Checking HC OM configuration...");

if (!context.window.TSM_HC_OM_INTAKE) {
  throw new Error("FAIL: TSM_HC_OM_INTAKE did not load");
}

if (!context.window.TSM_HC_OM_INTAKE.routing) {
  throw new Error("FAIL: TSM_HC_OM_INTAKE.routing did not load");
}

console.log("PASS: TSM_HC_OM_INTAKE");
console.log("PASS: routing configuration");

console.log("Checking HC OM routing functions...");

if (typeof context.window.hcOmRouteDocument !== "function") {
  throw new Error("FAIL: hcOmRouteDocument is not a function");
}

if (typeof context.window.hcOmBuildRoutingEnvelope !== "function") {
  throw new Error("FAIL: hcOmBuildRoutingEnvelope is not a function");
}

console.log("PASS: hcOmRouteDocument");
console.log("PASS: hcOmBuildRoutingEnvelope");

const cases = [
  {
    name: "Denial / billing",
    text: "Claim denial due to CPT coding and accounts receivable revenue cycle issue",
    expected: ["billing"]
  },
  {
    name: "HIPAA / compliance",
    text: "HIPAA privacy compliance audit and documentation compliance review",
    expected: ["compliance"]
  },
  {
    name: "Grant / funding",
    text: "HRSA grant funding award renewal",
    expected: ["grants"]
  },
  {
    name: "Clinical",
    text: "Physician clinical documentation and patient care procedure",
    expected: ["medical"]
  },
  {
    name: "Vendor",
    text: "Vendor performance supplier procurement service agreement",
    expected: ["vendors"]
  }
];

for (const test of cases) {
  const routes = context.window.hcOmRouteDocument(test.text);
  const nodes = routes.map(r => r.node);

  console.log(`\n${test.name}`);
  console.log("  routes:", JSON.stringify(routes));

  for (const expectedNode of test.expected) {
    if (!nodes.includes(expectedNode)) {
      throw new Error(
        `FAIL: expected ${expectedNode}, received ${JSON.stringify(nodes)}`
      );
    }
  }

  console.log(`  PASS: ${test.expected.join(", ")}`);
}

const envelope =
  context.window.hcOmBuildRoutingEnvelope(
    "HIPAA compliance audit involving vendor procurement",
    {
      type: "text",
      value: "HIPAA compliance audit involving vendor procurement"
    }
  );

console.log("\nEnvelope:");
console.log(JSON.stringify(envelope, null, 2));

if (envelope.platform !== "HC_OFFICE_MANAGER") {
  throw new Error("FAIL: envelope platform");
}

if (envelope.vertical !== "healthcare") {
  throw new Error("FAIL: envelope vertical");
}

if (!Array.isArray(envelope.routedNodes)) {
  throw new Error("FAIL: envelope routedNodes");
}

const envelopeNodes = envelope.routedNodes.map(r => r.node);

if (!envelopeNodes.includes("compliance")) {
  throw new Error("FAIL: envelope missing compliance route");
}

if (!envelopeNodes.includes("vendors")) {
  throw new Error("FAIL: envelope missing vendors route");
}

if (envelope.strategist?.persona !== "Office Manager") {
  throw new Error("FAIL: strategist persona");
}

console.log("PASS: routing envelope");
console.log("PASS: compliance + vendors multi-route");
console.log("PASS: strategist destination");

console.log("\nHC OM ROUTER RUNTIME: PASS");
NODE

echo
echo "=== 4. STATIC DIFF CHECK ==="
git diff --check
echo "PASS: git diff --check"

echo
echo "=== 5. SOURCE VERIFICATION ==="
grep -n -E \
  "TSM_HC_OM_INTAKE|hcOmRouteDocument|hcOmBuildRoutingEnvelope|hcOmSuggested|suggestedRoutes|suggestedNodes" \
  "$FILE"

echo
echo "============================================================"
echo " HC OM RUNTIME ROUTING TEST COMPLETE"
echo "============================================================"
