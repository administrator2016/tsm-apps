#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TARGET="html/healthcare/ar-recovery-war-room.html"
ADAPTER="html/js/career/tsm-ar-recovery-career-adapter.js"

echo "============================================================"
echo "TSM RCM CAREER COMMAND — PHASE 3"
echo "A/R INTERACTIVE COMPETENCY SCENARIO"
echo "============================================================"
echo "ROOT=$ROOT"
echo "TARGET=$TARGET"
echo

fail() {
  echo "FAIL     $1"
  exit 1
}

echo "=== 1. VERIFY PHASE 2 FOUNDATION ==="

[[ -f "$TARGET" ]] || fail "Canonical A/R War Room missing."
[[ -f "html/js/career/tsm-rcm-career-engine.js" ]] || fail "Career engine missing."

grep -q 'tsm-rcm-career-engine.js' "$TARGET" \
  || fail "Career engine is not wired into A/R War Room."

grep -q 'TSMRCMCAREER' "$TARGET" \
  || fail "Phase 2 career wiring not detected."

echo "PASS     Phase 2 foundation detected."
echo

echo "=== 2. CREATE BACKUP ==="

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP="/tmp/ar-recovery-war-room.phase3.${STAMP}.bak"

cp "$TARGET" "$BACKUP" \
  || fail "Could not create backup."

echo "BACKUP   $BACKUP"
echo

echo "=== 3. CREATE A/R CAREER ADAPTER ==="

mkdir -p "$(dirname "$ADAPTER")"

cat > "$ADAPTER" <<'JS'
(function (global) {
  'use strict';

  /*
   * TSM A/R RECOVERY CAREER ADAPTER
   *
   * Purpose:
   *   Thin training adapter between the operational A/R War Room
   *   and the shared TSM RCM Career Engine.
   *
   * Architecture:
   *
   *   A/R War Room
   *        |
   *        v
   *   TSMARRecoveryCareer
   *        |
   *        v
   *   TSMRCMEngine
   *
   * This adapter owns NO separate persistence layer.
   */

  var VERSION = '1.0.0';

  var SCENARIO = {
    id: 'AR-QUEUE-001',
    title: 'A/R Recovery Queue Prioritization',
    domain: 'ar_recovery',
    competency: 'prioritization',
    prompt:
      'You have an A/R recovery queue. Select the three accounts you would work first and explain why.',
    competencies: [
      'ar_prioritization',
      'aging_analysis',
      'financial_exposure',
      'recovery_strategy',
      'payer_strategy',
      'reasoning'
    ]
  };

  function engine() {
    return global.TSMRCMEngine || null;
  }

  function money(value) {
    var n = Number(value) || 0;
    return '$' + n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  }

  function normalize(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseMoney(text) {
    var cleaned = String(text || '')
      .replace(/[$,\s]/g, '')
      .replace(/[^\d.-]/g, '');

    var value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : 0;
  }

  function parseAge(text) {
    var match = String(text || '').match(/(\d{1,4})/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function agingBucket(days) {
    if (days <= 30) return '0-30';
    if (days <= 60) return '31-60';
    if (days <= 90) return '61-90';
    if (days <= 120) return '91-120';
    return '120+';
  }

  function agingMultiplier(days) {
    if (days <= 30) return 1.0;
    if (days <= 60) return 1.3;
    if (days <= 90) return 1.7;
    if (days <= 120) return 2.2;
    return 3.0;
  }

  function priorityScore(account) {
    return (Number(account.balance) || 0) *
           agingMultiplier(Number(account.age_days) || 0);
  }

  /*
   * Discover the operational A/R queue without requiring the War Room
   * to adopt another storage system.
   */
  function discoverAccounts() {
    var tables = Array.prototype.slice.call(
      document.querySelectorAll('table')
    );

    for (var t = 0; t < tables.length; t++) {
      var table = tables[t];

      var headerRow = table.querySelector('thead tr') ||
                      table.querySelector('tr');

      if (!headerRow) continue;

      var headers = Array.prototype.slice.call(
        headerRow.querySelectorAll('th,td')
      ).map(function (cell) {
        return normalize(cell.textContent).toLowerCase();
      });

      var accountIndex = headers.findIndex(function (h) {
        return h.indexOf('account') >= 0 ||
               h.indexOf('mrn') >= 0;
      });

      var payerIndex = headers.findIndex(function (h) {
        return h.indexOf('payer') >= 0 ||
               h.indexOf('insurer') >= 0;
      });

      var balanceIndex = headers.findIndex(function (h) {
        return h.indexOf('balance') >= 0 ||
               h.indexOf('amount') >= 0;
      });

      var agingIndex = headers.findIndex(function (h) {
        return h.indexOf('aging') >= 0 ||
               h.indexOf('age') >= 0 ||
               h.indexOf('days') >= 0;
      });

      if (accountIndex < 0 || balanceIndex < 0 || agingIndex < 0) {
        continue;
      }

      var rows = Array.prototype.slice.call(
        table.querySelectorAll('tbody tr')
      );

      if (!rows.length) {
        rows = Array.prototype.slice.call(table.querySelectorAll('tr'))
          .slice(1);
      }

      var accounts = [];

      rows.forEach(function (row) {
        var cells = Array.prototype.slice.call(
          row.querySelectorAll('td')
        );

        if (!cells.length) return;

        var accountId = normalize(
          cells[accountIndex] ? cells[accountIndex].textContent : ''
        );

        var payer = normalize(
          cells[payerIndex] ? cells[payerIndex].textContent : ''
        );

        var balance = parseMoney(
          cells[balanceIndex] ? cells[balanceIndex].textContent : ''
        );

        var ageDays = parseAge(
          cells[agingIndex] ? cells[agingIndex].textContent : ''
        );

        if (!accountId || !balance || !ageDays) return;

        var status = cells.length
          ? normalize(cells[cells.length - 1].textContent)
          : '';

        accounts.push({
          account_id: accountId,
          payer: payer,
          balance: balance,
          age_days: ageDays,
          aging_bucket: agingBucket(ageDays),
          priority_score: priorityScore({
            balance: balance,
            age_days: ageDays
          }),
          status: status
        });
      });

      if (accounts.length) return accounts;
    }

    /*
     * Fallback: allow the operational page to expose its queue directly
     * if it already has one of these globals.
     */
    var candidates = [
      global.TSM_AR_RECOVERY_QUEUE,
      global.arRecoveryQueue,
      global.arAccounts,
      global.accounts
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i]) && candidates[i].length) {
        return candidates[i].map(function (a) {
          var copy = Object.assign({}, a);

          copy.account_id =
            copy.account_id ||
            copy.accountId ||
            copy.id ||
            '';

          copy.balance =
            Number(copy.balance) ||
            Number(copy.amount) ||
            0;

          copy.age_days =
            Number(copy.age_days) ||
            Number(copy.ageDays) ||
            Number(copy.age) ||
            0;

          copy.priority_score =
            Number(copy.priority_score) ||
            priorityScore(copy);

          return copy;
        });
      }
    }

    return [];
  }

  function expectedRanking(accounts) {
    return accounts
      .slice()
      .sort(function (a, b) {
        return Number(b.priority_score || 0) -
               Number(a.priority_score || 0);
      });
  }

  function scoreSelection(accounts, selectedIds) {
    var selected = selectedIds
      .map(function (id) {
        return normalize(id).toLowerCase();
      })
      .filter(Boolean);

    var ranking = expectedRanking(accounts);

    var topIds = ranking
      .slice(0, 3)
      .map(function (a) {
        return normalize(a.account_id).toLowerCase();
      });

    var hits = 0;

    selected.forEach(function (id) {
      if (topIds.indexOf(id) >= 0) hits++;
    });

    /*
     * Core prioritization score:
     *   3/3 correct = 100
     *   2/3         = 80
     *   1/3         = 60
     *   0/3         = 40
     *
     * We intentionally avoid requiring the exact same ordering because
     * a real RCM professional may reasonably reorder two high-risk cases.
     */
    var base = 40 + (hits * 20);

    /*
     * Reward selecting genuinely high-exposure accounts even when the
     * exact top three differ.
     */
    var selectedAccounts = accounts.filter(function (a) {
      return selected.indexOf(
        normalize(a.account_id).toLowerCase()
      ) >= 0;
    });

    var selectedExposure = selectedAccounts.reduce(function (sum, a) {
      return sum + (Number(a.priority_score) || 0);
    }, 0);

    var topExposure = ranking.slice(0, 3).reduce(function (sum, a) {
      return sum + (Number(a.priority_score) || 0);
    }, 0);

    var exposureRatio = topExposure
      ? Math.min(selectedExposure / topExposure, 1)
      : 0;

    var score = Math.round(
      Math.min(100, base * 0.70 + exposureRatio * 30)
    );

    return {
      score: score,
      hits: hits,
      selected: selectedAccounts,
      expected: ranking.slice(0, 3),
      selectedExposure: selectedExposure,
      expectedExposure: topExposure
    };
  }

  function scoreReasoning(text, selectedAccounts) {
    var reasoning = normalize(text).toLowerCase();

    if (!reasoning) {
      return {
        score: 0,
        matched: []
      };
    }

    var concepts = [
      {
        name: 'aging',
        terms: ['aging', 'aged', 'days', '120', '91', '90']
      },
      {
        name: 'financial exposure',
        terms: ['balance', 'dollar', 'exposure', 'amount', 'revenue']
      },
      {
        name: 'urgency',
        terms: ['deadline', 'timely filing', 'write-off', 'urgent', 'risk']
      },
      {
        name: 'root cause',
        terms: ['denial', 'authorization', 'underpaid', 'eligibility', 'cob', 'duplicate']
      },
      {
        name: 'recovery',
        terms: ['recover', 'appeal', 'dispute', 'rebill', 'escalate', 'collect']
      }
    ];

    var matched = [];

    concepts.forEach(function (concept) {
      var found = concept.terms.some(function (term) {
        return reasoning.indexOf(term) >= 0;
      });

      if (found) matched.push(concept.name);
    });

    /*
     * 5 concepts = 100.
     * Minimum meaningful reasoning starts at 20.
     */
    var score = Math.min(100, matched.length * 20);

    if (selectedAccounts.length >= 3 && matched.length >= 3) {
      score = Math.min(100, score + 5);
    }

    return {
      score: score,
      matched: matched
    };
  }

  function recordResult(result) {
    var api = engine();

    if (!api) return false;

    if (typeof api.recordAttempt === 'function') {
      api.recordAttempt({
        domain: 'ar_recovery',
        concept: 'prioritization',
        competency: 'ar_prioritization',
        score: result.prioritizationScore / 100,
        scenario: SCENARIO.id
      });

      api.recordAttempt({
        domain: 'ar_recovery',
        concept: 'reasoning',
        competency: 'reasoning',
        score: result.reasoningScore / 100,
        scenario: SCENARIO.id
      });
    }

    if (typeof api.recordDecision === 'function') {
      api.recordDecision({
        scenario: SCENARIO.id,
        selectedAccounts: result.selectedIds,
        reasoningScore: result.reasoningScore / 100,
        recoveryActionScore: result.prioritizationScore / 100
      });
    }

    return true;
  }

  function getReadiness() {
    var api = engine();

    if (!api || typeof api.getReadiness !== 'function') {
      return null;
    }

    try {
      return api.getReadiness();
    } catch (err) {
      return null;
    }
  }

  function renderResult(container, result) {
    var readiness = getReadiness();

    var matchedText = result.reasoningMatched.length
      ? result.reasoningMatched.join(', ')
      : 'No core reasoning concepts detected yet.';

    var expected = result.expected.map(function (a) {
      return a.account_id;
    }).join(', ');

    container.innerHTML =
      '<div class="tsm-ar-career-result">' +
        '<div style="font-weight:800;font-size:18px;margin-bottom:10px;">' +
          'Scenario Result' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:12px;">' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">PRIORITIZATION</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.prioritizationScore + '%' +
            '</div>' +
          '</div>' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">REASONING</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.reasoningScore + '%' +
            '</div>' +
          '</div>' +

          '<div style="padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;">' +
            '<div style="font-size:11px;opacity:.7;">TOP-3 MATCHES</div>' +
            '<div style="font-size:24px;font-weight:800;">' +
              result.hits + '/3' +
            '</div>' +
          '</div>' +

        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Expected high-priority accounts:</strong> ' +
          expected +
        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Reasoning concepts detected:</strong> ' +
          matchedText +
        '</div>' +

        '<div style="margin:8px 0;">' +
          '<strong>Decision recorded:</strong> ' +
          (result.recorded ? 'YES' : 'NO') +
        '</div>' +

        (readiness
          ? '<div style="margin-top:12px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);">' +
              '<strong>Career readiness updated.</strong>' +
              '<div style="margin-top:4px;font-size:12px;opacity:.75;">' +
                'The result has been fed into the shared TSM RCM Career Engine.' +
              '</div>' +
            '</div>'
          : '') +

      '</div>';
  }

  function render(container) {
    if (!container) return;

    var accounts = discoverAccounts();

    container.innerHTML =
      '<div class="tsm-ar-career-practice" style="margin-top:14px;">' +

        '<div style="font-size:12px;letter-spacing:.08em;opacity:.7;">' +
          'CAREER PRACTICE · AR-QUEUE-001' +
        '</div>' +

        '<h3 style="margin:6px 0 8px;">A/R Recovery Queue Prioritization</h3>' +

        '<p style="margin:0 0 12px;line-height:1.5;">' +
          SCENARIO.prompt +
          ' Use balance, aging, urgency, root cause, and recovery opportunity—not just the largest balance.' +
        '</p>' +

        '<div style="margin-bottom:12px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);">' +
          '<strong>Accounts available:</strong> ' +
          accounts.length +
          (accounts.length
            ? ' · Live queue detected.'
            : ' · Load an A/R sample or queue first.') +
        '</div>' +

        '<label style="display:block;font-weight:700;margin-bottom:5px;">' +
          'Select your top 3 account IDs' +
        '</label>' +

        '<input id="tsmArCareerSelection" type="text" ' +
          'placeholder="Example: MRN-89144, MRN-88450, MRN-88213" ' +
          'style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:12px;" />' +

        '<label style="display:block;font-weight:700;margin-bottom:5px;">' +
          'Why did you choose these accounts?' +
        '</label>' +

        '<textarea id="tsmArCareerReasoning" rows="5" ' +
          'placeholder="Explain your prioritization using aging, balance/exposure, urgency, root cause, and recovery strategy..." ' +
          'style="width:100%;box-sizing:border-box;padding:10px;margin-bottom:12px;"></textarea>' +

        '<button id="tsmArCareerScoreBtn" type="button" ' +
          'style="cursor:pointer;padding:10px 16px;font-weight:800;">' +
          'Score My Decision' +
        '</button>' +

        '<div id="tsmArCareerResult" style="margin-top:14px;"></div>' +

      '</div>';

    var scoreButton =
      document.getElementById('tsmArCareerScoreBtn');

    if (!scoreButton) return;

    scoreButton.addEventListener('click', function () {
      var selectionInput =
        document.getElementById('tsmArCareerSelection');

      var reasoningInput =
        document.getElementById('tsmArCareerReasoning');

      var resultContainer =
        document.getElementById('tsmArCareerResult');

      var selectedIds = normalize(
        selectionInput ? selectionInput.value : ''
      )
        .split(',')
        .map(function (id) { return normalize(id); })
        .filter(Boolean)
        .slice(0, 3);

      var reasoning =
        reasoningInput ? reasoningInput.value : '';

      if (selectedIds.length !== 3) {
        resultContainer.innerHTML =
          '<div style="padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);">' +
            '<strong>Select exactly 3 accounts.</strong>' +
          '</div>';
        return;
      }

      var selectionResult =
        scoreSelection(accounts, selectedIds);

      var reasoningResult =
        scoreReasoning(reasoning, selectionResult.selected);

      var result = {
        selectedIds: selectedIds,
        selected: selectionResult.selected,
        expected: selectionResult.expected,
        hits: selectionResult.hits,
        prioritizationScore: selectionResult.score,
        reasoningScore: reasoningResult.score,
        reasoningMatched: reasoningResult.matched,
        recorded: false
      };

      result.recorded = recordResult(result);

      renderResult(resultContainer, result);
    });
  }

  function mount() {
    var existing =
      document.getElementById('tsmRcmCareerPanel');

    if (!existing) return false;

    if (document.getElementById('tsmArCareerPractice')) {
      return true;
    }

    var section = document.createElement('section');

    section.id = 'tsmArCareerPractice';

    section.style.cssText =
      'margin-top:18px;padding:16px;border-radius:10px;' +
      'border:1px solid rgba(255,255,255,.14);';

    existing.appendChild(section);

    render(section);

    return true;
  }

  global.TSMARRecoveryCareer = {
    version: VERSION,
    scenario: SCENARIO,
    discoverAccounts: discoverAccounts,
    scoreSelection: scoreSelection,
    scoreReasoning: scoreReasoning,
    getReadiness: getReadiness,
    mount: mount
  };

  function boot() {
    if (mount()) return;

    /*
     * The A/R page may render its career panel after initial load.
     * Retry briefly without creating a permanent polling loop.
     */
    var attempts = 0;

    var timer = setInterval(function () {
      attempts++;

      if (mount() || attempts >= 20) {
        clearInterval(timer);
      }
    }, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(window);
JS

echo "CREATED  $ADAPTER"
echo

echo "=== 4. WIRE ADAPTER INTO CANONICAL A/R ==="

python3 - <<'PY'
from pathlib import Path
import re

target = Path("html/healthcare/ar-recovery-war-room.html")
text = target.read_text(encoding="utf-8")

adapter_src = "/html/js/career/tsm-ar-recovery-career-adapter.js"

if adapter_src in text:
    print("EXISTS   A/R Career Adapter already wired.")
else:
    matches = list(re.finditer(
        r'<script[^>]+tsm-rcm-career-engine\.js[^>]*>\s*</script>',
        text,
        flags=re.I
    ))

    if not matches:
        raise SystemExit(
            "FAIL: Could not find existing TSM RCM Career Engine script tag."
        )

    match = matches[-1]
    insertion = (
        match.group(0)
        + "\n"
        + '  <script src="' + adapter_src + '"></script>'
    )

    text = text[:match.start()] + insertion + text[match.end():]

    target.write_text(text, encoding="utf-8")
    print("WIRED    A/R Career Adapter.")
PY

echo

echo "=== 5. VALIDATE ADAPTER SYNTAX ==="

node --check "$ADAPTER" \
  || fail "A/R Career Adapter syntax validation failed."

echo "PASS     Adapter syntax."
echo

echo "=== 6. VERIFY INTERACTIVE CONTRACT ==="

for token in \
  "AR-QUEUE-001" \
  "TSMARRecoveryCareer" \
  "discoverAccounts" \
  "scoreSelection" \
  "scoreReasoning" \
  "recordDecision" \
  "recordAttempt" \
  "tsmArCareerSelection" \
  "tsmArCareerReasoning" \
  "tsmArCareerScoreBtn" \
  "tsmArCareerResult"
do
  if grep -q "$token" "$ADAPTER"; then
    echo "FOUND    $token"
  else
    fail "Missing adapter contract: $token"
  fi
done

echo "PASS     Interactive scenario contract."
echo

echo "=== 7. VERIFY HTML WIRING ==="

grep -n -E \
  'tsm-rcm-career-engine|tsm-ar-recovery-career-adapter|tsmRcmCareerPanel|TSMRCMCAREER' \
  "$TARGET" \
  | head -40

echo

echo "=== 8. EMBEDDED SCRIPT VALIDATION ==="

python3 - <<'PY'
from pathlib import Path
import re
import subprocess
import tempfile

p = Path("html/healthcare/ar-recovery-war-room.html")
text = p.read_text(encoding="utf-8")

blocks = re.findall(
    r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',
    text,
    flags=re.I | re.S
)

print(f"FOUND    {len(blocks)} embedded JavaScript blocks")

failed = 0

for i, block in enumerate(blocks, 1):
    if not block.strip():
        continue

    with tempfile.NamedTemporaryFile(
        "w",
        suffix=".js",
        delete=False,
        encoding="utf-8"
    ) as tmp:
        tmp.write(block)
        name = tmp.name

    result = subprocess.run(
        ["node", "--check", name],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        failed += 1
        print(f"FAIL     Embedded JS block {i}")
        print(result.stderr.strip())
    else:
        print(f"PASS     Embedded JS block {i}")

if failed:
    raise SystemExit(1)
PY

echo

echo "=== 9. GIT DIFF CHECK ==="

git diff --check \
  || fail "git diff --check failed."

echo "PASS     git diff --check."
echo

echo "=== 10. SHOW PHASE 3 FILES ==="

git status --short

echo
echo "--- adapter stats ---"
wc -l "$ADAPTER"

echo
echo "--- relevant A/R wiring ---"
grep -n -E \
  'tsm-rcm-career-engine|tsm-ar-recovery-career-adapter' \
  "$TARGET"

echo
echo "============================================================"
echo "PHASE 3 A/R INTERACTIVE CAREER SCENARIO COMPLETE"
echo "============================================================"
echo
echo "TRAIN:"
echo "  A/R prioritization concepts"
echo
echo "PRACTICE:"
echo "  AR-QUEUE-001"
echo "  Select exactly 3 accounts"
echo "  Explain your reasoning"
echo
echo "RECOVER:"
echo "  Prioritization score"
echo "  Reasoning score"
echo "  Shared TSM RCM Career Engine evidence"
echo
echo "NEXT:"
echo "  1. Run the A/R War Room in browser"
echo "  2. Load the outpatient/hospital sample"
echo "  3. Complete AR-QUEUE-001"
echo "  4. Verify Career readiness updates"
echo "  5. Then add recovery-action scenario AR-ACTION-001"
echo "============================================================"
