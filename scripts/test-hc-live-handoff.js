'use strict';
/*
 * Live-handoff regression (roadmap Step 15):
 *
 *   Denial document -> War Room engines -> structured case -> Strategist relay
 *   -> TSM_EXEC_RELAY -> Executive Portal Recovery Gate -> recovery work item
 *   -> BPO work-item + evidence document -> human review
 *
 * No browser: the REAL page code is pulled out of the shipped files and run in
 * a vm sandbox (War Room functions, Recovery Gate block, Strategist prompt
 * builder, tsm-bpo-relay.js, server/healthcare/recovery-orchestrator.js). Only
 * the network is faked. Fixtures use fixed dates so the test never goes stale.
 *
 * Run: node scripts/test-hc-live-handoff.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WAR_ROOM = read('html/healthcare/hc-denial-war-room.html');
const STRATEGIST = read('html/healthcare/hc-main-strategist.html');
const PORTAL = read('html/healthcare/executive-portal.html');
const RELAY_JS = read('html/shared/tsm-bpo-relay.js');
const { buildRecoveryWorkItem } = require('../server/healthcare/recovery-orchestrator');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('OK:  ' + msg);
  else { failures++; console.error('FAIL: ' + msg); }
}
function eq(actual, expected, msg) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(same, msg + (same ? '' : '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected) + ')'));
}

// Pull a top-level `function name(...) { ... }` (closing brace in column 0).
function extractFn(src, name) {
  const m = src.match(new RegExp('^(?:async )?function ' + name + '\\b[\\s\\S]*?^\\}', 'm'));
  if (!m) throw new Error('could not extract function ' + name);
  return m[0];
}

// ── Stage 1: War Room engines -> structured case (real code) ─────────────────
const warRoomCtx = vm.createContext({ Date, Math, Number, String, Array, Object, JSON, RegExp, parseFloat, parseInt, isNaN, console });
vm.runInContext(
  ['fmtDate', 'extractExplicitDate', 'resolveAppealDeadline', 'stripMd', 'isRefusalText', 'parseRecoveryLikelihood', 'buildHCStructuredCase']
    .map((n) => extractFn(WAR_ROOM, n)).join('\n\n'),
  warRoomCtx
);
const buildCase = (outputs, doc, dollar) => JSON.parse(JSON.stringify(warRoomCtx.buildHCStructuredCase(outputs, doc, dollar)));

const DOC = [
  'EXPLANATION OF BENEFITS \u2014 CLAIM DENIAL NOTICE', '',
  'Claim ID: AZ-BCBS-2026-88214', 'Date of Service: September 5, 2026', 'Provider: Desert Ridge Medical Group',
  'CPT Code: 99213 (Office Visit, Established Patient, Moderate Complexity)', 'Billed Amount: $4,850.00',
  'Payer Allowed: $0.00', 'Payer: Blue Cross Blue Shield of Arizona', '',
  'DENIAL REASON: Medical necessity not established. Documentation submitted does not support the level of service billed. Modifier 25 not accepted without separate E&M documentation. Physician attestation missing from submitted records.', '',
  'DENIAL CODE: CO-50 / CO-4',
  'APPEAL DEADLINE: 60 days from date of this notice (November 7, 2026)',
  'Additional context: Total revenue at risk this quarter: $187,000.'
].join('\n');

const E1 = [
  '- **Claim ID:** AZ-BCBS-2026-88214', '- **Provider:** Desert Ridge Medical Group',
  '- **Payer:** Blue Cross Blue Shield of Arizona', '- **Date of Service:** September 5, 2026',
  '- **CPT Code(s):** 99213', '- **Billed Amount:** $4,850.00', '- **Denial Code(s):** CO-50 / CO-4',
  '- **Denial Reason:** Medical necessity not established. Documentation submitted does not support the level of service billed. Modifier 25 not accepted without separate E&M documentation. Physician attestation missing from submitted records.',
  '- **Appeal Deadline:** 60 days from date of this notice (November 7, 2026)'
].join('\n');
const E2 = '**Denial Reason (per payer)**\n- Medical necessity not established.\n- Submitted documentation does not justify the billed level of service.\n- Modifier 25 was used but no separate E&M documentation was provided.\n- Physician attestation missing.';
const E3 = '**Revenue at Risk:** $4,850 for this claim; the source also cites $187,000 quarterly exposure.\n**Appeal deadline:** November 7, 2026.';
const E4_OK = 'RECOVERY LIKELIHOOD: MODERATE - the documentation gap is curable with the signed note.\n\n1. Gather records\n2. Prepare appeal letter';
const E4_BOLD = '**RECOVERY LIKELIHOOD:** MODERATE - the documentation gap is curable.\n\n1. Gather records';
const E4_CUT = '1. **Review the denial**\n2. **Gather required documents**\n3. **Prepare the appeal letter**\n   - **Opening**: State';
const E5 = '1. Assign coder\n2. File appeal';

console.log('\n== Stage 1: War Room -> structured case');
const good = buildCase([E1, E2, E3, E4_OK, E5], DOC, '$187,000');
eq(good.claimId, 'AZ-BCBS-2026-88214', 'claimId extracted');
eq(good.payer, 'Blue Cross Blue Shield of Arizona', 'payer extracted');
eq(good.denialReasonCode, 'CO-50 / CO-4', 'denialReasonCode extracted');
eq(good.denialCategory, 'medical_necessity', 'denialCategory classified');
eq(good.appealDeadline, '2026-11-07', 'appealDeadline is the explicit calendar date (not +60 days)');
eq(good.financialExposure, 4850, 'financialExposure is the claim amount, not the $187,000 portfolio figure');
eq(good.recoveryLikelihood, 'MODERATE', 'recoveryLikelihood parsed from Engine 04 first line');
eq(good.confidence, 65, 'confidence mapped from MODERATE');
eq(good.confidenceTier, 'LOW', 'confidenceTier derived from confidence');
eq(good.humanReviewRequired, true, 'humanReviewRequired is true for a LOW tier');
eq(good.appealable, true, 'appealable determination present');
check(Array.isArray(good.evidenceProvenance) && good.evidenceProvenance.length >= 12, 'evidenceProvenance populated');
const provLikely = (good.evidenceProvenance || []).find((p) => p.field === 'recoveryLikelihood');
eq(provLikely && provLikely.source, 'LLM_INFERENCE', 'likelihood provenance is tagged LLM_INFERENCE');

const bold = buildCase([E1, E2, E3, E4_BOLD, E5], DOC, '$187,000');
eq(bold.recoveryLikelihood, 'MODERATE', 'markdown-bold likelihood line still parses');

const cut = buildCase([E1, E2, E3, E4_CUT, E5], DOC, '$187,000');
eq(cut.recoveryLikelihood, null, 'truncated Engine 04 output yields null (never guessed)');
eq(cut.confidence, null, 'confidence stays null when likelihood is missing');

// Two distinct failure shapes. Engines erroring while the source document is
// still on the page legitimately keeps the deterministic fields (claim ID,
// exposure) -- only the LLM-derived fields go null. Engines erroring with NO
// document leaves nothing to extract.
const errs = Array(5).fill('[Error after retry: Unauthorized]');
const enginesFailedWithDoc = buildCase(errs, DOC, null);
eq(enginesFailedWithDoc.recoveryLikelihood, null, 'engines-failed run has no likelihood');
eq(enginesFailedWithDoc.claimId, 'AZ-BCBS-2026-88214', 'engines-failed run still extracts claimId deterministically from the document');
eq(enginesFailedWithDoc.financialExposure, 4850, 'engines-failed run still extracts exposure deterministically from the document');
const failed = buildCase(errs, '', null);
eq(failed.claimId, null, 'no-document run has no claimId');
eq(failed.financialExposure, null, 'no-document run has no exposure (never manufactured)');

// ── Stage 2: Strategist relay ────────────────────────────────────────────────
console.log('\n== Stage 2: War Room brief -> Strategist -> TSM_EXEC_RELAY');
check(/payload\.structuredCase\s*=\s*structuredCase;/.test(STRATEGIST), 'Strategist copies structuredCase into the relay payload');
check(/source:\s*'HC Main Strategist'/.test(STRATEGIST), "Strategist stamps relay source: 'HC Main Strategist'");
check(/TSM_EXEC_RELAY/.test(STRATEGIST), 'Strategist writes TSM_EXEC_RELAY');
const brief = { source: 'TSM_DENIAL_WAR_ROOM', sessionId: 'WR-1', timestamp: '2026-09-18T22:00:00.000Z', engineOutputs: { 'Document Intelligence': E1 }, engine06: { narrative: 'x' }, structuredCase: good };
const relay = JSON.parse(JSON.stringify({ ts: Date.now(), source: 'HC Main Strategist', structuredCase: (brief && brief.structuredCase) || null }));
eq(relay.structuredCase, good, 'structuredCase survives the relay byte-for-byte');

// Strategist prompt must carry the verified case so the model cannot re-derive the deadline.
const buildPrompt = (b) => new Function('HC_CONTEXT_BASE', 'readWarRoomBrief', extractFn(STRATEGIST, 'buildHCContext') + '\nreturn buildHCContext;')('BASE', () => b)();
const prompt = buildPrompt(brief);
check(prompt.includes('VERIFIED STRUCTURED CASE'), 'Strategist prompt includes the VERIFIED STRUCTURED CASE block');
check(prompt.includes('Appeal deadline (calendar date): 2026-11-07'), 'Strategist prompt states the exact appeal deadline');
check(prompt.includes('Financial exposure (USD): 4850'), 'Strategist prompt states the exact exposure');
check(prompt.includes('Claim ID: AZ-BCBS-2026-88214'), 'Strategist prompt states the claim ID');
check(!prompt.includes('187000') && !prompt.includes('187,000'), 'Strategist prompt never substitutes the portfolio figure for claim exposure');
const promptNoEngines = buildPrompt({ sessionId: 'WR-2', structuredCase: good });
check(promptNoEngines.includes('VERIFIED STRUCTURED CASE'), 'verified case is injected even when no engineOutputs are present');
const promptNullExposure = buildPrompt({ sessionId: 'WR-3', structuredCase: Object.assign({}, good, { financialExposure: null }) });
check(!promptNullExposure.includes('Financial exposure (USD)'), 'missing exposure is omitted, never written as a value');
check(!buildPrompt(null).includes('VERIFIED STRUCTURED CASE'), 'no brief -> no verified-case block');

// ── Stage 3: Executive Portal Recovery Gate (real code block) ───────────────
console.log('\n== Stage 3: Recovery Gate');
const gateStart = PORTAL.indexOf('var recoveryGateErrors = [];');
const gateEnd = PORTAL.indexOf('if (recoveryGateErrors.length)', gateStart);
check(gateStart > 0 && gateEnd > gateStart, 'located the Recovery Gate block in executive-portal.html');
const gate = new Function('lastStructuredCase', PORTAL.slice(gateStart, gateEnd) + '\nreturn recoveryGateErrors;');
eq(gate(good), [], 'gate passes the complete case');
eq(gate(bold), [], 'gate passes the markdown-bold case');
check(gate(cut).includes('recovery likelihood') && gate(cut).includes('confidence'), 'gate BLOCKS a case with no likelihood/confidence');
const withDocGate = gate(enginesFailedWithDoc);
check(withDocGate.includes('recovery likelihood') && withDocGate.includes('confidence'), 'gate BLOCKS the engines-failed case on likelihood/confidence');
check(!withDocGate.includes('claim ID') && !withDocGate.includes('financial exposure'), 'gate does not falsely block claim ID/exposure that were genuinely extracted');
const noDocGate = gate(failed);
check(noDocGate.includes('claim ID') && noDocGate.includes('financial exposure'), 'gate BLOCKS the no-document case on claim ID and exposure');
check(gate(Object.assign({}, good, { evidenceProvenance: [] })).includes('evidence provenance'), 'gate blocks empty evidence provenance');
check(gate(Object.assign({}, good, { financialExposure: null })).includes('financial exposure'), 'gate blocks missing exposure (never manufactured)');

// ── Stage 4: recovery work item (real server module) ────────────────────────
console.log('\n== Stage 4: recovery work item');
const opportunity = {
  contractVersion: '1.0.0', opportunityId: 'denials:' + good.claimId, source: 'hc-denial-war-room', runtimeSource: 'denial-war-room',
  claimId: good.claimId, payer: good.payer, denialReasonCode: good.denialReasonCode, denialCategory: good.denialCategory,
  rootCause: good.rootCauseHypothesis, appealable: good.appealable, appealDeadline: good.appealDeadline,
  recoveryLikelihood: good.recoveryLikelihood, confidence: good.confidence,
  financialExposure: good.financialExposure, exposure: good.financialExposure, evidenceProvenance: good.evidenceProvenance
};
check(/\/api\/hc\/recovery-work-item/.test(PORTAL) && /denials:/.test(PORTAL), 'portal posts the opportunity to /api/hc/recovery-work-item');
const wi = buildRecoveryWorkItem(opportunity);
eq(wi.recovery.executionPlan, { targetSystem: 'MANUAL_BPO', submissionMode: 'HUMAN_REVIEW' }, 'work item targets MANUAL_BPO with HUMAN_REVIEW (no auto-submission)');
eq(wi.recovery.humanApprovalRequired, true, 'humanApprovalRequired is true');
eq(wi.recovery.deadline, '2026-11-07', 'deadline carried into the work item');
eq(wi.exposure, 4850, 'exposure carried into the work item');
eq(wi.sourceOpportunity.recoveryLikelihood, 'MODERATE', 'likelihood carried into the work item');

// ── Stage 5: BPO relay transport (real tsm-bpo-relay.js, faked network) ─────
console.log('\n== Stage 5: BPO work item + evidence document');
(async () => {
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    return { ok: true, status: 200, json: async () => ({ ok: true, clients: [{ id: 'ziyad-industries' }], workItem: { caseId: 'x' }, document: { id: 'd1' } }) };
  };
  const win = {};
  vm.runInContext(RELAY_JS, vm.createContext({ window: win, document: {}, fetch: fakeFetch, FormData, Blob, URL, setTimeout, console, encodeURIComponent, JSON, Date, Promise, Array, Object, String, Error }));
  const pkg = { domain: 'Healthcare', packageId: 'PKG-TEST', sections: { healthcareRevenueRecovery: { structuredCase: good, recoveryWorkItem: wi } } };
  const caseId = wi.opportunityId;
  const out = await win.TSMBpoRelay.relayToBPO(pkg, 'ziyad-industries', { vertical: 'Healthcare', sourceSystem: 'tsm-hc-executive-portal', caseId });
  check(out && out.ok === true, 'relayToBPO resolves ok');
  check(calls.length === 2, 'exactly two calls: work-item upsert, then document upload');
  const wiCall = calls[0], docCall = calls[1];
  eq(wiCall.method, 'POST', 'work-item call is a POST');
  eq(wiCall.url, '/api/bpo/work-items/' + encodeURIComponent(caseId), 'work item is keyed by the recovery caseId');
  const sent = JSON.parse(wiCall.body);
  eq(sent.clientId, 'ziyad-industries', 'work item is assigned to the chosen client');
  eq(sent.stage, 'ready-for-review', 'work item stage is ready-for-review');
  eq(sent.status, 'open', 'work item status is open');
  eq(sent.payload.sections.healthcareRevenueRecovery.structuredCase, good, 'structured case is preserved inside the work-item payload');
  eq(sent.payload.sections.healthcareRevenueRecovery.recoveryWorkItem.recovery.executionPlan.submissionMode, 'HUMAN_REVIEW', 'HUMAN_REVIEW governance is preserved inside the work-item payload');
  eq(sent.payload.tsmRelay.sourceSystem, 'tsm-hc-executive-portal', 'relay records its source system');
  eq(docCall.url, '/api/bpo/work-items/' + encodeURIComponent(caseId) + '/documents', 'evidence package uploads to the same work item');
  check(docCall.body instanceof FormData && docCall.body.get('clientId') === 'ziyad-industries', 'document upload is tied to the client');
  check(!calls.some((c) => /payer|clearinghouse|submit/i.test(c.url)), 'no payer/clearinghouse submission call is ever made');

  // Filename must identify the claim and the relay moment so repeat clicks
  // are distinguishable in the work item's document list.
  const name1 = docCall.body.get('file').name;
  check(/^tsm-healthcare-denials-AZ-BCBS-2026-88214-\d{8}T\d{6}Z-client-package\.json$/.test(name1), 'evidence filename carries claim ID and timestamp (got ' + name1 + ')');
  await new Promise((r) => setTimeout(r, 1100));
  await win.TSMBpoRelay.relayToBPO(pkg, 'ziyad-industries', { vertical: 'Healthcare', caseId });
  const name2 = calls[3].body.get('file').name;
  check(name2 !== name1, 'a second relay click produces a distinguishable filename');
  await win.TSMBpoRelay.relayToBPO(pkg, 'ziyad-industries', { vertical: 'Healthcare', caseId, filename: 'custom.json' });
  eq(calls[5].body.get('file').name, 'custom.json', 'an explicit options.filename is still honored');

  console.log(failures ? '\nHANDOFF REGRESSION: ' + failures + ' FAILURE(S)' : '\nHANDOFF REGRESSION: PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FAIL (exception):', e); process.exit(1); });
