"""
Generates two synthetic healthcare RCM sample-document PDFs for testing the
HC Office Manager Neural Intake classifier and for demo/presentation use.

All patient names, provider names, payer names, NPIs, claim numbers, and
dollar amounts are fictional. Nothing here represents a real person,
provider, or payer.

File 1: Prior Authorization Request + Denial Letter
File 2: Remittance Advice (ERA-style) + Explanation of Benefits (EOB)
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, HRFlowable
)
from reportlab.lib.enums import TA_CENTER, TA_RIGHT

styles = getSampleStyleSheet()

banner_style = ParagraphStyle('Banner', parent=styles['Normal'], fontSize=8,
    textColor=colors.HexColor('#991b1b'), alignment=TA_CENTER, spaceAfter=10,
    borderColor=colors.HexColor('#991b1b'), borderWidth=0.75, borderPadding=6,
    backColor=colors.HexColor('#fef2f2'))

org_style = ParagraphStyle('Org', parent=styles['Title'], fontSize=16, spaceAfter=2)
sub_style = ParagraphStyle('Sub', parent=styles['Normal'], fontSize=9,
    textColor=colors.HexColor('#555555'), spaceAfter=14)
doctitle_style = ParagraphStyle('DocTitle', parent=styles['Heading1'], fontSize=13,
    textColor=colors.HexColor('#1a3a1a'), spaceBefore=6, spaceAfter=10)
label_style = ParagraphStyle('Label', parent=styles['Normal'], fontSize=9, leading=13)
body_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=9.5, leading=14, spaceAfter=8)
section_style = ParagraphStyle('Section', parent=styles['Heading2'], fontSize=10.5,
    textColor=colors.HexColor('#0a3d1f'), spaceBefore=12, spaceAfter=6)

SAMPLE_BANNER = Paragraph(
    "⚠ SYNTHETIC SAMPLE DOCUMENT — for intake-classifier testing and demo use only. "
    "All names, IDs, and amounts below are fictional; this is not a real patient, provider, or payer record.",
    banner_style
)

def letterhead(org_name, org_sub, doc_title):
    return [
        SAMPLE_BANNER,
        Paragraph(org_name, org_style),
        Paragraph(org_sub, sub_style),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor('#1a3a1a')),
        Paragraph(doc_title, doctitle_style),
    ]

def kv_table(rows, col_widths=(1.7*inch, 4.3*inch)):
    t = Table(rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('TEXTCOLOR', (0,0), (0,-1), colors.HexColor('#444444')),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ('TOPPADDING', (0,0), (-1,-1), 3),
    ]))
    return t

# ═══════════════════════════════════════════════════════════════════════
# FILE 1: Prior Authorization Request + Denial Letter
# ═══════════════════════════════════════════════════════════════════════

doc1 = SimpleDocTemplate("/tmp/hc-sample-prior-auth-denial.pdf", pagesize=letter,
    topMargin=0.6*inch, bottomMargin=0.6*inch, leftMargin=0.7*inch, rightMargin=0.7*inch)
story = []

# --- Sample 1: Prior Authorization Request ---
story += letterhead(
    "Sonoran Ridge Medical Group",
    "4820 E. Camino Vista · Scottsdale, AZ 85258 · (480) 555-0142 · fax (480) 555-0143",
    "PRIOR AUTHORIZATION REQUEST"
)
story.append(kv_table([
    ["Request Date:", "August 12, 2026"],
    ["Requesting Provider:", "Dr. Elena Marsh, MD (NPI 1234567890)"],
    ["Facility:", "Sonoran Ridge Medical Group — Scottsdale Campus"],
    ["Patient:", "J. Alvarado (DOB 03/14/1971) — Sample Patient ID SR-88231"],
    ["Payer:", "Meridian Health Plan — Group #MH-40021"],
    ["Payer Reference #:", "PA-2026-0812-7734"],
]))
story.append(Spacer(1, 10))
story.append(Paragraph("REQUESTED SERVICE", section_style))
story.append(kv_table([
    ["CPT Code:", "27447 — Total knee arthroplasty"],
    ["Diagnosis (ICD-10):", "M17.11 — Unilateral primary osteoarthritis, right knee"],
    ["Requested Date of Service:", "September 2, 2026"],
    ["Site of Service:", "Sonoran Ridge Surgical Center (outpatient)"],
    ["Urgency:", "Standard (non-urgent)"],
]))
story.append(Spacer(1, 10))
story.append(Paragraph("CLINICAL JUSTIFICATION", section_style))
story.append(Paragraph(
    "Patient has failed 6 months of conservative management including NSAIDs, physical therapy "
    "(24 visits), and two corticosteroid injections (05/2026, 07/2026) with persistent Grade 4 "
    "osteoarthritis confirmed on weight-bearing radiographs dated 07/28/2026. Kellgren-Lawrence "
    "score of 4. Patient reports pain 8/10 limiting ambulation to under 100 feet.", body_style))
story.append(Paragraph("Attachments: radiology report, PT discharge summary, injection records (3 pages).", body_style))

story.append(PageBreak())

# --- Sample 2: Denial Letter ---
story += letterhead(
    "Meridian Health Plan",
    "Utilization Management Department · PO Box 9042, Phoenix, AZ 85001 · (800) 555-0199",
    "NOTICE OF ADVERSE BENEFIT DETERMINATION (DENIAL)"
)
story.append(kv_table([
    ["Letter Date:", "August 19, 2026"],
    ["Member:", "J. Alvarado — Member ID MH-40021-88231"],
    ["Provider:", "Sonoran Ridge Medical Group / Dr. Elena Marsh"],
    ["Claim / Auth Reference:", "PA-2026-0812-7734"],
    ["Service Requested:", "CPT 27447 — Total knee arthroplasty"],
    ["Determination:", "DENIED"],
    ["Denial Code:", "CO-50 — Not deemed a medical necessity by the payer"],
]))
story.append(Spacer(1, 10))
story.append(Paragraph("REASON FOR DENIAL", section_style))
story.append(Paragraph(
    "Per Meridian Health Plan clinical criteria (MCG Care Guidelines, Ortho-Knee-014, v26.1), "
    "total knee arthroplasty requires documentation of failed conservative treatment for a minimum "
    "of 12 consecutive weeks including supervised physical therapy AND at least one attempted "
    "intra-articular injection within the 90 days immediately preceding the request. Submitted "
    "records show a 6-month conservative course but do not include a physical therapy plan of care "
    "signed by a licensed therapist for the most recent 8-week period. Additional documentation "
    "is required before this determination can be reconsidered.", body_style))
story.append(Paragraph("APPEAL RIGHTS", section_style))
story.append(Paragraph(
    "This determination may be appealed within 180 days of this notice. Submit a written appeal "
    "with the missing plan-of-care documentation to the Utilization Management Department at the "
    "address above, or fax to (800) 555-0198. Expedited appeal available for urgent cases per "
    "member handbook Section 7.3.", body_style))

doc1.build(story)
print("File 1 built: /tmp/hc-sample-prior-auth-denial.pdf")

# ═══════════════════════════════════════════════════════════════════════
# FILE 2: Remittance Advice (ERA-style) + Explanation of Benefits (EOB)
# ═══════════════════════════════════════════════════════════════════════

doc2 = SimpleDocTemplate("/tmp/hc-sample-remittance-eob.pdf", pagesize=letter,
    topMargin=0.6*inch, bottomMargin=0.6*inch, leftMargin=0.7*inch, rightMargin=0.7*inch)
story2 = []

# --- Sample 3: Remittance Advice / ERA-style summary ---
story2 += letterhead(
    "Meridian Health Plan",
    "Claims Payment Services · Electronic Remittance Advice (ERA 835 Summary View)",
    "REMITTANCE ADVICE"
)
story2.append(kv_table([
    ["Payer:", "Meridian Health Plan (Payer ID MHP01)"],
    ["Payee/Provider:", "Sonoran Ridge Medical Group (NPI 1234567890)"],
    ["Check/EFT #:", "EFT-20260822-55317"],
    ["Payment Date:", "August 22, 2026"],
    ["Total Paid This Remittance:", "$1,240.18"],
]))
story2.append(Spacer(1, 12))
story2.append(Paragraph("CLAIM DETAIL", section_style))

claim_rows = [
    ["Claim #", "Patient", "CPT", "Billed", "Allowed", "Paid", "Adj. Code", "Patient Resp."],
    ["CLM-88301", "J. Alvarado", "99214", "$285.00", "$182.40", "$145.92", "PR-2 / CO-45", "$36.48"],
    ["CLM-88302", "R. Chen", "97110 x3", "$264.00", "$198.00", "$158.40", "CO-45", "$39.60"],
    ["CLM-88303", "M. Okafor", "20610", "$310.00", "$0.00", "$0.00", "CO-29", "$0.00"],
    ["CLM-88304", "S. Delgado", "36415", "$45.00", "$41.10", "$32.88", "PR-1 / CO-45", "$8.22"],
]
t = Table(claim_rows, colWidths=[0.85*inch, 0.9*inch, 0.7*inch, 0.65*inch, 0.65*inch, 0.65*inch, 0.85*inch, 0.85*inch])
t.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0a3d1f')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 7.8),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cccccc')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#f4f8f4')]),
    ('ALIGN', (3,0), (-1,-1), 'RIGHT'),
    ('TOPPADDING', (0,0), (-1,-1), 4),
    ('BOTTOMPADDING', (0,0), (-1,-1), 4),
]))
story2.append(t)
story2.append(Spacer(1, 8))
story2.append(Paragraph(
    "Note: CLM-88303 (M. Okafor, CPT 20610) denied in full — CO-29, timely filing limit exceeded. "
    "Claim submitted 118 days after date of service; payer timely filing limit is 90 days.",
    ParagraphStyle('Note', parent=body_style, textColor=colors.HexColor('#991b1b'))))

story2.append(PageBreak())

# --- Sample 4: Explanation of Benefits (EOB) — patient-facing ---
story2 += letterhead(
    "Meridian Health Plan",
    "Member Services · This is not a bill.",
    "EXPLANATION OF BENEFITS (EOB)"
)
story2.append(kv_table([
    ["Member:", "J. Alvarado — Member ID MH-40021-88231"],
    ["Date of Service:", "August 5, 2026"],
    ["Provider:", "Sonoran Ridge Medical Group — Dr. Elena Marsh"],
    ["Claim Number:", "CLM-88301"],
    ["EOB Date:", "August 22, 2026"],
]))
story2.append(Spacer(1, 10))
story2.append(Paragraph("SERVICE SUMMARY", section_style))

eob_rows = [
    ["Service", "Amount Billed", "Plan Discount", "Plan Paid", "You Owe"],
    ["Office Visit, Est. Patient, Level 4 (CPT 99214)", "$285.00", "$102.60", "$145.92", "$36.48"],
]
t2 = Table(eob_rows, colWidths=[2.6*inch, 1*inch, 1*inch, 0.85*inch, 0.85*inch])
t2.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0a3d1f')),
    ('TEXTCOLOR', (0,0), (-1,0), colors.white),
    ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
    ('FONTSIZE', (0,0), (-1,-1), 8.5),
    ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#cccccc')),
    ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story2.append(t2)
story2.append(Spacer(1, 10))
story2.append(Paragraph("ADJUSTMENT CODES ON THIS CLAIM", section_style))
story2.append(Paragraph(
    "<b>CO-45</b> — Charge exceeds fee schedule/maximum allowable; provider write-off, not billable to patient.<br/>"
    "<b>PR-2</b> — Coinsurance amount, patient responsibility per plan benefit (20% coinsurance tier).", body_style))
story2.append(Paragraph(
    "Your plan paid $145.92 of the $182.40 allowed amount. Your coinsurance responsibility is "
    "$36.48. If you have already paid this amount, no further action is needed.", body_style))

doc2.build(story2)
print("File 2 built: /tmp/hc-sample-remittance-eob.pdf")
