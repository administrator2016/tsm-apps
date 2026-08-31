#!/usr/bin/env bash
set -u

ROOT="${1:-.}"
OUT="advisor-architecture-sweep.txt"

echo "TSM ADVISOR ARCHITECTURE SWEEP" > "$OUT"
echo "Generated: $(date)" >> "$OUT"
echo "Root: $ROOT" >> "$OUT"
echo >> "$OUT"

echo "==================================================" >> "$OUT"
echo "1. EXPLICIT ANOMALY ADVISOR SIGNALS" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  --exclude='advisor-architecture-sweep.txt' \
  "Anomaly Advisor|anomaly-advisor|anomalyAdvisor|anomaly_advisor|AnomalyAdvisor" \
  "$ROOT" 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "2. ADVISOR UI / FUNCTION SIGNALS" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  "AI Advisor|Intelligent Advisor|Advisor Panel|Advisor Card|advisor|Advisor|runAdvisor|showAdvisor|loadAdvisor|renderAdvisor" \
  "$ROOT" 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "3. ANOMALY UI / FUNCTION SIGNALS" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  "Anomaly|anomaly|runAnomaly|showAnomaly|loadAnomaly|renderAnomaly" \
  "$ROOT" 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "4. OLD RECOMMENDATION PATTERNS" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  "recommendedAction|recommendedActions|recommendation|recommendations|next action|nextAction|recommended action" \
  "$ROOT" 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "5. MODERN TSM FOUNDATION SIGNALS" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  "TSMRemediationRecommender|tsm-remediation-recommender|TSMAppCapabilityRegistry|tsm-app-capability-registry|capabilityId|Intelligent Guide|intelligent-guide" \
  "$ROOT" 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "6. INSURANCE REFERENCE IMPLEMENTATION" >> "$OUT"
echo "==================================================" >> "$OUT"

grep -RinE \
  "runInsuranceIntelligentGuide|insurance\.bnca\.operations|TSMRemediationRecommender" \
  html/tsm-insurance html/shared 2>/dev/null >> "$OUT" || true

echo >> "$OUT"
echo "==================================================" >> "$OUT"
echo "7. FILE COUNTS" >> "$OUT"
echo "==================================================" >> "$OUT"

echo "Explicit Anomaly Advisor files:" >> "$OUT"
grep -Rl \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  -E "Anomaly Advisor|anomaly-advisor|anomalyAdvisor|anomaly_advisor|AnomalyAdvisor" \
  "$ROOT" 2>/dev/null | wc -l >> "$OUT"

echo "Advisor-related files:" >> "$OUT"
grep -Ril \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  -E "advisor|Advisor" \
  "$ROOT" 2>/dev/null | wc -l >> "$OUT"

echo "Modern recommender files:" >> "$OUT"
grep -Ril \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  -E "TSMRemediationRecommender|tsm-remediation-recommender" \
  "$ROOT" 2>/dev/null | wc -l >> "$OUT"

echo
echo "=== SWEEP COMPLETE ==="
echo "Output: $OUT"
echo
echo "=== EXPLICIT ANOMALY ADVISOR FILES ==="
grep -Rl \
  --exclude-dir=.git \
  --exclude='*.txt' \
  --exclude='*.docx' \
  --exclude='*.pptx' \
  --exclude='*.pdf' \
  -E "Anomaly Advisor|anomaly-advisor|anomalyAdvisor|anomaly_advisor|AnomalyAdvisor" \
  "$ROOT" 2>/dev/null | sort || true

echo
echo "=== COUNTS ==="
grep -E "files:" "$OUT" || true
