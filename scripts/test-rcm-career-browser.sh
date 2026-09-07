#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

BASE="${BASE:-http://localhost:3000}"
SPEC="$ROOT/.tmp-rcm-career-browser-test.$$.js"

cleanup() {
  rm -f "$SPEC"
}
trap cleanup EXIT

echo "============================================================"
echo "TSM RCM CAREER — AR-QUEUE-001 BROWSER TEST"
echo "============================================================"
echo "ROOT=$ROOT"
echo "BASE=$BASE"
echo

cat > "$SPEC" <<'NODE'
const { chromium } = require("playwright");

(async () => {
  const base = process.env.BASE || "http://localhost:3000";
  const url = `${base}/html/healthcare/ar-recovery-war-room.html`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];

  page.on("console", msg => {
    if (msg.type() === "error") {
      errors.push(`console: ${msg.text()}`);
    }
  });

  page.on("pageerror", err => {
    errors.push(`pageerror: ${err.message}`);
  });

  const fail = (msg) => {
    console.error(`FAIL     ${msg}`);
    process.exitCode = 1;
  };

  try {
    console.log("=== 1. LOAD A/R WAR ROOM ===");

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    if (!response || !response.ok()) {
      fail(
        `Page load returned ${
          response ? response.status() : "NO RESPONSE"
        }`
      );
      return;
    }

    console.log("PASS     A/R War Room loaded");

    console.log("=== 2. CAREER ENGINE / ADAPTER ===");

    const engineReady = await page.evaluate(() =>
      !!window.TSMRCMEngine &&
      typeof window.TSMRCMEngine.getState === "function" &&
      typeof window.TSMRCMEngine.recordAttempt === "function"
    );

    const adapterReady = await page.evaluate(() =>
      !!window.TSMARRecoveryCareer &&
      typeof window.TSMARRecoveryCareer.discoverAccounts === "function" &&
      typeof window.TSMARRecoveryCareer.scoreSelection === "function" &&
      typeof window.TSMARRecoveryCareer.scoreReasoning === "function"
    );

    if (!engineReady) {
      fail("TSMRCMEngine not initialized");
    } else {
      console.log("PASS     TSMRCMEngine initialized");
    }

    if (!adapterReady) {
      fail("TSMARRecoveryCareer not initialized");
    } else {
      console.log("PASS     TSMARRecoveryCareer initialized");
    }

    console.log("=== 3. LOAD OUTPATIENT SAMPLE ===");

    const sampleResult = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];

      const button = buttons.find(b =>
        /outpatient clinic/i.test((b.textContent || "").trim())
      );

      if (!button) {
        return { found: false };
      }

      button.click();

      return {
        found: true,
        text: button.textContent.trim()
      };
    });

    if (!sampleResult.found) {
      fail("Outpatient Clinic sample button not found");
    } else {
      console.log(
        `PASS     Sample button found: ${sampleResult.text}`
      );
    }

    await page.waitForTimeout(500);

    console.log("=== 4. DISCOVER OPERATIONAL ACCOUNTS ===");

    const discovered = await page.evaluate(() => {
      const accounts =
        window.TSMARRecoveryCareer.discoverAccounts();

      return accounts.map(a => ({
        account_id: a.account_id,
        payer: a.payer,
        balance: a.balance,
        age_days: a.age_days,
        aging_bucket: a.aging_bucket,
        recommended_action: a.recommended_action
      }));
    });

    console.log(`FOUND    ${discovered.length} accounts`);

    if (discovered.length < 8) {
      fail(
        `Expected at least 8 outpatient accounts, found ${discovered.length}`
      );
    } else {
      console.log("PASS     Operational queue discovered");
    }

    for (const account of discovered) {
      console.log(
        `         ${account.account_id} | ` +
        `${account.payer} | ` +
        `$${Number(account.balance).toLocaleString()} | ` +
        `${account.age_days}d | ` +
        `${account.aging_bucket}`
      );
    }

    console.log("=== 5. VERIFY EXPECTED TOP 3 ===");

    const expectedTop3 = [
      "100612-A",
      "101177-G",
      "100234-B"
    ];

    const agingMultiplier = days => {
      if (days >= 121) return 3.0;
      if (days >= 91) return 2.2;
      if (days >= 61) return 1.7;
      if (days >= 31) return 1.3;
      return 1.0;
    };

    const top3 = [...discovered]
      .sort((a, b) => {
        const scoreA =
          Number(a.balance) *
          agingMultiplier(Number(a.age_days));

        const scoreB =
          Number(b.balance) *
          agingMultiplier(Number(b.age_days));

        return scoreB - scoreA;
      })
      .slice(0, 3)
      .map(a => a.account_id);

    console.log(`EXPECTED ${expectedTop3.join(", ")}`);
    console.log(`ACTUAL   ${top3.join(", ")}`);

    const correctTop3 =
      expectedTop3.every(id => top3.includes(id)) &&
      top3.length === expectedTop3.length;

    if (!correctTop3) {
      fail(
        "Operational prioritization does not match expected top 3"
      );
    } else {
      console.log("PASS     Top 3 prioritization verified");
    }

    console.log("=== 6. SCORE AR-QUEUE-001 ===");

    const selectionScore = await page.evaluate(ids => {
      const accounts =
        window.TSMARRecoveryCareer.discoverAccounts();

      return window.TSMARRecoveryCareer.scoreSelection(
        accounts,
        ids
      );
    }, expectedTop3);

    console.log(
      `PASS     Selection score: ${selectionScore.score}%`
    );

    if (selectionScore.score < 80) {
      fail(
        `Expected strong selection score, received ${selectionScore.score}%`
      );
    }

    console.log("=== 7. SCORE REASONING ===");

    const reasoning =
      "I would prioritize these accounts because the oldest aging " +
      "accounts create the greatest financial exposure and urgency. " +
      "The 120+ day account is nearing write-off risk, while the " +
      "91-120 day accounts have significant balances and require " +
      "immediate recovery action. I would also consider the root " +
      "cause for each account so the next recovery action matches " +
      "the denial, underpayment, or payer issue.";

    const reasoningScore = await page.evaluate(text => {
      const accounts =
        window.TSMARRecoveryCareer.discoverAccounts();

      return window.TSMARRecoveryCareer.scoreReasoning(
        text,
        accounts
      );
    }, reasoning);

    console.log(
      `PASS     Reasoning score: ${reasoningScore.score}%`
    );

    if (reasoningScore.score < 80) {
      fail(
        `Expected strong reasoning score, received ${reasoningScore.score}%`
      );
    }

    console.log("=== 8. RECORD CAREER RESULT ===");

    const before = await page.evaluate(() =>
      window.TSMRCMEngine.getState()
    );

    const recorded = await page.evaluate(
      ({ ids, reasoning, selectionScore, reasoningScore }) => {
        return window.TSMARRecoveryCareer.recordResult({
          scenario: "AR-QUEUE-001",
          selectedIds: ids,
          reasoning,
          selectionScore,
          reasoningScore
        });
      },
      {
        ids: expectedTop3,
        reasoning,
        selectionScore,
        reasoningScore
      }
    );

    const after = await page.evaluate(() =>
      window.TSMRCMEngine.getState()
    );

    console.log(
      `ATTEMPTS  before=${before.attempts.length} ` +
      `after=${after.attempts.length}`
    );

    if (after.attempts.length <= before.attempts.length) {
      fail("Career attempt was not recorded");
    } else {
      console.log("PASS     Career attempt recorded");
    }

    console.log("=== 9. CAREER PANEL ===");

    const panelExists =
      await page.locator("#tsmRcmCareerPanel").count();

    if (!panelExists) {
      fail("#tsmRcmCareerPanel not found");
    } else {
      console.log("PASS     Career readiness panel exists");
    }

    const scenario = await page.evaluate(() =>
      window.TSM_AR_TRAINING_SCENARIOS &&
      window.TSM_AR_TRAINING_SCENARIOS["AR-QUEUE-001"]
        ? window.TSM_AR_TRAINING_SCENARIOS["AR-QUEUE-001"]
        : null
    );

    if (!scenario) {
      fail(
        "AR-QUEUE-001 training scenario contract unavailable"
      );
    } else {
      console.log(
        "PASS     AR-QUEUE-001 training contract available"
      );
    }

    console.log("=== 10. BROWSER ERRORS ===");

    if (errors.length) {
      console.log("WARNING  Browser reported errors:");

      for (const error of errors) {
        console.log(`         ${error}`);
      }
    } else {
      console.log(
        "PASS     No browser console/page errors detected"
      );
    }

    console.log();
    console.log("============================================================");
    console.log("AR-QUEUE-001 BROWSER TEST COMPLETE");
    console.log("============================================================");

  } finally {
    await browser.close();
  }
})();
NODE

echo "=== 1. VERIFY PLAYWRIGHT ==="

if ! node -e "require.resolve('playwright')" >/dev/null 2>&1; then
  echo "FAIL     Playwright package is not available from repo."
  echo "         Check package.json / node_modules."
  exit 1
fi

echo "PASS     Playwright package available"
echo

echo "=== 2. RUN BROWSER TEST ==="

BASE="$BASE" node "$SPEC"
RESULT=$?

echo
if [ "$RESULT" -eq 0 ]; then
  echo "============================================================"
  echo "BROWSER TEST: PASS"
  echo "============================================================"
else
  echo "============================================================"
  echo "BROWSER TEST: FAIL"
  echo "============================================================"
fi

exit "$RESULT"
