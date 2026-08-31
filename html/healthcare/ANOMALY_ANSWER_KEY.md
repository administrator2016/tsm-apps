# Sample Healthcare Doc Set — Anomaly Answer Key

Synthetic test data for intake/classifier and anomaly-detection workflow testing.
All patient/provider/payer data is fictional.

---

## File5_PriorAuth_Denial_ANOMALY.pdf (TriCore Regional Health / Angela Brooks / TC-CLM-50117)

| # | Type | Anomaly | Revenue impact |
|---|------|---------|-----------------|
| 1 | Timeline | Denial letter dated **2026-06-10**, but the Prior Auth Request it responds to was submitted **2026-06-18** — the denial predates the request by 8 days. | Signals a broken/backdated workflow record; could mask the real decision timeline in an audit. |
| 2 | Financial (cross-doc) | Prior Auth Request lists **Est. Charge Amount: $22,400.00**; the Denial letter for the same reference # lists **Amount Billed: $24,150.00** — a $1,750 mismatch. | Understates true exposure if only the auth-stage estimate is tracked. |
| 3 | Cross-doc ID | Rendering provider NPI on the request is **1558820047**; the denial letter lists **1558820074** (digits transposed) for the same claim. | Payment/appeal correspondence could misroute to the wrong provider record. |
| 4 | Revenue jeopardy (timeline) | Appeal window is stated as **15 days**, inconsistent with the 180-day standard used elsewhere in this document set (see File1, File3). | If a standard SLA/tracking timeline is assumed, the appeal deadline could be missed, forfeiting recovery. |

## File6_Remittance_EOB_ANOMALY.pdf (TriCore Regional Health / Angela Brooks / TC-CLM-50117)

| # | Type | Anomaly | Revenue impact |
|---|------|---------|-----------------|
| A | Timeline | Remittance **Payment Date: 2026-07-02** precedes the EOB's **Date of Service: 2026-07-15** — paid before the service was rendered. | Indicates a corrupted or test-only payment record; would fail a date-sequence integrity check. |
| B | Cross-doc ID | Remittance **Claim #: TC-CLM-501117** (extra digit) vs. EOB **Claim #: TC-CLM-50117** for what is otherwise the same patient/provider/DOS. | A claim-matching engine keyed on exact claim # would fail to link the ERA to the EOB. |
| C | Financial (impossible) | Line item CPT 36415: **Billed $310.00** but **Allowed $340.00** — allowed amount exceeds billed, which cannot occur under standard adjudication logic. | Flags a data-integrity error that would otherwise silently inflate "allowed" totals. |
| D | Financial (underpayment / revenue leakage) | Remittance states **Plan Paid: $1,340.00**, but the line items net to **$2,753.64** (193.52 + 2,288.12 + 272.00), and the EOB independently states **Plan Paid: $2,753.64** for the same claim. | ~**$1,413.64 underpayment** relative to what was adjudicated and what the member was told the plan paid — the core "jeopardizes revenue collection" scenario: provider is shorted vs. the payer's own EOB figure. |

---

## Also present in the earlier (non-"ANOMALY"-labeled) files — left as-is per your call

| File(s) | Anomaly | Type |
|---|---|---|
| File2_Remittance_EOB.pdf | Line-item coinsurance sums to $158.50; summary states "Patient Responsibility: $158.55" ($0.05 off). | Financial — rounding discrepancy |
| File1 vs. File2 | Both reference **Claim # HC-CLM-77410** for patient Marcus Reeves, but File1 is a denial for CPT 29881 ($18,900) and File2 is a paid remittance/EOB for entirely different CPT codes (99214/73721/20610, $1,175) under the same claim #. | Cross-document ID/service mismatch |

---

### Suggested use
Run the full set (File1–File6) through your intake classifier and anomaly-detection workflow, then diff its output against this key. File1, File3, File4 are "clean" baselines (File2 carries the one accidental issue above); File5 and File6 are the dense anomaly cases.
