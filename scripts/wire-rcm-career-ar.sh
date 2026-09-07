#!/usr/bin/env bash
set -u

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TARGET="html/healthcare/ar-recovery-war-room.html"
ENGINE="/html/js/career/tsm-rcm-career-engine.js"

echo "============================================================"
echo "TSM RCM CAREER COMMAND — A/R CAREER WIRING"
echo "============================================================"
echo "ROOT=$ROOT"
echo "TARGET=$TARGET"
echo

FAIL=0

fail() {
  echo "FAIL: $1"
  FAIL=1
}

if [ ! -f "$TARGET" ]; then
  fail "Canonical A/R War Room does not exist."
  exit 1
fi

echo "=== 1. VERIFY ENGINE ==="

if [ ! -f "html/js/career/tsm-rcm-career-engine.js" ]; then
  fail "RCM Career Engine missing."
  exit 1
fi

node --check html/js/career/tsm-rcm-career-engine.js || {
  fail "RCM Career Engine syntax invalid."
  exit 1
}

echo "PASS     Career engine exists and parses."

echo
echo "=== 2. CREATE BACKUP ==="

BACKUP="/tmp/ar-recovery-war-room.$(date +%Y%m%d%H%M%S).bak"

cp "$TARGET" "$BACKUP"

echo "BACKUP   $BACKUP"

echo
echo "=== 3. WIRE CAREER ENGINE SCRIPT ==="

python3 - "$TARGET" "$ENGINE" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
engine = sys.argv[2]

text = target.read_text()

needle = f'<script src="{engine}"></script>'

if needle in text:
    print("UNCHANGED  Career engine script already wired.")
    raise SystemExit(0)

markers = [
    '</head>',
    '<body'
]

inserted = False

if '</head>' in text:
    text = text.replace(
        '</head>',
        f'  <script src="{engine}"></script>\n</head>',
        1
    )
    inserted = True

if not inserted:
    print("ERROR: Could not find </head> insertion point.")
    raise SystemExit(1)

target.write_text(text)
print("WIRED      Career engine script.")
PY

if [ "$?" -ne 0 ]; then
  fail "Could not wire career engine."
fi

echo
echo "=== 4. ADD A/R CAREER ADAPTER ==="

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
text = target.read_text()

marker = '/* TSM RCM CAREER ADAPTER START */'

if marker in text:
    print("UNCHANGED  Career adapter already present.")
    raise SystemExit(0)

adapter = r'''
<script>
/* TSM RCM CAREER ADAPTER START */
(function () {
  'use strict';

  /*
   * This adapter belongs to the A/R War Room.
   *
   * It does NOT replace:
   *   - the existing A/R ranking engine
   *   - the existing HC AI pipeline
   *   - CRCR state
   *   - the Career Engine
   *
   * It translates A/R work into career-training evidence.
   */

  function careerEngine() {
    return window.TSMRCMEngine || null;
  }

  function accountId(account) {
    return String(
      account &&
      (
        account.account_id ||
        account.accountId ||
        account.id ||
        account.account ||
        ''
      )
    );
  }

  function normalizeAccount(account) {
    if (!account) return null;

    return {
      account_id: accountId(account),

      payer: account.payer || '',

      balance: Number(
        account.balance ||
        account.amount ||
        0
      ),

      age_days: Number(
        account.age_days ||
        account.ageDays ||
        account.age ||
        account.days ||
        0
      ),

      aging_bucket:
        account.aging_bucket ||
        account.agingBucket ||
        '',

      status:
        account.status ||
        account.reason ||
        account.description ||
        '',

      priority_score:
        Number(
          account.priority_score ||
          account.priorityScore ||
          0
        ),

      recommended_action:
        account.recommended_action ||
        account.recommendedAction ||
        '',

      root_cause:
        account.root_cause ||
        account.rootCause ||
        null
    };
  }

  function getAccounts() {
    /*
     * Try common existing A/R variable names first.
     *
     * We intentionally do not assume a particular implementation.
     */
    var candidates = [
      window.arAccounts,
      window.accounts,
      window.AR_ACCOUNTS,
      window.currentAccounts,
      window.parsedAccounts,
      window.rankedAccounts
    ];

    for (var i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i])) {
        return candidates[i]
          .map(normalizeAccount)
          .filter(function (x) {
            return x && x.account_id;
          });
      }
    }

    return [];
  }

  function scoreSelection(selected, ranked) {
    if (!selected.length || !ranked.length) return 0;

    var top = ranked.slice(0, selected.length)
      .map(function (x) {
        return x.account_id;
      });

    var hits = selected.filter(function (id) {
      return top.indexOf(id) !== -1;
    }).length;

    return hits / selected.length;
  }

  function recordQueueDecision(selectedAccounts, reasoningScore) {
    var engine = careerEngine();

    if (!engine || typeof engine.recordDecision !== 'function') {
      return null;
    }

    var accounts = getAccounts();

    var selected = Array.isArray(selectedAccounts)
      ? selectedAccounts
      : [];

    var ranked = accounts.slice().sort(function (a, b) {
      return (
        Number(b.priority_score || 0) -
        Number(a.priority_score || 0)
      );
    });

    var ids = selected.map(function (item) {
      return typeof item === 'string'
        ? item
        : accountId(item);
    }).filter(Boolean);

    var prioritizationScore =
      scoreSelection(ids, ranked);

    return engine.recordDecision({
      scenario: 'AR-QUEUE-001',

      selectedAccounts: ids,

      reasoningScore:
        reasoningScore == null
          ? prioritizationScore
          : Number(reasoningScore),

      prioritizationScore:
        prioritizationScore,

      recoveryActionScore:
        prioritizationScore,

      source: 'ar_recovery_war_room',

      metadata: {
        accountCount: accounts.length,
        selectedCount: ids.length,
        rankedAccounts: ranked
          .slice(0, 10)
          .map(function (x) {
            return x.account_id;
          })
      }
    });
  }

  function recordRecoveryAction(account, action, score) {
    var engine = careerEngine();

    if (!engine || typeof engine.recordAttempt !== 'function') {
      return null;
    }

    var normalized = normalizeAccount(account);

    return engine.recordAttempt({
      domain: 'ar_recovery',

      concept: 'recovery_action',

      competency: 'recovery_action',

      score:
        score == null
          ? 1
          : Number(score),

      scenario: 'AR-RECOVERY-001',

      source: 'ar_recovery_war_room',

      metadata: {
        account: normalized,
        selected_action: action || '',
        recommended_action:
          normalized &&
          normalized.recommended_action
            ? normalized.recommended_action
            : ''
      }
    });
  }

  function recordTimelyFiling(account, score) {
    var engine = careerEngine();

    if (!engine || typeof engine.recordAttempt !== 'function') {
      return null;
    }

    var normalized = normalizeAccount(account);

    return engine.recordAttempt({
      domain: 'ar_recovery',

      concept: 'timely_filing',

      competency: 'timely_filing',

      score: Number(score == null ? 1 : score),

      scenario: 'AR-TFL-001',

      source: 'ar_recovery_war_room',

      metadata: {
        account: normalized
      }
    });
  }

  function recordAgingAnalysis(account, score) {
    var engine = careerEngine();

    if (!engine || typeof engine.recordAttempt !== 'function') {
      return null;
    }

    var normalized = normalizeAccount(account);

    return engine.recordAttempt({
      domain: 'ar_recovery',

      concept: 'aging_analysis',

      competency: 'aging_analysis',

      score: Number(score == null ? 1 : score),

      scenario: 'AR-AGING-001',

      source: 'ar_recovery_war_room',

      metadata: {
        account: normalized
      }
    });
  }

  function readiness() {
    var engine = careerEngine();

    if (!engine || typeof engine.getReadiness !== 'function') {
      return null;
    }

    return engine.getReadiness();
  }

  /*
   * Public adapter.
   */
  window.TSMRCMCAREER = window.TSMRCMCAREER || {
    version: '1.0.0',

    getAccounts: getAccounts,

    recordQueueDecision: recordQueueDecision,

    recordRecoveryAction: recordRecoveryAction,

    recordTimelyFiling: recordTimelyFiling,

    recordAgingAnalysis: recordAgingAnalysis,

    readiness: readiness
  };

  /*
   * Convenience diagnostics.
   */
  window.TSMRCMCAREER_STATUS = function () {
    var data = readiness();

    console.log(
      '[TSM RCM CAREER]',
      data || 'Career engine unavailable'
    );

    return data;
  };

})();
 /* TSM RCM CAREER ADAPTER END */
</script>
'''

# Put adapter immediately before </body>.
if '</body>' not in text:
    print("ERROR: Could not find </body>.")
    raise SystemExit(1)

text = text.replace(
    '</body>',
    adapter + '\n</body>',
    1
)

target.write_text(text)

print("WIRED      A/R Career Adapter.")
PY

if [ "$?" -ne 0 ]; then
  fail "Could not add A/R career adapter."
fi

echo
echo "=== 5. ADD TRAINING SCENARIO CONTRACT ==="

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
text = target.read_text()

marker = '/* TSM AR TRAINING CONTRACT START */'

if marker in text:
    print("UNCHANGED  Training contract already present.")
    raise SystemExit(0)

block = r'''
<script>
/* TSM AR TRAINING CONTRACT START */
(function () {
  'use strict';

  /*
   * Canonical A/R training scenario definitions.
   *
   * These are synthetic training scenarios.
   * They are not production patient/account records.
   */

  window.TSM_AR_TRAINING_SCENARIOS =
    window.TSM_AR_TRAINING_SCENARIOS || {

      queue: {
        id: 'AR-QUEUE-001',

        title: 'Prioritize the Recovery Queue',

        competency: 'ar_prioritization',

        instruction:
          'You have a portfolio of aged A/R accounts. Select the accounts you would work first and explain why.',

        scoring: [
          'aging risk',
          'financial exposure',
          'payer response',
          'recovery opportunity',
          'timely filing risk'
        ]
      },

      aging: {
        id: 'AR-AGING-001',

        title: 'Identify Aging Risk',

        competency: 'aging_analysis',

        instruction:
          'Review account age and determine which balances require immediate escalation.'
      },

      recovery: {
        id: 'AR-RECOVERY-001',

        title: 'Choose the Recovery Action',

        competency: 'recovery_action',

        instruction:
          'Review the account status and select the most appropriate recovery action.'
      },

      timelyFiling: {
        id: 'AR-TFL-001',

        title: 'Protect the Appeal Window',

        competency: 'timely_filing',

        instruction:
          'Identify accounts where filing deadlines create immediate recovery risk.'
      }
    };

})();
 /* TSM AR TRAINING CONTRACT END */
</script>
'''

if '</body>' not in text:
    print("ERROR: Missing </body>.")
    raise SystemExit(1)

text = text.replace(
    '</body>',
    block + '\n</body>',
    1
)

target.write_text(text)

print("ADDED      A/R training scenario contract.")
PY

if [ "$?" -ne 0 ]; then
  fail "Could not add training scenario contract."
fi

echo
echo "=== 6. ADD CAREER READINESS CONSOLE PANEL ==="

python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys

target = Path(sys.argv[1])
text = target.read_text()

marker = 'id="tsmRcmCareerPanel"'

if marker in text:
    print("UNCHANGED  Career readiness panel already present.")
    raise SystemExit(0)

panel = r'''
<!-- TSM RCM CAREER READINESS PANEL -->
<section
  id="tsmRcmCareerPanel"
  style="
    margin:24px 0;
    padding:18px;
    border:1px solid rgba(90,180,220,.28);
    border-radius:12px;
    background:rgba(8,18,28,.72);
  "
>
  <div style="
    font-size:12px;
    font-weight:800;
    letter-spacing:.12em;
    color:#7dd3fc;
    margin-bottom:6px;
  ">
    TSM CAREER COMMAND · RCM READINESS
  </div>

  <div style="
    font-size:12px;
    color:rgba(210,225,235,.72);
    margin-bottom:14px;
  ">
    A/R Recovery evidence feeds practical competency scoring without
    replacing the existing CRCR mastery system.
  </div>

  <div
    id="tsmRcmCareerReadiness"
    style="
      display:grid;
      grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
      gap:10px;
    "
  >
    <div class="tsm-rcm-career-card">
      <div class="tsm-rcm-career-label">A/R PRACTICAL</div>
      <div id="tsmRcmArScore" class="tsm-rcm-career-value">—</div>
    </div>

    <div class="tsm-rcm-career-card">
      <div class="tsm-rcm-career-label">OVERALL RCM</div>
      <div id="tsmRcmOverallScore" class="tsm-rcm-career-value">—</div>
    </div>

    <div class="tsm-rcm-career-card">
      <div class="tsm-rcm-career-label">SCENARIOS</div>
      <div id="tsmRcmScenarioCount" class="tsm-rcm-career-value">0</div>
    </div>

    <div class="tsm-rcm-career-card">
      <div class="tsm-rcm-career-label">LAST ACTIVITY</div>
      <div id="tsmRcmLastActivity" class="tsm-rcm-career-value">—</div>
    </div>
  </div>
</section>

<style>
.tsm-rcm-career-card {
  padding:12px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:8px;
  background:rgba(255,255,255,.025);
}

.tsm-rcm-career-label {
  font-size:9px;
  letter-spacing:.1em;
  color:rgba(200,215,225,.55);
  margin-bottom:5px;
}

.tsm-rcm-career-value {
  font-size:20px;
  font-weight:800;
  font-family:monospace;
  color:#e5f7ff;
}
</style>

<script>
(function () {
  'use strict';

  function pct(value) {
    if (value == null || !Number.isFinite(Number(value))) {
      return '—';
    }

    return Math.round(Number(value) * 100) + '%';
  }

  function refreshRcmCareerReadiness() {
    var engine = window.TSMRCMEngine;

    if (!engine || typeof engine.getReadiness !== 'function') {
      return;
    }

    var readiness = engine.getReadiness();

    var practical =
      readiness &&
      readiness.practical
        ? readiness.practical.score
        : null;

    var overall =
      readiness
        ? readiness.overall
        : null;

    var scenarioCount =
      readiness
        ? Number(readiness.scenariosCompleted || 0)
        : 0;

    var lastActivity =
      readiness &&
      readiness.lastActivity
        ? readiness.lastActivity
        : null;

    var arEl =
      document.getElementById('tsmRcmArScore');

    var overallEl =
      document.getElementById('tsmRcmOverallScore');

    var countEl =
      document.getElementById('tsmRcmScenarioCount');

    var lastEl =
      document.getElementById('tsmRcmLastActivity');

    if (arEl) {
      arEl.textContent = pct(practical);
    }

    if (overallEl) {
      overallEl.textContent = pct(overall);
    }

    if (countEl) {
      countEl.textContent = String(scenarioCount);
    }

    if (lastEl) {
      lastEl.textContent =
        lastActivity
          ? new Date(lastActivity).toLocaleDateString()
          : '—';
    }
  }

  window.TSMRefreshRCMCareerReadiness =
    refreshRcmCareerReadiness;

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      refreshRcmCareerReadiness
    );
  } else {
    refreshRcmCareerReadiness();
  }

})();
</script>
'''

# Insert before first major footer/body boundary.
if '</body>' not in text:
    print("ERROR: Missing </body>.")
    raise SystemExit(1)

text = text.replace(
    '</body>',
    panel + '\n</body>',
    1
)

target.write_text(text)

print("ADDED      Career readiness panel.")
PY

if [ "$?" -ne 0 ]; then
  fail "Could not add readiness panel."
fi

echo
echo "=== 7. SYNTAX VALIDATION ==="

node --check "$TARGET" >/dev/null 2>&1
if [ "$?" -eq 0 ]; then
  echo "PASS     Node HTML syntax extraction check"
else
  echo "INFO     Direct node --check on HTML is not applicable."
  echo "         Validating embedded JavaScript blocks instead."

  python3 - "$TARGET" <<'PY'
from pathlib import Path
import re
import subprocess
import tempfile
import sys

text = Path(sys.argv[1]).read_text()

scripts = re.findall(
    r'<script(?:\s[^>]*)?>(.*?)</script>',
    text,
    flags=re.I | re.S
)

failed = False
count = 0

for i, script in enumerate(scripts, 1):
    if not script.strip():
        continue

    count += 1

    with tempfile.NamedTemporaryFile(
        'w',
        suffix='.js',
        delete=False
    ) as f:
        f.write(script)
        path = f.name

    result = subprocess.run(
        ['node', '--check', path],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        print("FAIL JS BLOCK", i)
        print(result.stderr)
        failed = True

if failed:
    raise SystemExit(1)

print("PASS     Embedded JS blocks:", count)
PY

  if [ "$?" -ne 0 ]; then
    fail "Embedded JavaScript validation failed."
  fi
fi

echo
echo "=== 8. VERIFY WIRING ==="

grep -nE \
  "tsm-rcm-career-engine|TSMRCMCAREER|TSMRCMEngine|TSM_AR_TRAINING_SCENARIOS|tsmRcmCareerPanel" \
  "$TARGET" \
  | head -120

echo
echo "=== 9. GIT DIFF CHECK ==="

git diff --check

if [ "$?" -ne 0 ]; then
  fail "git diff --check failed."
else
  echo "PASS     git diff --check"
fi

echo
echo "=== 10. SHOW OUR CHANGES ==="

git status --short -- \
  "$TARGET" \
  "html/js/career/tsm-rcm-career-engine.js" \
  "scripts/wire-rcm-career-ar.sh"

echo
echo "--- diff stat ---"

git diff --stat -- \
  "$TARGET" \
  "html/js/career/tsm-rcm-career-engine.js" \
  "scripts/wire-rcm-career-ar.sh"

echo
echo "--- career wiring diff ---"

git diff -- "$TARGET" | tail -220

echo
echo "============================================================"

if [ "$FAIL" -ne 0 ]; then
  echo "PHASE FAILED"
  echo
  echo "Backup preserved at:"
  echo "$BACKUP"
  exit 1
fi

echo "PHASE 2 A/R CAREER WIRING COMPLETE"
echo
echo "Canonical A/R:"
echo "  $TARGET"
echo
echo "Career engine:"
echo "  html/js/career/tsm-rcm-career-engine.js"
echo
echo "Next:"
echo "  TRAIN → PRACTICE → RECOVER"
echo "  1. Add interactive account-selection scenario"
echo "  2. Score prioritization reasoning"
echo "  3. Score recovery-action selection"
echo "  4. Feed evidence into Career Command Center"
echo "============================================================"
