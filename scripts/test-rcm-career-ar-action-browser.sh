#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

BASE="${BASE:-http://localhost:3000}"
TEST_FILE=".tmp-rcm-ar-action-browser-test.$$\.js"

PASS=0
FAIL=0

cleanup() {
  rm -f "$TEST_FILE"
}
trap cleanup EXIT

echo "============================================================"
echo "TSM RCM CAREER — AR-ACTION-001 BROWSER TEST"
echo "============================================================"
echo "ROOT=$ROOT"
echo "BASE=$BASE"
echo

echo "=== 1. VERIFY PLAYWRIGHT ==="

node -e "require('playwright')" >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "FAIL     Playwright package unavailable"
  exit 1
fi

echo "PASS     Playwright package available"

cat > "$TEST_FILE" <<'NODE'
const { chromium } = require("playwright");

(async () => {
  const base = process.env.BASE || "http://localhost:3000";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];

  page.on("console", msg => {
    if (msg.type() === "error") {
      errors.push("console: " + msg.text());
    }
  });

  page.on("pageerror", err => {
    errors.push("pageerror: " + err.message);
  });

  let failed = false;

  function pass(msg) {
    console.log("PASS     " + msg);
  }

  function fail(msg) {
    console.log("FAIL     " + msg);
    failed = true;
  }

  try {
    console.log("=== 1. LOAD A/R WAR ROOM ===");

    await page.goto(
      base + "/html/healthcare/ar-recovery-war-room.html",
      { waitUntil: "networkidle" }
    );

    await page.waitForTimeout(500);

    if (
      (await page.title()).toLowerCase().includes("a/r") ||
      (await page.locator("body").innerText()).includes("A/R Recovery")
    ) {
      pass("A/R War Room loaded");
    } else {
      fail("A/R War Room not recognized");
    }

    console.log("=== 2. CAREER ENGINE / ACTION ADAPTER ===");

    const runtime = await page.evaluate(() => ({
      engine: !!window.TSMRCMEngine,
      adapter: !!window.TSMARRecoveryCareer,
      actionScenario:
        !!(
          window.TSMARRecoveryCareer &&
          window.TSMARRecoveryCareer.actionScenario
        ),
      actionContract:
        !!(
          window.TSM_AR_TRAINING_SCENARIOS &&
          window.TSM_AR_TRAINING_SCENARIOS["AR-ACTION-001"]
        ),
      actionMethods:
        !!(
          window.TSMARRecoveryCareer &&
          typeof window.TSMARRecoveryCareer.recordActionResult === "function" &&
          typeof window.TSMARRecoveryCareer.scoreRecoveryAction === "function" &&
          typeof window.TSMARRecoveryCareer.scoreActionReasoning === "function" &&
          typeof window.TSMARRecoveryCareer.scoreDocumentation === "function"
        )
    }));

    if (runtime.engine) pass("TSMRCMEngine initialized");
    else fail("TSMRCMEngine missing");

    if (runtime.adapter) pass("TSMARRecoveryCareer initialized");
    else fail("TSMARRecoveryCareer missing");

    if (runtime.actionScenario) pass("AR-ACTION-001 scenario exposed");
    else fail("AR-ACTION-001 scenario missing");

    if (runtime.actionContract) pass("AR-ACTION-001 training contract available");
    else fail("AR-ACTION-001 training contract unavailable");

    if (runtime.actionMethods) pass("AR-ACTION-001 scoring API available");
    else fail("AR-ACTION-001 scoring API incomplete");

    console.log("=== 3. LOAD OUTPATIENT SAMPLE ===");

    const sample = page.getByRole("button", {
      name: /Outpatient Clinic Sample/i
    }).first();

    if (await sample.count()) {
      pass("Outpatient Clinic sample button found");
      await sample.click();
      await page.waitForTimeout(250);
    } else {
      fail("Outpatient Clinic sample button missing");
    }

    console.log("=== 4. DISCOVER TARGET ACCOUNT ===");

    const target = await page.evaluate(() => {
      const accounts =
        window.TSMARRecoveryCareer &&
        typeof window.TSMARRecoveryCareer.discoverAccounts === "function"
          ? window.TSMARRecoveryCareer.discoverAccounts()
          : [];

      return accounts.find(a => a.account_id === "101177-G") || null;
    });

    if (!target) {
      fail("Target account 101177-G not discovered");
    } else {
      pass("Target account discovered");
      console.log(
        `         ${target.account_id} | ${target.payer} | $${Number(target.balance).toLocaleString()} | ${target.age_days}d | ${target.aging_bucket}`
      );
    }

    console.log("=== 5. VERIFY EXPECTED RECOVERY ACTION ===");

    const expected = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const accounts = adapter.discoverAccounts();
      const account = accounts.find(a => a.account_id === "101177-G");

      return adapter.expectedRecoveryAction(account);
    });

    console.log("EXPECTED ACTION:", expected.action);
    console.log("EXPECTED URGENCY:", expected.urgency);
    console.log(
      "EXPECTED DOCUMENTATION:",
      JSON.stringify(expected.documentation)
    );

    if (expected.action === "appeal") {
      pass("Expected action: appeal");
    } else {
      fail("Expected action should be appeal");
    }

    if (
      expected.urgency === "HIGH" ||
      expected.urgency === "CRITICAL"
    ) {
      pass("Expected urgency is elevated");
    } else {
      fail("Expected urgency is not elevated");
    }

    if (
      Array.isArray(expected.documentation) &&
      expected.documentation.length >= 2
    ) {
      pass("Documentation requirements present");
    } else {
      fail("Documentation requirements missing");
    }

    console.log("=== 6. SCORE CORRECT ACTION ===");

    const actionScore = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const account = adapter
        .discoverAccounts()
        .find(a => a.account_id === "101177-G");

      return adapter.scoreRecoveryAction(account, "appeal");
    });

    console.log(
      "ACTION SCORE:",
      actionScore.percentage + "%"
    );

    if (
      actionScore.correct === true &&
      actionScore.score === 1
    ) {
      pass("Correct recovery action scored 100%");
    } else {
      fail("Correct recovery action did not score 100%");
    }

    console.log("=== 7. VERIFY WRONG ACTION IS PENALIZED ===");

    const wrongScore = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const account = adapter
        .discoverAccounts()
        .find(a => a.account_id === "101177-G");

      return adapter.scoreRecoveryAction(account, "standard_followup");
    });

    console.log(
      "WRONG ACTION SCORE:",
      wrongScore.percentage + "%"
    );

    if (wrongScore.score < 1) {
      pass("Incorrect action penalized");
    } else {
      fail("Incorrect action received full credit");
    }

    console.log("=== 8. SCORE ACTION REASONING ===");

    const reasoning = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const account = adapter
        .discoverAccounts()
        .find(a => a.account_id === "101177-G");

      return adapter.scoreActionReasoning(
        "This 112-day Aetna medical necessity denial has high financial exposure and an approaching appeal deadline. I would file the clinical appeal now with the clinical notes and supporting medical necessity documentation.",
        account,
        "appeal"
      );
    });

    console.log(
      "REASONING SCORE:",
      reasoning.percentage + "%"
    );

    if (reasoning.score >= 0.75) {
      pass("Recovery reasoning scored strongly");
    } else {
      fail("Recovery reasoning score too low");
    }

    console.log("=== 9. SCORE DOCUMENTATION ===");

    const documentation = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const account = adapter
        .discoverAccounts()
        .find(a => a.account_id === "101177-G");

      return adapter.scoreDocumentation(
        [
          "Clinical notes",
          "Medical necessity or supporting documentation",
          "Payer denial/remittance"
        ],
        account
      );
    });

    console.log(
      "DOCUMENTATION SCORE:",
      documentation.percentage + "%"
    );

    if (documentation.score >= 0.66) {
      pass("Documentation selection scored strongly");
    } else {
      fail("Documentation score too low");
    }

    console.log("=== 10. RECORD AR-ACTION-001 ===");

    const before = await page.evaluate(() => {
      return window.TSMRCMEngine.getState().attempts.length;
    });

    const recorded = await page.evaluate(() => {
      const adapter = window.TSMARRecoveryCareer;
      const account = adapter
        .discoverAccounts()
        .find(a => a.account_id === "101177-G");

      return adapter.recordActionResult({
        account,
        selectedAction: "appeal",
        documentation: [
          "Clinical notes",
          "Medical necessity or supporting documentation",
          "Payer denial/remittance"
        ],
        reasoning:
          "This 112-day Aetna medical necessity denial has high financial exposure and an approaching appeal deadline. I would file the clinical appeal now with the clinical notes and supporting medical necessity documentation."
      });
    });

    const after = await page.evaluate(() => {
      const state = window.TSMRCMEngine.getState();

      return {
        attempts: state.attempts.length,
        scenariosCompleted: state.scenariosCompleted,
        lastAttempts: state.attempts.slice(-3).map(a => ({
          domain: a.domain,
          concept: a.concept,
          competency: a.competency,
          score: a.score,
          scenario: a.scenario
        }))
      };
    });

    console.log(
      "BEFORE ATTEMPTS:",
      before
    );

    console.log(
      "AFTER ATTEMPTS:",
      after.attempts
    );

    console.log(
      "ACTION RESULT:",
      JSON.stringify(recorded, null, 2)
    );

    if (after.attempts >= before + 3) {
      pass("Three AR-ACTION-001 competency attempts recorded");
    } else {
      fail("Expected three competency attempts");
    }

    const competencies =
      after.lastAttempts.map(a => a.competency);

    if (competencies.includes("recovery_strategy")) {
      pass("recovery_strategy recorded");
    } else {
      fail("recovery_strategy not recorded");
    }

    if (competencies.includes("payer_strategy")) {
      pass("payer_strategy recorded");
    } else {
      fail("payer_strategy not recorded");
    }

    if (competencies.includes("documentation")) {
      pass("documentation recorded");
    } else {
      fail("documentation not recorded");
    }

    if (
      after.lastAttempts.every(
        a => a.scenario === "AR-ACTION-001"
      )
    ) {
      pass("All competency attempts tagged AR-ACTION-001");
    } else {
      fail("AR-ACTION-001 scenario tagging incorrect");
    }

    if (
      recorded &&
      recorded.actionScore &&
      recorded.actionScore.score === 1
    ) {
      pass("Recorded recovery action score is 100%");
    } else {
      fail("Recorded recovery action score incorrect");
    }

    console.log("=== 11. VERIFY DECISION RECORD ===");

    if (
      recorded &&
      recorded.recorded === true
    ) {
      pass("Career decision recorded");
    } else {
      fail("Career decision was not recorded");
    }

    console.log("=== 12. BROWSER ERRORS ===");

    if (errors.length === 0) {
      pass("No browser console/page errors detected");
    } else {
      fail(errors.join(" | "));
    }

  } catch (err) {
    fail(err && err.stack ? err.stack : String(err));
  }

  await browser.close();

  console.log();
  console.log("============================================================");
  console.log("AR-ACTION-001 BROWSER TEST COMPLETE");
  console.log("============================================================");
  console.log();

  if (failed) {
    console.log("BROWSER TEST: FAIL");
    process.exit(1);
  }

  console.log("BROWSER TEST: PASS");
})();
NODE

echo
echo "=== 2. RUN AR-ACTION-001 BROWSER TEST ==="

BASE="$BASE" node "$TEST_FILE"
RESULT=$?

echo
echo "============================================================"

if [ "$RESULT" -eq 0 ]; then
  echo "AR-ACTION-001 BROWSER TEST: PASS"
else
  echo "AR-ACTION-001 BROWSER TEST: FAIL"
fi

echo "============================================================"

exit "$RESULT"
