#!/usr/bin/env node
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const WAR_ROOM_PATH = path.join(__dirname, "html/healthcare/hc-denial-war-room.html");

function extractScriptBlockWith(marker, filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const scripts = [...content.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const block = scripts.find(s => s.includes(marker));
  if (!block) throw new Error(`Could not find a <script> block containing "${marker}" in ${filePath}`);
  return block;
}

const code = extractScriptBlockWith("buildHCStructuredCase", WAR_ROOM_PATH);

const sandbox = {
  console,
  setInterval: () => {}, clearInterval: () => {},
  setTimeout: () => {}, clearTimeout: () => {},
  document: {
    getElementById: () => ({ addEventListener: () => {}, value: '', textContent: '', style: {}, dataset: {}, innerText: '' }),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, addEventListener: () => {}, appendChild: () => {} })
  },
  navigator: { clipboard: { writeText: () => {} } },
  location: { search: '', href: '' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { buildHCStructuredCase, isRefusalText } = sandbox;
if (typeof buildHCStructuredCase !== "function") {
  console.error("buildHCStructuredCase not found in extracted block — file structure may have changed.");
  process.exit(1);
}
if (typeof isRefusalText !== "function") {
  console.error("isRefusalText not found — the fix may have been reverted or renamed.");
  process.exit(1);
}

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { console.log("PASS -", label); passed++; }
  else { console.log("FAIL -", label); failed++; }
}

const refusalE2 = "I'm afraid I can't generate a denial-root-cause analysis without the specific claim and denial details. If you could paste the relevant sections of the denial notice (e.g., the claim ID, payer decision code, narrative explanation, and appeal deadline), I'll be able to extract the denial reason, policy violated, documentation gaps, and coding errors for you.";
const case1 = buildHCStructuredCase(["", refusalE2, "", ""], "", null);
check("refusal text NOT accepted as rootCauseHypothesis", case1.rootCauseHypothesis === null);
check("provenance tagged LLM_REFUSED_INSUFFICIENT_DATA",
  case1.evidenceProvenance.find(p => p.field === 'rootCauseHypothesis')?.source === 'LLM_REFUSED_INSUFFICIENT_DATA');

const realE2 = "Denial Reason: CO-50 - Insufficient documentation to support the billed level of service. The E/M code submitted (99215) does not match the documentation, which only supports a level 3 visit.";
const case2 = buildHCStructuredCase(["", realE2, "", ""], "", null);
check("real finding IS captured", typeof case2.rootCauseHypothesis === 'string' && case2.rootCauseHypothesis.length > 0);
check("real finding tagged LLM_INFERENCE",
  case2.evidenceProvenance.find(p => p.field === 'rootCauseHypothesis')?.source === 'LLM_INFERENCE');
check("real finding text preserved correctly", case2.rootCauseHypothesis.includes('CO-50'));

const case3 = buildHCStructuredCase(["", "", "", ""], "", null);
check("empty output stays NOT_FOUND",
  case3.rootCauseHypothesis === null &&
  case3.evidenceProvenance.find(p => p.field === 'rootCauseHypothesis')?.source === 'NOT_FOUND');

check("isRefusalText catches 'I cannot'", isRefusalText("I cannot determine the root cause without more data."));
check("isRefusalText catches 'please provide'", isRefusalText("Please provide the claim ID and denial code so I can analyze this."));
check("isRefusalText does not flag normal clinical text", !isRefusalText("Prior authorization was required for this CPT code per payer policy 4.2."));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
