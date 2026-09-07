#!/usr/bin/env bash
set -euo pipefail

cd /workspaces/tsm-apps

CAREER="html/tsm-career-training-platform.html"
ADAPTER="html/js/career/tsm-revenue-leakage-career-adapter.js"
ENGINE="html/js/career/tsm-rcm-career-engine.js"
PROGRESSION="html/js/career/tsm-rcm-career-progression.js"

echo "============================================================"
echo "TSM — LOAD LEAKAGE-001 CAREER ADAPTER"
echo "============================================================"
echo

for f in "$CAREER" "$ADAPTER" "$ENGINE" "$PROGRESSION"; do
  if [[ ! -f "$f" ]]; then
    echo "FAIL: missing $f"
    exit 1
  fi
done

echo "PASS: required files exist"

python3 - "$CAREER" "$ADAPTER" "$ENGINE" "$PROGRESSION" <<'PY'
from pathlib import Path
import sys

career = Path(sys.argv[1])
adapter = Path(sys.argv[2])
engine = Path(sys.argv[3])
progression = Path(sys.argv[4])

text = career.read_text()

adapter_src = "/html/js/career/tsm-revenue-leakage-career-adapter.js"
engine_src = "/html/js/career/tsm-rcm-career-engine.js"
progression_src = "/html/js/career/tsm-rcm-career-progression.js"

# ------------------------------------------------------------
# 1. Ensure the adapter isn't already loaded.
# ------------------------------------------------------------
count = text.count(adapter_src)

if count > 1:
    raise SystemExit(
        f"FAIL: duplicate Leakage adapter references already exist ({count})"
    )

if count == 1:
    print("PASS: Leakage adapter already loaded")
    raise SystemExit(0)

# ------------------------------------------------------------
# 2. Prefer insertion immediately after the canonical RCM engine.
# ------------------------------------------------------------
engine_tag = f'<script src="{engine_src}"></script>'

if engine_tag in text:
    insertion = (
        engine_tag
        + "\n"
        + f'<script src="{adapter_src}"></script>'
    )

    text = text.replace(engine_tag, insertion, 1)
    career.write_text(text)

    print("PASS: inserted Leakage adapter after RCM engine")
    raise SystemExit(0)

# ------------------------------------------------------------
# 3. Fallback: insert immediately before progression.
# ------------------------------------------------------------
progression_tag = f'<script src="{progression_src}"></script>'

if progression_tag in text:
    insertion = (
        f'<script src="{adapter_src}"></script>'
        + "\n"
        + progression_tag
    )

    text = text.replace(progression_tag, insertion, 1)
    career.write_text(text)

    print("PASS: inserted Leakage adapter before progression")
    raise SystemExit(0)

raise SystemExit(
    "FAIL: could not find canonical RCM engine or progression script tag"
)
PY

echo
echo "=== 1. SCRIPT LOAD ORDER ==="

grep -nE \
  "tsm-rcm-career-engine|tsm-revenue-leakage-career-adapter|tsm-rcm-career-progression" \
  "$CAREER"

echo
echo "=== 2. LOAD ORDER VALIDATION ==="

python3 - "$CAREER" <<'PY'
from pathlib import Path
import sys

text = Path(sys.argv[1]).read_text()

engine = '<script src="/html/js/career/tsm-rcm-career-engine.js"></script>'
adapter = '<script src="/html/js/career/tsm-revenue-leakage-career-adapter.js"></script>'
progression = '<script src="/html/js/career/tsm-rcm-career-progression.js"></script>'

for label, token in [
    ("RCM engine", engine),
    ("Leakage adapter", adapter),
    ("RCM progression", progression),
]:
    if token not in text:
        raise SystemExit(f"FAIL: missing {label} script tag")

engine_pos = text.index(engine)
adapter_pos = text.index(adapter)
progression_pos = text.index(progression)

if not (engine_pos < adapter_pos < progression_pos):
    raise SystemExit(
        "FAIL: expected load order ENGINE → LEAKAGE ADAPTER → PROGRESSION"
    )

if text.count(adapter) != 1:
    raise SystemExit("FAIL: Leakage adapter must appear exactly once")

print("PASS: ENGINE → LEAKAGE ADAPTER → PROGRESSION")
print("PASS: adapter appears exactly once")
PY

echo
echo "=== 3. ADAPTER SYNTAX ==="
node --check "$ADAPTER"
echo "PASS: Leakage adapter syntax"

echo
echo "=== 4. CAREER PLATFORM SYNTAX CHECK ==="
python3 - "$CAREER" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text()

if 'TSMRevenueLeakageCareer' in text:
    print("INFO: inline Leakage API reference exists")
else:
    print("PASS: adapter supplied externally via script tag")

matches = re.findall(
    r'<script\s+src="([^"]*tsm-[^"]+\.js)"',
    text
)

print(f"Career script references discovered: {len(matches)}")
PY

echo
echo "=== 5. CANONICAL ADAPTER SOURCE CHECK ==="

grep -nE \
  "TSMHCPortfolioTwin|leakageOpportunities|canonical-healthcare-portfolio-leakage|setPortfolioTwin|discoverLeakage" \
  "$ADAPTER"

echo
echo "=== 6. DEMO SOURCE PROTECTION ==="

if grep -nEi \
  "honorhealth-revenue-leak-snapshot|revenue-leak-snapshot|getKpiByLabel|Revenue at Risk|48K|2\.8M|18\.4%" \
  "$ADAPTER"; then
  echo "FAIL: demo/Strategist leakage source found in adapter"
  exit 1
else
  echo "PASS: adapter remains canonical-source-only"
fi

echo
echo "=== 7. DIFF CHECK ==="
git diff --check
echo "PASS: git diff --check"

echo
echo "=== 8. CHANGE SUMMARY ==="
git diff --stat -- "$CAREER"

echo
echo "============================================================"
echo "PASS — LEAKAGE-001 ADAPTER LOAD PATH REPAIRED"
echo "============================================================"
echo
echo "Career Platform:"
echo "  RCM Engine"
echo "      ↓"
echo "  Leakage Adapter"
echo "      ↓"
echo "  RCM Progression"
echo
echo "Demo snapshot:       NOT USED"
echo "Strategist KPI:      NOT USED"
echo "Server start:        NO"
echo "Localhost requests:  NO"
echo "============================================================"