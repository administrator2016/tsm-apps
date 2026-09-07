#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

FILE="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER — PHASE 4"
echo "AR-ACTION-001 RECOVERY ACTION TRAINING"
echo "============================================================"

if [ ! -f "$FILE" ]; then
  echo "FAIL     Missing $FILE"
  exit 1
fi

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="/tmp/tsm-ar-recovery-career-adapter.phase4.${STAMP}.bak"
cp "$FILE" "$BACKUP"
echo "BACKUP   $BACKUP"

python3 - "$FILE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()

if "AR-ACTION-001" in text:
    print("INFO     AR-ACTION-001 already present; no duplicate patch applied")
    sys.exit(0)

anchor = """  global.TSMARRecoveryCareer = {
"""

if anchor not in text:
    print("FAIL     Public API anchor not found")
    sys.exit(1)

block = r"""
  /*
   * ============================================================
   * AR-ACTION-001 — RECOVERY ACTION TRAINING
   * ============================================================
   *
   * This scenario extends the same operational A/R queue used by
   * AR-QUEUE-001. It deliberately does NOT create a second storage
   * or mastery system.
   */

  var ACTION_SCENARIO = {
    id: 'AR-ACTION-001',
    domain: 'ar_recovery',
    competency: 'recovery_strategy',
    title: 'A/R Recovery Action Selection',
    prompt:
      'Select the recovery action that gives the account the strongest ' +
      'realistic path to payment. Then identify the documentation and urgency.',
    choices: [
      {
        id: 'appeal',
        label: 'Appeal / clinical appeal'
      },
      {
        id: 'variance',
        label: 'Payer variance dispute'
      },
      {
        id: 'corrected_claim',
        label: 'Corrected claim / rebill'
      },
      {
        id: 'eligibility_cob',
        label: 'Resolve eligibility / COB and rebill'
      },
      {
        id: 'escalate',
        label: 'Payer call + written escalation'
      },
      {
        id: 'standard_followup',
        label: 'Standard follow-up'
      }
    ]
  };

  function normalizeActionText(value) {
    return String(value || '').toLowerCase().trim();
  }

  function expectedRecoveryAction(account) {
    if (!account) {
      return {
        action: 'standard_followup',
        urgency: 'MEDIUM',
        documentation: ['Account notes', 'Payer correspondence']
      };
    }

    var status = normalizeActionText(account.status);
    var age = Number(account.age_days || 0);

    if (
      status.indexOf('timely filing') !== -1 ||
      status.indexOf('appeal deadline') !== -1
    ) {
      return {
        action: 'appeal',
        urgency: 'CRITICAL',
        documentation: [
          'Payer denial/remittance',
          'Timely filing or appeal documentation',
          'Supporting clinical or claim documentation'
        ]
      };
    }

    if (
      status.indexOf('medical necessity') !== -1 ||
      status.indexOf('denied') !== -1 ||
      status.indexOf('denial') !== -1
    ) {
      return {
        action: 'appeal',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Denial/remittance',
          'Clinical notes',
          'Medical necessity or supporting documentation'
        ]
      };
    }

    if (
      status.indexOf('underpaid') !== -1 ||
      status.indexOf('variance') !== -1 ||
      status.indexOf('contracted rate') !== -1
    ) {
      return {
        action: 'variance',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Remittance advice',
          'Contracted rate',
          'Payment variance calculation'
        ]
      };
    }

    if (
      status.indexOf('duplicate') !== -1 ||
      status.indexOf('rejection') !== -1
    ) {
      return {
        action: 'corrected_claim',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Rejected claim',
          'Original claim details',
          'Corrected claim information'
        ]
      };
    }

    if (
      status.indexOf('cob') !== -1 ||
      status.indexOf('coordination') !== -1
    ) {
      return {
        action: 'eligibility_cob',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Eligibility verification',
          'COB information',
          'Updated claim/billing documentation'
        ]
      };
    }

    if (
      status.indexOf('eligibility') !== -1
    ) {
      return {
        action: 'eligibility_cob',
        urgency: age >= 91 ? 'HIGH' : 'MEDIUM',
        documentation: [
          'Eligibility verification',
          'Coverage information',
          'Rebilling documentation'
        ]
      };
    }

    if (
      status.indexOf('no response') !== -1 ||
      status.indexOf('write-off') !== -1 ||
      status.indexOf('write off') !== -1
    ) {
      return {
        action: 'escalate',
        urgency: age >= 120 ? 'CRITICAL' : 'HIGH',
        documentation: [
          'Payer call history',
          'Prior written follow-up',
          'Account escalation notes'
        ]
      };
    }

    if (age >= 120) {
      return {
        action: 'escalate',
        urgency: 'CRITICAL',
        documentation: [
          'Account history',
          'Payer correspondence',
          'Escalation/write-off prevention documentation'
        ]
      };
    }

    if (age >= 91) {
      return {
        action: 'escalate',
        urgency: 'HIGH',
        documentation: [
          'Account notes',
          'Payer correspondence',
          'Follow-up documentation'
        ]
      };
    }

    return {
      action: 'standard_followup',
      urgency: age >= 61 ? 'MEDIUM' : 'LOW',
      documentation: [
        'Account notes',
        'Payer correspondence'
      ]
    };
  }

  function scoreRecoveryAction(account, selectedAction) {
    var expected = expectedRecoveryAction(account);
    var actual = normalizeActionText(selectedAction);

    var score = actual === expected.action ? 1 : 0;

    return {
      score: score,
      percentage: Math.round(score * 100),
      expectedAction: expected.action,
      selectedAction: actual,
      urgency: expected.urgency,
      documentation: expected.documentation,
      correct: score === 1
    };
  }

  function scoreActionReasoning(text, account, selectedAction) {
    var value = normalizeActionText(text);
    var expected = expectedRecoveryAction(account);
    var concepts = 0;

    var terms = [
      'denial',
      'appeal',
      'deadline',
      'payer',
      'aging',
      'balance',
      'documentation',
      'medical necessity',
      'underpaid',
      'variance',
      'eligibility',
      'cob',
      'recovery',
      'write-off',
      'write off',
      'urgency'
    ];

    terms.forEach(function (term) {
      if (value.indexOf(term) !== -1) concepts += 1;
    });

    var score = Math.min(1, concepts / 3);

    if (
      value.indexOf(expected.action.replace('_', ' ')) !== -1 ||
      (expected.action === 'appeal' && value.indexOf('appeal') !== -1) ||
      (expected.action === 'variance' && value.indexOf('variance') !== -1) ||
      (expected.action === 'corrected_claim' &&
        (value.indexOf('corrected') !== -1 ||
          value.indexOf('rebill') !== -1)) ||
      (expected.action === 'eligibility_cob' &&
        (value.indexOf('eligibility') !== -1 ||
          value.indexOf('cob') !== -1)) ||
      (expected.action === 'escalate' &&
        (value.indexOf('escalat') !== -1 ||
          value.indexOf('payer call') !== -1))
    ) {
      score = Math.min(1, score + 0.25);
    }

    return {
      score: score,
      percentage: Math.round(score * 100),
      concepts: concepts
    };
  }

  function scoreDocumentation(selectedDocumentation, account) {
    var expected = expectedRecoveryAction(account);
    var selected = Array.isArray(selectedDocumentation)
      ? selectedDocumentation
      : [];

    if (!selected.length) {
      return {
        score: 0,
        percentage: 0,
        matched: []
      };
    }

    var normalized = selected.map(normalizeActionText);
    var matched = expected.documentation.filter(function (item) {
      var target = normalizeActionText(item);

      return normalized.some(function (value) {
        return (
          value.indexOf(target) !== -1 ||
          target.indexOf(value) !== -1
        );
      });
    });

    var score = Math.min(
      1,
      matched.length / Math.max(1, expected.documentation.length)
    );

    return {
      score: score,
      percentage: Math.round(score * 100),
      matched: matched
    };
  }

  function recordActionResult(result) {
    result = result || {};

    var account = result.account || null;
    var actionScore = scoreRecoveryAction(
      account,
      result.selectedAction
    );

    var reasoningScore = scoreActionReasoning(
      result.reasoning,
      account,
      result.selectedAction
    );

    var documentationScore = scoreDocumentation(
      result.documentation,
      account
    );

    var recorded = [];

    var engine =
      global.TSMRCMEngine ||
      null;

    if (engine && typeof engine.recordAttempt === 'function') {
      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'recovery_strategy',
          competency: 'recovery_strategy',
          score: actionScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'payer_strategy',
          competency: 'payer_strategy',
          score: reasoningScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );

      recorded.push(
        engine.recordAttempt({
          domain: 'ar_recovery',
          concept: 'documentation',
          competency: 'documentation',
          score: documentationScore.score,
          scenario: ACTION_SCENARIO.id
        })
      );
    }

    if (engine && typeof engine.recordDecision === 'function') {
      recorded.push(
        engine.recordDecision({
          scenario: ACTION_SCENARIO.id,
          selectedAccounts: account ? [account] : [],
          reasoningScore: reasoningScore.score,
          recoveryActionScore: actionScore.score
        })
      );
    }

    return {
      scenario: ACTION_SCENARIO.id,
      account_id: account ? account.account_id : null,
      actionScore: actionScore,
      reasoningScore: reasoningScore,
      documentationScore: documentationScore,
      overallScore:
        Math.round(
          (
            actionScore.score +
            reasoningScore.score +
            documentationScore.score
          ) / 3 * 100
        ) / 100,
      recorded: recorded.length > 0
    };
  }

"""

text = text.replace(anchor, block + anchor, 1)

old_api = """    scenario: SCENARIO,
    discoverAccounts: discoverAccounts,
    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    recordResult: recordResult,
    getReadiness: getReadiness,
    mount: mount
"""

new_api = """    scenario: SCENARIO,
    actionScenario: ACTION_SCENARIO,
    discoverAccounts: discoverAccounts,
    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    recordResult: recordResult,
    expectedRecoveryAction: expectedRecoveryAction,
    scoreRecoveryAction: scoreRecoveryAction,
    scoreActionReasoning: scoreActionReasoning,
    scoreDocumentation: scoreDocumentation,
    recordActionResult: recordActionResult,
    getReadiness: getReadiness,
    mount: mount
"""

if old_api not in text:
    print("FAIL     Existing public API shape not found")
    sys.exit(1)

text = text.replace(old_api, new_api, 1)

contract_anchor = """  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;
"""

if contract_anchor not in text:
    print("FAIL     Existing AR training contract not found")
    sys.exit(1)

replacement = """  global.TSM_AR_TRAINING_SCENARIOS[SCENARIO.id] = SCENARIO;
  global.TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO;
"""

text = text.replace(contract_anchor, replacement, 1)

path.write_text(text)
print("PASS     AR-ACTION-001 implementation inserted")
PY

echo
echo "=== 1. SYNTAX ==="
node --check "$FILE"
if [ $? -ne 0 ]; then
  echo "FAIL     Adapter syntax"
  exit 1
fi
echo "PASS     Adapter syntax"

echo
echo "=== 2. ACTION CONTRACT ==="
grep -n -E \
  "AR-ACTION-001|ACTION_SCENARIO|recordActionResult|scoreRecoveryAction" \
  "$FILE" | head -60

for token in \
  "AR-ACTION-001" \
  "actionScenario: ACTION_SCENARIO" \
  "recordActionResult: recordActionResult" \
  "scoreRecoveryAction: scoreRecoveryAction" \
  "TSM_AR_TRAINING_SCENARIOS[ACTION_SCENARIO.id] = ACTION_SCENARIO"
do
  if grep -Fq "$token" "$FILE"; then
    echo "PASS     $token"
  else
    echo "FAIL     Missing contract token: $token"
    exit 1
  fi
done

echo
echo "=== 3. CAREER ENGINE INTEGRATION ==="
grep -n -E \
  "recovery_strategy|payer_strategy|documentation|recoveryActionScore" \
  "$FILE" | tail -30

echo
echo "=== 4. DIFF CHECK ==="
git diff --check -- "$FILE"
if [ $? -ne 0 ]; then
  echo "FAIL     git diff --check"
  exit 1
fi
echo "PASS     git diff --check"

echo
echo "=== 5. STATUS ==="
git status --short -- "$FILE"

echo
echo "============================================================"
echo "PHASE 4 AR-ACTION-001 BUILD COMPLETE"
echo "============================================================"
echo
echo "NEXT:"
echo "  ./scripts/test-rcm-career-browser.sh"
echo
