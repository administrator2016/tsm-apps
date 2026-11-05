const pptxgen = require("pptxgenjs");
const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
const C = {
  navy:"0B1F3A",teal:"00A896",mint:"02C39A",slate:"2C4A6E",
  steel:"4A6FA5",white:"FFFFFF",offWhite:"F7F9FC",muted:"8A9BB5",
  dark:"0D1B2A",red:"D84040",amber:"D97706",green:"059669",
  redLt:"FDECEA",amberLt:"FEF3C7",greenLt:"D1FAE5",
  tealLt:"E0F5F2",banner:"004F9F",bannerLt:"E6EEF8",
  steelLt:"D6E4F7",ghostWhite:"EEF2F8"
};
const FONT_HEAD="Calibri",FONT_BODY="Calibri";
const TOTAL=18;

function bgNavy(s){s.background={color:C.navy};}
function bgWhite(s){s.background={color:C.offWhite};}
function addSideBar(s,color){s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.18,h:7.5,fill:{color:color||C.teal},line:{color:color||C.teal}});}
function addSlideNum(s,n,total,light){s.addText(n+" / "+total,{x:12.3,y:7.15,w:0.9,h:0.25,fontSize:9,color:light?C.white:C.muted,align:"right",fontFace:FONT_BODY});}
function pill(s,label,x,y,w,bg,fg){s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w:w||1.4,h:0.28,fill:{color:bg},line:{color:bg},rectRadius:0.14});s.addText(label,{x,y,w:w||1.4,h:0.28,fontSize:9,bold:true,color:fg,align:"center",valign:"middle",fontFace:FONT_BODY,margin:0});}
function card(s,x,y,w,h,fillColor,strokeColor){s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:fillColor||C.white},line:{color:strokeColor||"DDEAF5",width:0.75},shadow:{type:"outer",color:"0B1F3A",blur:8,offset:2,angle:135,opacity:0.07}});}
function sectionHeader(s,text,sub){s.addText(text,{x:0.35,y:0.22,w:12.6,h:0.52,fontSize:28,bold:true,color:C.white,fontFace:FONT_HEAD,align:"left"});if(sub)s.addText(sub,{x:0.35,y:0.76,w:12.6,h:0.3,fontSize:13,color:C.teal,fontFace:FONT_BODY,align:"left"});}
function contentTitle(s,text,sub){s.addText(text,{x:0.35,y:0.18,w:12.6,h:0.5,fontSize:24,bold:true,color:C.navy,fontFace:FONT_HEAD,align:"left"});if(sub)s.addText(sub,{x:0.35,y:0.68,w:12.6,h:0.28,fontSize:12,color:C.steel,fontFace:FONT_BODY,align:"left"});}
function makeShadow(){return {type:"outer",color:"000000",blur:6,offset:2,angle:135,opacity:0.12};}

// SLIDE 1 - COVER
{const s=pres.addSlide();bgNavy(s);
s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.06,h:7.5,fill:{color:C.teal},line:{color:C.teal}});
s.addShape(pres.shapes.RECTANGLE,{x:9.5,y:0,w:3.8,h:3.2,fill:{color:C.teal,transparency:88},line:{color:C.teal,transparency:88}});
s.addShape(pres.shapes.RECTANGLE,{x:0.55,y:0.55,w:1.6,h:0.55,fill:{color:C.teal},line:{color:C.teal}});
s.addText("GHS",{x:0.55,y:0.55,w:1.6,h:0.55,fontSize:20,bold:true,color:C.white,align:"center",valign:"middle",fontFace:FONT_HEAD,margin:0});
s.addShape(pres.shapes.RECTANGLE,{x:2.35,y:0.67,w:2.2,h:0.3,fill:{color:C.banner},line:{color:C.banner}});
s.addText("x Banner Health",{x:2.35,y:0.67,w:2.2,h:0.3,fontSize:10,bold:true,color:C.white,align:"center",valign:"middle",fontFace:FONT_BODY,margin:0});
s.addText("GHS Healthcare",{x:0.55,y:1.55,w:9.5,h:0.85,fontSize:56,bold:true,color:C.white,fontFace:FONT_HEAD,align:"left"});
s.addText("Command Center",{x:0.55,y:2.3,w:9.5,h:0.85,fontSize:56,bold:true,color:C.teal,fontFace:FONT_HEAD,align:"left"});
s.addText("AI-Powered Clinical & Revenue Cycle Intelligence\nFrom Document Intake to HITL-Approved Action",{x:0.55,y:3.28,w:9.0,h:0.7,fontSize:15,color:"AAC4E0",fontFace:FONT_BODY,align:"left",lineSpacingMultiple:1.35});
[{v:"< 90s",l:"Doc-to-BNCA"},{v:"6-8x",l:"Faster Review"},{v:"Zero",l:"Manual Routing"}].forEach((st,i)=>{const bx=0.55+i*3.0;s.addShape(pres.shapes.RECTANGLE,{x:bx,y:4.3,w:2.7,h:1.1,fill:{color:"FFFFFF",transparency:92},line:{color:C.teal,width:0.75}});s.addText(st.v,{x:bx,y:4.38,w:2.7,h:0.55,fontSize:32,bold:true,color:C.teal,align:"center",valign:"middle",fontFace:FONT_HEAD});s.addText(st.l,{x:bx,y:4.9,w:2.7,h:0.4,fontSize:11,color:"AAC4E0",align:"center",fontFace:FONT_BODY});});
s.addText("Prepared for Banner Health · Strategic Partnership Review · 2025",{x:0.55,y:6.9,w:12.2,h:0.3,fontSize:10,color:C.muted,fontFace:FONT_BODY,align:"left"});
addSlideNum(s,1,TOTAL,true);}

// SLIDE 2 - PROBLEM
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.red);
contentTitle(s,"The Document Problem Banner Faces Every Day","8 document types. Thousands of encounters. Manual review, delays, denials — and avoidable risk.");
s.addShape(pres.shapes.RECTANGLE,{x:9.8,y:0.15,w:3.3,h:0.65,fill:{color:C.redLt},line:{color:C.red,width:0.5}});
s.addText("$262B lost annually to claim denials (CAQH)",{x:9.8,y:0.15,w:3.3,h:0.65,fontSize:10,color:C.red,align:"center",valign:"middle",fontFace:FONT_BODY,bold:true});
const problems=[
{icon:"🔐",type:"Prior Auths",pain:"72-hr avg delay\nManual clinical review\nMissing fields block submission"},
{icon:"🏥",type:"Discharge Summaries",pain:"Missing follow-up orders\nLACE score uncalculated\nReadmission risk unaddressed"},
{icon:"❌",type:"Claim Denials",pain:"Low appeal success rates\nDeadlines missed\nConflicting denial codes"},
{icon:"↗",type:"Referral Orders",pain:"Thin clinical context\nAuth not obtained\nSpecialist rejection delays"},
{icon:"💊",type:"Med Reconciliation",pain:"Dose discrepancies undetected\nMissing meds across transitions\nAdverse event risk"},
{icon:"🔔",type:"ADT Notifications",pain:"Payer not notified\nCMS compliance failures\nCare coordination gaps"},
{icon:"✍",type:"Consent Forms",pain:"Missing signatures\nCapacity undocumented\nInterpreter not secured"},
{icon:"📝",type:"Clinical Notes",pain:"Undercoding / overbilling\nHPI elements missing\nAudit & recoupment risk"}];
problems.forEach((p,i)=>{const col=i%4,row=Math.floor(i/4),x=0.35+col*3.12,y=1.08+row*1.64;
card(s,x,y,3.0,1.52,C.white,"DDEAF5");
s.addShape(pres.shapes.RECTANGLE,{x,y,w:0.06,h:1.52,fill:{color:C.red},line:{color:C.red}});
s.addText(p.icon,{x:x+0.15,y:y+0.08,w:0.4,h:0.35,fontSize:18});
s.addText(p.type,{x:x+0.55,y:y+0.1,w:2.35,h:0.35,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText(p.pain,{x:x+0.15,y:y+0.5,w:2.75,h:0.9,fontSize:10,color:"4A5568",fontFace:FONT_BODY,lineSpacingMultiple:1.3});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.95,w:12.6,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("GHS Healthcare Command processes all 8 document types simultaneously — with AI nodes that catch what humans miss.",{x:0.35,y:6.95,w:12.6,h:0.38,fontSize:11,bold:true,color:C.teal,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,2,TOTAL,false);}

// SLIDE 3 - SYSTEM OVERVIEW
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.teal);
sectionHeader(s,"GHS Healthcare Command","The AI operating system for clinical and revenue cycle documents");
const layers=[
{title:"Input Layer — Document Library",sub:"Any document type, any version, any condition",items:["Prior Authorizations","Discharge Summaries","Claim Denials","Referral Orders","Med Reconciliation","ADT Notifications","Consent Forms","Clinical Notes"],color:C.steel,icon:"📂"},
{title:"Intelligence Layer — HC-Nodes",sub:"4 specialized AI nodes analyze every document in parallel",items:["Coding Node — CPT/ICD accuracy","Compliance Node — regulatory gaps","Clinical Node — care quality flags","Risk Node — liability & revenue risk"],color:C.teal,icon:"🧠"},
{title:"Action Layer — BNCA Pipeline",sub:"HC-Strategist → Main Strategist → HITL Manager",items:["HC-Strategist synthesizes node findings","Main Strategist prioritizes & escalates","HITL Manager reviews & approves","Audit trail on every action"],color:C.mint,icon:"⚡"}];
layers.forEach((layer,i)=>{const x=0.35+i*4.35,y=1.2,w=4.1,h=5.4;
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:"FFFFFF",transparency:93},line:{color:layer.color,width:1.0}});
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.7,fill:{color:layer.color,transparency:15},line:{color:layer.color}});
s.addText(layer.icon+"  "+layer.title,{x:x+0.12,y:y+0.04,w:w-0.24,h:0.38,fontSize:11,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText(layer.sub,{x:x+0.12,y:y+0.42,w:w-0.24,h:0.25,fontSize:9,color:"C8E0F4",fontFace:FONT_BODY});
layer.items.forEach((item,j)=>{const iy=y+0.85+j*0.54;
s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:iy,w:w-0.24,h:0.44,fill:{color:C.white,transparency:88},line:{color:"FFFFFF",transparency:80,width:0.5}});
s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:iy,w:0.05,h:0.44,fill:{color:layer.color},line:{color:layer.color}});
s.addText(item,{x:x+0.24,y:iy,w:w-0.38,h:0.44,fontSize:10.5,color:C.white,fontFace:FONT_BODY,valign:"middle"});});
if(i<2){s.addText("▶",{x:x+w+0.02,y:y+2.3,w:0.25,h:0.4,fontSize:14,color:C.teal,align:"center",valign:"middle"});}});
s.addText("Every document enters. Every document exits with a clear, prioritized, human-reviewed action.",{x:0.35,y:6.85,w:12.6,h:0.4,fontSize:12,bold:true,color:C.teal,align:"center",fontFace:FONT_BODY});
addSlideNum(s,3,TOTAL,true);}

// SLIDE 4 - PIPELINE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.teal);
contentTitle(s,"The GHS Healthcare Command Pipeline","From document upload to HITL-approved action — every step tracked, every decision logged");
const stages=[
{icon:"📄",name:"Document\nIntake",sub:"Upload & parse\nany format",color:C.steel,x:0.38},
{icon:"🔬",name:"HC-Nodes\n(4 Parallel)",sub:"Code · Comply\nClinical · Risk",color:C.teal,x:2.82},
{icon:"🧠",name:"HC-\nStrategist",sub:"Synthesizes node\nfindings → BNCA",color:C.mint,x:5.26},
{icon:"📊",name:"Main\nStrategist",sub:"Priority · Escalation\nCompliance check",color:C.slate,x:7.7},
{icon:"👤",name:"HITL\nManager",sub:"Human review\nFinal approval",color:C.banner,x:10.14}];
stages.forEach((st,i)=>{const x=st.x,w=2.25,h=2.5,y=1.25;
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:st.color,transparency:10},line:{color:st.color,width:1.0},shadow:makeShadow()});
s.addShape(pres.shapes.OVAL,{x:x+w/2-0.35,y:y+0.18,w:0.7,h:0.7,fill:{color:C.white,transparency:20},line:{color:C.white,transparency:40}});
s.addText(st.icon,{x:x+w/2-0.35,y:y+0.18,w:0.7,h:0.7,fontSize:20,align:"center",valign:"middle"});
s.addText(st.name,{x:x+0.1,y:y+0.97,w:w-0.2,h:0.65,fontSize:13,bold:true,color:C.white,align:"center",fontFace:FONT_HEAD,lineSpacingMultiple:1.2});
s.addText(st.sub,{x:x+0.1,y:y+1.65,w:w-0.2,h:0.7,fontSize:10,color:"D8EEF8",align:"center",fontFace:FONT_BODY,lineSpacingMultiple:1.3});
if(i<stages.length-1){const ax=x+w+0.04,ay=y+h/2-0.12;s.addText("▶",{x:ax,y:ay,w:0.35,h:0.24,fontSize:12,color:C.teal,align:"center",valign:"middle"});}
s.addShape(pres.shapes.OVAL,{x:x+w-0.32,y:y-0.16,w:0.32,h:0.32,fill:{color:C.white},line:{color:st.color,width:1.0}});
s.addText(""+(i+1),{x:x+w-0.32,y:y-0.16,w:0.32,h:0.32,fontSize:11,bold:true,color:st.color,align:"center",valign:"middle",fontFace:FONT_HEAD});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:4.02,w:12.55,h:1.55,fill:{color:C.greenLt},line:{color:C.green,width:0.75}});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:4.02,w:0.06,h:1.55,fill:{color:C.green},line:{color:C.green}});
s.addText("⚡  BNCA OUTPUT — Best Next Course of Action",{x:0.55,y:4.1,w:6.0,h:0.32,fontSize:12,bold:true,color:C.green,fontFace:FONT_HEAD});
["Coding Node → ICD/CPT verified, bundling checked, modifier flagged","Compliance Node → regulatory gaps identified, deadlines captured","Clinical Node → care quality flags, medical necessity gaps surfaced","Risk Node → liability, revenue risk, and escalation path determined","HC-Strategist → synthesizes all 4 findings into single prioritized BNCA","Main Strategist → assigns urgency tier, routes to correct team or HITL"].forEach((item,i)=>{const col=i<3?0.55:6.85;s.addText("• "+item,{x:col,y:4.5+i%3*0.33,w:6.1,h:0.3,fontSize:10,color:"1A5C3A",fontFace:FONT_BODY});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:5.72,w:12.55,h:0.52,fill:{color:C.bannerLt},line:{color:C.banner,width:0.75}});
s.addText("👤  HITL Manager — Reviews BNCA, approves or modifies action, with full audit trail. Every decision is accountable.",{x:0.55,y:5.72,w:12.2,h:0.52,fontSize:11,color:C.banner,fontFace:FONT_BODY,valign:"middle"});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.38,w:12.55,h:0.42,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Total pipeline time: under 90 seconds · Zero manual routing · 100% audit trail",{x:0.38,y:6.38,w:12.55,h:0.42,fontSize:11,bold:true,color:C.teal,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,4,TOTAL,false);}

// SLIDE 5 - HC-NODES
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.mint);
sectionHeader(s,"The HC-Nodes — 4 Parallel AI Analyzers","Every document is processed simultaneously across all four nodes.");
const nodes=[
{icon:"🔢",name:"Coding Node",color:C.steel,what:"Verifies CPT and ICD-10 accuracy",catches:["Wrong or missing procedure codes","Diagnosis-procedure conflicts","Modifier errors and bundling issues","DRG accuracy for inpatient billing"],example:"Prior Auth: CPT 27447 + M17.11 verified. No modifier needed. Clean."},
{icon:"📋",name:"Compliance Node",color:C.teal,what:"Checks regulatory and payer requirements",catches:["Missing required fields by payer","Insurance policy status","Consent documentation standards","CMS core measure compliance"],example:"Discharge: LACE score missing. CMS readmission measure at risk. Flag."},
{icon:"🩺",name:"Clinical Node",color:C.mint,what:"Evaluates care quality and clinical sufficiency",catches:["Medical necessity gaps","Incomplete HPI elements","Missing safety netting","High-risk patient flags (LACE, social determinants)"],example:"Referral: SVT with delta waves + syncope — EP subspecialty confirmed."},
{icon:"⚠",name:"Risk Node",color:C.amber,what:"Quantifies liability and revenue risk",catches:["Denial probability scores","Appeal deadline tracking","Patient safety event risk","Audit and recoupment exposure"],example:"Claim Denial: CO-97 + CO-4 dual-code = payer error likely. Appeal HIGH."}];
nodes.forEach((node,i)=>{const x=0.38+i*3.15,y=1.15,w=3.05,h=4.85;
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:C.white,transparency:94},line:{color:node.color,width:1.0}});
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.78,fill:{color:node.color,transparency:5},line:{color:node.color}});
s.addText(node.icon,{x:x+0.1,y:y+0.08,w:0.45,h:0.55,fontSize:20,align:"center",valign:"middle"});
s.addText(node.name,{x:x+0.58,y:y+0.04,w:w-0.68,h:0.38,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText(node.what,{x:x+0.58,y:y+0.4,w:w-0.68,h:0.3,fontSize:9.5,color:"D4EEF8",fontFace:FONT_BODY});
s.addText("What it catches:",{x:x+0.15,y:y+0.92,w:w-0.25,h:0.25,fontSize:10,bold:true,color:node.color,fontFace:FONT_HEAD});
node.catches.forEach((c,j)=>{const iy=y+1.2+j*0.56;
s.addShape(pres.shapes.RECTANGLE,{x:x+0.15,y:iy,w:w-0.3,h:0.48,fill:{color:C.white,transparency:88},line:{color:"FFFFFF",transparency:78,width:0.5}});
s.addShape(pres.shapes.RECTANGLE,{x:x+0.15,y:iy,w:0.05,h:0.48,fill:{color:node.color},line:{color:node.color}});
s.addText(c,{x:x+0.27,y:iy,w:w-0.45,h:0.48,fontSize:10,color:C.white,fontFace:FONT_BODY,valign:"middle"});});
s.addShape(pres.shapes.RECTANGLE,{x:x+0.1,y:y+3.65,w:w-0.2,h:1.08,fill:{color:node.color,transparency:82},line:{color:node.color,width:0.5}});
s.addText("Example:",{x:x+0.18,y:y+3.72,w:w-0.35,h:0.22,fontSize:9,bold:true,color:node.color,fontFace:FONT_HEAD});
s.addText(node.example,{x:x+0.18,y:y+3.94,w:w-0.35,h:0.7,fontSize:9.5,color:C.white,fontFace:FONT_BODY,lineSpacingMultiple:1.25,italic:true});});
s.addText("All four nodes report simultaneously to the HC-Strategist — who synthesizes findings into a single BNCA.",{x:0.38,y:6.2,w:12.55,h:0.35,fontSize:11,bold:true,color:C.teal,align:"center",fontFace:FONT_BODY});
addSlideNum(s,5,TOTAL,true);}

// SLIDES 6-18 abbreviated but complete
// SLIDE 6 - STRATEGISTS
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.slate);
contentTitle(s,"HC-Strategist & Main Strategist — The Decision Layer","Two AI layers that transform node findings into prioritized, human-ready recommendations");
card(s,0.38,1.05,5.85,5.45,C.tealLt,C.teal);
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:1.05,w:5.85,h:0.65,fill:{color:C.teal},line:{color:C.teal}});
s.addText("🧠  HC-Strategist",{x:0.55,y:1.1,w:5.5,h:0.52,fontSize:18,bold:true,color:C.white,fontFace:FONT_HEAD});
[{h:"Receives all 4 node findings",b:"Coding, Compliance, Clinical, and Risk outputs arrive simultaneously"},{h:"Resolves conflicts between nodes",b:"When nodes disagree, HC-Strategist adjudicates"},{h:"Generates the BNCA",b:"Best Next Course of Action — single, specific, actionable recommendation"},{h:"Assigns confidence score",b:"Low/Medium/High confidence routes to different HITL escalation paths"},{h:"Tags for routing",b:"Flags for billing, clinical, compliance, or HITL review queue"}].forEach((p,i)=>{const y=1.85+i*0.85;s.addShape(pres.shapes.OVAL,{x:0.52,y,w:0.32,h:0.32,fill:{color:C.teal},line:{color:C.teal}});s.addText(""+(i+1),{x:0.52,y,w:0.32,h:0.32,fontSize:11,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(p.h,{x:0.95,y:y-0.02,w:5.1,h:0.28,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(p.b,{x:0.95,y:y+0.26,w:5.1,h:0.38,fontSize:10,color:"3A5068",fontFace:FONT_BODY});});
s.addText("▶",{x:6.32,y:3.42,w:0.38,h:0.52,fontSize:18,color:C.white,align:"center",valign:"middle"});
card(s,6.78,1.05,5.88,5.45,C.ghostWhite,C.slate);
s.addShape(pres.shapes.RECTANGLE,{x:6.78,y:1.05,w:5.88,h:0.65,fill:{color:C.slate},line:{color:C.slate}});
s.addText("📊  Main Strategist",{x:6.95,y:1.1,w:5.5,h:0.52,fontSize:18,bold:true,color:C.white,fontFace:FONT_HEAD});
[{h:"Receives BNCA from HC-Strategist",b:"Reviews confidence score and routing tag"},{h:"Cross-document pattern recognition",b:"Identifies systemic issues across submissions"},{h:"Priority tier assignment",b:"P1 Urgent · P2 Revenue Critical · P3 Standard · P4 Info"},{h:"Escalation path determination",b:"Routes to billing, compliance, CMO, or HITL"},{h:"Reports to HITL Manager",b:"Delivers BNCA + findings + priority for human sign-off"}].forEach((p,i)=>{const y=1.85+i*0.85;s.addShape(pres.shapes.OVAL,{x:6.92,y,w:0.32,h:0.32,fill:{color:C.slate},line:{color:C.slate}});s.addText(""+(i+1),{x:6.92,y,w:0.32,h:0.32,fontSize:11,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(p.h,{x:7.35,y:y-0.02,w:5.15,h:0.28,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(p.b,{x:7.35,y:y+0.26,w:5.15,h:0.38,fontSize:10,color:"3A5068",fontFace:FONT_BODY});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.6,w:12.28,h:0.6,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Main Strategist delivers to HITL Manager: full audit package ready for human review and approval",{x:0.38,y:6.6,w:12.28,h:0.6,fontSize:12,bold:true,color:C.teal,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,6,TOTAL,false);}

// SLIDE 7 - HITL
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.banner);
sectionHeader(s,"HITL Manager — Human-in-the-Loop","AI recommends. Humans decide. Every action is accountable.");
card(s,0.38,1.18,5.9,4.5,"FFFFFF",C.banner);
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:1.18,w:5.9,h:0.55,fill:{color:C.banner,transparency:10},line:{color:C.banner}});
s.addText("What HITL Manager receives:",{x:0.55,y:1.23,w:5.6,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD});
["Original document (any version, any condition)","All 4 HC-Node findings — individually labeled","HC-Strategist BNCA with confidence score","Main Strategist priority tier (P1-P4)","Recommended action and routing","Escalation flag if patient safety or urgent revenue risk","Full time-stamped audit trail from intake to review"].forEach((r,i)=>{s.addShape(pres.shapes.RECTANGLE,{x:0.48,y:1.85+i*0.49,w:0.26,h:0.26,fill:{color:C.banner},line:{color:C.banner}});s.addText("✓",{x:0.48,y:1.85+i*0.49,w:0.26,h:0.26,fontSize:10,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(r,{x:0.82,y:1.82+i*0.49,w:5.28,h:0.38,fontSize:11,color:C.navy,fontFace:FONT_BODY,valign:"middle"});});
card(s,6.88,1.18,5.9,4.5,"FFFFFF",C.teal);
s.addShape(pres.shapes.RECTANGLE,{x:6.88,y:1.18,w:5.9,h:0.55,fill:{color:C.teal,transparency:10},line:{color:C.teal}});
s.addText("What HITL Manager can do:",{x:7.05,y:1.23,w:5.6,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD});
[{a:"✅ Approve",b:"Accept BNCA and trigger action"},{a:"✏ Modify",b:"Edit BNCA before approval — reason logged"},{a:"↩ Return",b:"Send back to HC-Strategist with context"},{a:"⬆ Escalate",b:"Elevate to CMO, compliance, or dept head"},{a:"🚨 Flag urgent",b:"Override to P1 — same-day response"},{a:"🗂 Archive",b:"Mark resolved, saved to chart"}].forEach((a,i)=>{const ay=1.88+i*0.58;s.addShape(pres.shapes.RECTANGLE,{x:6.98,y:ay,w:5.68,h:0.48,fill:{color:C.tealLt},line:{color:C.teal,width:0.5}});s.addText(a.a,{x:7.06,y:ay,w:1.35,h:0.48,fontSize:11,bold:true,color:C.teal,fontFace:FONT_HEAD,valign:"middle"});s.addText(a.b,{x:8.45,y:ay,w:4.08,h:0.48,fontSize:10,color:"2A4060",fontFace:FONT_BODY,valign:"middle"});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:5.85,w:12.4,h:1.3,fill:{color:C.white,transparency:93},line:{color:C.teal,width:0.75}});
s.addText("Why HITL is non-negotiable: Regulatory compliance requires human sign-off · Liability stays with the institution · Edge cases handled by humans · Every GHS action is auditable and defensible.",{x:0.55,y:6.0,w:12.0,h:1.0,fontSize:10.5,color:"C8E0F4",fontFace:FONT_BODY,lineSpacingMultiple:1.35});
addSlideNum(s,7,TOTAL,true);}

// SLIDES 8-18 - Demo, Doc Dives, Narrative, Feature Guide, ROI, Implementation, Q&A, Close
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.teal);
contentTitle(s,"Live Demo — Document Library Walkthrough","Click any document type · Select version · Watch pipeline · Read the BNCA");
[{n:"1",label:"Open Demo Interface",icon:"🖥",detail:"GHS Healthcare Command\ninterface loaded at tsm-shell.fly.dev/html/ghs/"},{n:"2",label:"Choose Document Type",icon:"📂",detail:"8 types as clickable cards\nin the library panel"},{n:"3",label:"Select a Version",icon:"📄",detail:"v1=Incomplete\nv2=Partial/conflicting\nv3=Complete/clean"},{n:"4",label:"Click Process",icon:"▶",detail:"Activates full GHS\npipeline in real time"},{n:"5",label:"Watch HC-Nodes Fire",icon:"🔬",detail:"4 nodes light up:\nCoding·Comply·Clinical·Risk"},{n:"6",label:"See the BNCA",icon:"⚡",detail:"Best Next Course of Action\nwith HITL action item"}].forEach((st,i)=>{const x=0.38+(i%3)*4.28,y=i<3?1.1:3.7,w=4.05,h=2.35;card(s,x,y,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.OVAL,{x:x+0.15,y:y+0.12,w:0.45,h:0.45,fill:{color:C.teal},line:{color:C.teal}});s.addText(st.n,{x:x+0.15,y:y+0.12,w:0.45,h:0.45,fontSize:14,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(st.icon,{x:x+0.72,y:y+0.12,w:0.45,h:0.45,fontSize:22,align:"center",valign:"middle"});s.addText(st.label,{x:x+0.15,y:y+0.65,w:w-0.3,h:0.4,fontSize:14,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(st.detail,{x:x+0.15,y:y+1.08,w:w-0.3,h:1.1,fontSize:11,color:"4A5568",fontFace:FONT_BODY,lineSpacingMultiple:1.35});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.25,w:12.55,h:1.02,fill:{color:C.amberLt},line:{color:C.amber,width:0.75}});
s.addText("💡 Demo Tip: Run the BROKEN version (v1) first — then CLEAN (v3). The contrast between HOLD and APPROVE & SUBMIT lands the value instantly.",{x:0.55,y:6.35,w:12.0,h:0.82,fontSize:11,color:"5C3A00",fontFace:FONT_BODY,lineSpacingMultiple:1.3});
addSlideNum(s,8,TOTAL,false);}

// SLIDE 9 - Prior Auth Deep Dive
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
s.addText("🔐  Prior Authorization — Version Comparison",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Banner processes thousands of PAs monthly. 72-hr avg delay. >15% first-pass denial rate.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.red,fontFace:FONT_BODY,italic:true});
[{label:"v1 — Incomplete",issues:["Clinical notes missing","No imaging attached","Conservative tx history absent"],result:"HOLD — Cannot submit. 3 required fields missing.",color:C.red,lt:C.redLt},
{label:"v2 — Conflicting",issues:["Dual diagnosis conflict","Insurance policy EXPIRED","URGENT flag, no escalation path"],result:"URGENT HOLD — Two critical blockers. Same-day resolution required.",color:C.amber,lt:C.amberLt},
{label:"v3 — Complete",issues:["CPT 27447 + ICD-10 verified","Policy active through 12/2025","8-month PT failure documented"],result:"APPROVE & SUBMIT — Auto-approval expected 24-48hrs.",color:C.green,lt:C.greenLt}].forEach((v,vi)=>{const vx=0.35+vi*4.15;card(s,vx,1.12,4.0,4.15,v.lt,v.color);s.addShape(pres.shapes.RECTANGLE,{x:vx,y:1.12,w:4.0,h:0.52,fill:{color:v.color},line:{color:v.color}});s.addText(v.label,{x:vx+0.12,y:1.17,w:3.8,h:0.42,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});v.issues.forEach((issue,ii)=>{const iy=1.76+ii*0.58;s.addShape(pres.shapes.RECTANGLE,{x:vx+0.15,y:iy,w:3.7,h:0.5,fill:{color:C.white,transparency:30},line:{color:v.color,width:0.5}});s.addText("• "+issue,{x:vx+0.25,y:iy,w:3.55,h:0.5,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});s.addShape(pres.shapes.RECTANGLE,{x:vx+0.1,y:3.1,w:3.8,h:1.0,fill:{color:v.color,transparency:82},line:{color:v.color,width:0.75}});s.addText("BNCA: "+v.result,{x:vx+0.18,y:3.15,w:3.65,h:0.9,fontSize:10,color:C.dark,fontFace:FONT_BODY,lineSpacingMultiple:1.2,italic:true});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.42,w:12.55,h:0.68,fill:{color:C.tealLt},line:{color:C.teal,width:0.75}});
s.addText("GHS catches policy expiration and diagnosis conflict before submission — saving 2-3 days of payer back-and-forth.",{x:0.52,y:5.5,w:12.2,h:0.52,fontSize:11,color:"0D4A3E",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.18,w:12.55,h:0.55,fill:{color:C.navy},line:{color:C.navy}});
s.addText("🖱  DEMO: Click Prior Auth → v1 → Process → observe HOLD → v3 → Process → observe APPROVE",{x:0.5,y:6.18,w:12.3,h:0.55,fontSize:11,bold:true,color:C.teal,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,9,TOTAL,false);}

// SLIDE 10 - Discharge Summary
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
s.addText("🏥  Discharge Summary — Version Comparison",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("30-day readmission rates directly tied to documentation quality. Missing LACE scores are Banner top compliance gap.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.red,fontFace:FONT_BODY,italic:true});
[{label:"v1 — Minimal",issues:["No follow-up orders","Medication list incomplete","LACE score uncalculated"],result:"ESCALATE — Discharge cannot be finalized.",color:C.red,lt:C.redLt},
{label:"v2 — High Risk",issues:["LACE score: 14 (HIGH RISK)","Patient lives alone — no transport","Weight monitoring verbal only"],result:"INTERVENE — 5 immediate actions required before discharge.",color:C.amber,lt:C.amberLt},
{label:"v3 — Complete",issues:["TCM enrolled","Home health ordered next day","Cardiology + PCP within 7 days"],result:"APPROVE DISCHARGE — All readmission prevention in place.",color:C.green,lt:C.greenLt}].forEach((v,vi)=>{const vx=0.35+vi*4.15;card(s,vx,1.12,4.0,4.15,v.lt,v.color);s.addShape(pres.shapes.RECTANGLE,{x:vx,y:1.12,w:4.0,h:0.52,fill:{color:v.color},line:{color:v.color}});s.addText(v.label,{x:vx+0.12,y:1.17,w:3.8,h:0.42,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});v.issues.forEach((issue,ii)=>{const iy=1.76+ii*0.58;s.addShape(pres.shapes.RECTANGLE,{x:vx+0.15,y:iy,w:3.7,h:0.5,fill:{color:C.white,transparency:30},line:{color:v.color,width:0.5}});s.addText("• "+issue,{x:vx+0.25,y:iy,w:3.55,h:0.5,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});s.addShape(pres.shapes.RECTANGLE,{x:vx+0.1,y:3.1,w:3.8,h:1.0,fill:{color:v.color,transparency:82},line:{color:v.color,width:0.75}});s.addText("BNCA: "+v.result,{x:vx+0.18,y:3.15,w:3.65,h:0.9,fontSize:10,color:C.dark,fontFace:FONT_BODY,lineSpacingMultiple:1.2,italic:true});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.42,w:12.55,h:0.68,fill:{color:C.tealLt},line:{color:C.teal,width:0.75}});
s.addText("GHS catches solo-living + no-transport + verbal-only education — the exact profile that readmits within 30 days.",{x:0.52,y:5.5,w:12.2,h:0.52,fontSize:11,color:"0D4A3E",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.18,w:12.55,h:0.55,fill:{color:C.navy},line:{color:C.navy}});
s.addText("🖱  DEMO: Discharge Summary → v2 → show LACE 14 flag → v3 → APPROVE output",{x:0.5,y:6.18,w:12.3,h:0.55,fontSize:11,bold:true,color:C.teal,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,10,TOTAL,false);}

// SLIDE 11 - Claim Denial
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
s.addText("❌  Claim Denial — Version Comparison",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Banner loses millions to underpursued appeals. CO-97/CO-4 dual-code denials frequently misrouted or abandoned.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.red,fontFace:FONT_BODY,italic:true});
[{label:"v1 — Bare Denial",issues:["No appeal deadline stated","No contact information","Original claim not on file"],result:"INVESTIGATE — File cannot be appealed. Clock may be running.",color:C.red,lt:C.redLt},
{label:"v2 — Conflicting Codes",issues:["CO-97 + CO-4 dual code conflict","Original claim missing","Appeal deadline: 05/10/2025"],result:"APPEAL RECOMMENDED — Dual-code = payer error. Act by 05/05.",color:C.amber,lt:C.amberLt},
{label:"v3 — Actionable",issues:["CO-97 resolved: BCB-99100 paid","Full contact info present","Clinical notes + remit required"],result:"EXECUTE APPEAL — Pull remit, submit before 05/05.",color:C.green,lt:C.greenLt}].forEach((v,vi)=>{const vx=0.35+vi*4.15;card(s,vx,1.12,4.0,4.15,v.lt,v.color);s.addShape(pres.shapes.RECTANGLE,{x:vx,y:1.12,w:4.0,h:0.52,fill:{color:v.color},line:{color:v.color}});s.addText(v.label,{x:vx+0.12,y:1.17,w:3.8,h:0.42,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});v.issues.forEach((issue,ii)=>{const iy=1.76+ii*0.58;s.addShape(pres.shapes.RECTANGLE,{x:vx+0.15,y:iy,w:3.7,h:0.5,fill:{color:C.white,transparency:30},line:{color:v.color,width:0.5}});s.addText("• "+issue,{x:vx+0.25,y:iy,w:3.55,h:0.5,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});s.addShape(pres.shapes.RECTANGLE,{x:vx+0.1,y:3.1,w:3.8,h:1.0,fill:{color:v.color,transparency:82},line:{color:v.color,width:0.75}});s.addText("BNCA: "+v.result,{x:vx+0.18,y:3.15,w:3.65,h:0.9,fontSize:10,color:C.dark,fontFace:FONT_BODY,lineSpacingMultiple:1.2,italic:true});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.42,w:12.55,h:0.68,fill:{color:C.tealLt},line:{color:C.teal,width:0.75}});
s.addText("GHS identifies CO-97+CO-4 as payer error signature — routes to appeals, not write-off.",{x:0.52,y:5.5,w:12.2,h:0.52,fontSize:11,color:"0D4A3E",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.18,w:12.55,h:0.55,fill:{color:C.navy},line:{color:C.navy}});
s.addText("🖱  DEMO: Claim Denial → v1 → show revenue risk → v3 → EXECUTE APPEAL output",{x:0.5,y:6.18,w:12.3,h:0.55,fontSize:11,bold:true,color:C.teal,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,11,TOTAL,false);}

// SLIDE 12 - Med Recon
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
s.addText("💊  Medication Reconciliation — Version Comparison",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Med discrepancies are #1 cause of preventable adverse events during care transitions. Manual misses ~30% of dose errors.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.red,fontFace:FONT_BODY,italic:true});
[{label:"v1 — Unverified",issues:["Patient unable to list meds","No pharmacy pull","INR status unknown"],result:"STOP — Do not administer. Pull pharmacy records immediately.",color:C.red,lt:C.redLt},
{label:"v2 — Discrepancy Found",issues:["Metoprolol: 25mg home vs 50mg ordered","Atorvastatin missing from orders","INR 4.2 — supratherapeutic, no hold"],result:"URGENT INTERVENTION — 3 patient safety events identified.",color:C.amber,lt:C.amberLt},
{label:"v3 — Reconciled",issues:["All discrepancies corrected + cosigned","INR hold ordered, recheck 04/24","Allergy upgraded: Penicillin → Anaphylaxis"],result:"COMPLETE — Reconciliation verified. No further action.",color:C.green,lt:C.greenLt}].forEach((v,vi)=>{const vx=0.35+vi*4.15;card(s,vx,1.12,4.0,4.15,v.lt,v.color);s.addShape(pres.shapes.RECTANGLE,{x:vx,y:1.12,w:4.0,h:0.52,fill:{color:v.color},line:{color:v.color}});s.addText(v.label,{x:vx+0.12,y:1.17,w:3.8,h:0.42,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});v.issues.forEach((issue,ii)=>{const iy=1.76+ii*0.58;s.addShape(pres.shapes.RECTANGLE,{x:vx+0.15,y:iy,w:3.7,h:0.5,fill:{color:C.white,transparency:30},line:{color:v.color,width:0.5}});s.addText("• "+issue,{x:vx+0.25,y:iy,w:3.55,h:0.5,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});s.addShape(pres.shapes.RECTANGLE,{x:vx+0.1,y:3.1,w:3.8,h:1.0,fill:{color:v.color,transparency:82},line:{color:v.color,width:0.75}});s.addText("BNCA: "+v.result,{x:vx+0.18,y:3.15,w:3.65,h:0.9,fontSize:10,color:C.dark,fontFace:FONT_BODY,lineSpacingMultiple:1.2,italic:true});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.42,w:12.55,h:0.68,fill:{color:C.tealLt},line:{color:C.teal,width:0.75}});
s.addText("GHS catches INR 4.2 + no hold order — a bleeding event waiting to happen — before any dose is administered.",{x:0.52,y:5.5,w:12.2,h:0.52,fontSize:11,color:"0D4A3E",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.18,w:12.55,h:0.55,fill:{color:C.navy},line:{color:C.navy}});
s.addText("🖱  DEMO: Med Reconciliation → v2 → show 3 patient safety flags → v3 → COMPLETE",{x:0.5,y:6.18,w:12.3,h:0.55,fontSize:11,bold:true,color:C.teal,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,12,TOTAL,false);}

// SLIDE 13 - NARRATIVE SCRIPT
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.mint);
sectionHeader(s,"Real-Time Narrative — What the Audience Sees","Follow this script during the live demo.");
[{time:"0:00",action:"Open Demo Interface",say:"This is GHS Healthcare Command. Every document type Banner encounters is already loaded.",color:C.steel},
{time:"0:15",action:"Click Prior Auth — v1",say:"Here is what an incomplete PA looks like when it hits your queue. Let us run it.",color:C.steel},
{time:"0:22",action:"Click Process",say:"Watch the nodes — Coding, Compliance, Clinical, Risk — all firing simultaneously.",color:C.teal},
{time:"0:45",action:"BNCA: HOLD",say:"Policy expired. Diagnosis conflict. This would have gone to payer and been denied in 72 hours.",color:C.red},
{time:"1:00",action:"Switch to v3",say:"Same PA — fully documented. Same workflow, same button.",color:C.teal},
{time:"1:30",action:"BNCA: APPROVE",say:"Auto-approval expected 24-48 hours. No manual review. No phone call to the physician.",color:C.green},
{time:"1:45",action:"Med Recon — v2",say:"Patient safety scenario. This is where AI saves lives, not just time.",color:C.amber},
{time:"2:00",action:"URGENT flags",say:"INR 4.2 with no hold order. Metoprolol doubled. Atorvastatin missing. Three events.",color:C.red},
{time:"2:20",action:"Pause",say:"That patient was 90 seconds from a dangerous dose. GHS caught it at intake.",color:C.red},
{time:"2:35",action:"Claim Denial",say:"CO-97 + CO-4 — this is usually written off. GHS routes it to appeals.",color:C.mint}].forEach((b,i)=>{const y=1.2+i*0.54;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.48,fill:{color:C.white,transparency:93},line:{color:b.color,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:0.65,h:0.48,fill:{color:b.color,transparency:20},line:{color:b.color,transparency:20}});s.addText(b.time,{x:0.35,y,w:0.65,h:0.48,fontSize:10,bold:true,color:b.color,align:"center",valign:"middle",fontFace:FONT_BODY});s.addText(b.action,{x:1.1,y:y+0.04,w:2.5,h:0.4,fontSize:10.5,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});s.addText(b.say,{x:3.75,y:y+0.04,w:9.0,h:0.4,fontSize:10,color:"B8D0E8",fontFace:FONT_BODY,valign:"middle",italic:true});});
addSlideNum(s,13,TOTAL,true);}

// SLIDE 14 - FEATURE GUIDE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.steel);
contentTitle(s,"App Feature Guide — Exact Buttons & Actions","Reference during the demo to navigate GHS Healthcare Command confidently");
[{zone:"Document Library Panel",color:C.steel,items:[{btn:"Document Type Card",action:"Click any of 8 cards — turns blue (active). Shows raw document text in preview pane."},{btn:"v1 / v2 / v3 pills",action:"Version selector under each card. v1=broken, v2=partial, v3=complete. Active pill turns info-blue."},{btn:"Document Preview",action:"Auto-appears below cards showing raw document text when version selected."}]},
{zone:"Pipeline Control",color:C.teal,items:[{btn:"DEPLOY button",action:"Main CTA — activates full GHS pipeline. Active once document version selected."},{btn:"SYNTHESIZE button",action:"Alternate trigger — same pipeline, different entry point for synthesis-first workflows."},{btn:"Stage indicators",action:"5 stages animate: idle (—) → active (spinner) → complete (checkmark)."}]},
{zone:"BNCA Output Panel",color:C.mint,items:[{btn:"Node Confidence scores",action:"Per-node percentage scores showing AI confidence for each HC-Node analysis."},{btn:"BNCA Recommendation",action:"HC-Strategist synthesized Best Next Course of Action — specific and actionable."},{btn:"HITL Action row",action:"What the human manager does next. Ties AI output to real workflow."}]},
{zone:"Live Interface",color:C.slate,items:[{btn:"tsm-shell.fly.dev/html/ghs/",action:"Open in Chrome alongside this deck. Alt-tab between slides and demo."},{btn:"GROQ key (localStorage)",action:"Set once: window.__GROQ_KEY__ = gsk_... Persists across all refreshes."},{btn:"Node confidence grid",action:"Bottom of BNCA panel — shows Operations, Medical, Pharmacy, Insurance scores live."}]}].forEach((f,i)=>{const col=i%2,row=Math.floor(i/2),fx=0.35+col*6.25,fy=1.05+row*2.7,w=6.1,h=2.55;card(s,fx,fy,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x:fx,y:fy,w,h:0.45,fill:{color:f.color},line:{color:f.color}});s.addText(f.zone,{x:fx+0.12,y:fy+0.04,w:w-0.2,h:0.37,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});f.items.forEach((item,j)=>{const iy=fy+0.58+j*0.6;s.addShape(pres.shapes.RECTANGLE,{x:fx+0.12,y:iy,w:1.55,h:0.48,fill:{color:f.color,transparency:82},line:{color:f.color,width:0.5}});s.addText(item.btn,{x:fx+0.15,y:iy,w:1.5,h:0.48,fontSize:9.5,bold:true,color:C.dark,fontFace:FONT_HEAD,valign:"middle",align:"center"});s.addText(item.action,{x:fx+1.78,y:iy,w:w-1.92,h:0.48,fontSize:10,color:"3A4A5E",fontFace:FONT_BODY,valign:"middle"});});});
addSlideNum(s,14,TOTAL,false);}

// SLIDE 15 - ROI
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.teal);
sectionHeader(s,"The Banner Health Impact","Conservative projections based on industry benchmarks and Banner document volumes");
[{category:"Prior Authorizations",before:"72-hr avg review",after:"< 2 hrs with GHS",impact:"Faster approvals, fewer missed treatment windows"},
{category:"Claim Denials",before:"15-25% first-pass denial",after:"< 5% with GHS pre-check",impact:"$2-8M annually recovered from denied claims"},
{category:"Discharge Summaries",before:"Manual LACE scoring, missed follow-ups",after:"Auto-scored, TCM auto-triggered",impact:"30-day readmission rate reduction 18-25%"},
{category:"Medication Reconciliation",before:"~30% of transitions miss discrepancy",after:"100% verified before administration",impact:"Adverse drug events reduced, malpractice exposure lowered"},
{category:"Compliance & Audit",before:"Reactive — discovered at audit",after:"Proactive — caught at intake",impact:"Zero surprise CMS findings. Every document defensible."},
{category:"Staff Efficiency",before:"Hours per document type",after:"Minutes with HITL approval",impact:"Clinical staff time freed for patient care"}].forEach((m,i)=>{const y=1.22+i*0.88;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.78,fill:{color:C.white,transparency:93},line:{color:"FFFFFF",transparency:85,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:2.75,h:0.78,fill:{color:C.navy,transparency:60},line:{color:C.teal,width:0.5}});s.addText(m.category,{x:0.42,y,w:2.62,h:0.78,fontSize:11,bold:true,color:C.teal,fontFace:FONT_HEAD,valign:"middle"});s.addShape(pres.shapes.RECTANGLE,{x:3.18,y:y+0.08,w:2.55,h:0.62,fill:{color:C.redLt,transparency:20},line:{color:C.red,width:0.5}});s.addText("BEFORE  "+m.before,{x:3.25,y:y+0.08,w:2.45,h:0.62,fontSize:10,color:C.white,fontFace:FONT_BODY,valign:"middle"});s.addShape(pres.shapes.RECTANGLE,{x:5.85,y:y+0.08,w:2.55,h:0.62,fill:{color:C.greenLt,transparency:20},line:{color:C.green,width:0.5}});s.addText("WITH GHS  "+m.after,{x:5.92,y:y+0.08,w:2.45,h:0.62,fontSize:10,color:C.white,fontFace:FONT_BODY,valign:"middle"});s.addText(m.impact,{x:8.55,y,w:4.25,h:0.78,fontSize:10,color:"AAC4E0",fontFace:FONT_BODY,valign:"middle",italic:true});});
s.addText("GHS Healthcare Command pays for itself in recovered claims alone — everything else is operational and clinical upside.",{x:0.35,y:7.08,w:12.55,h:0.28,fontSize:11,bold:true,color:C.teal,align:"center",fontFace:FONT_BODY});
addSlideNum(s,15,TOTAL,true);}

// SLIDE 16 - IMPLEMENTATION
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
contentTitle(s,"Implementation — How GHS Integrates with Banner","No rip-and-replace. GHS layers on existing systems and adds value from day one.");
[{phase:"Phase 1",label:"Connect & Configure",duration:"Weeks 1-3",color:C.steel,steps:["API integration with Banner EHR (Epic/Cerner)","Document intake mapping for all 8 doc types","Payer rule library loaded (BlueCross, Aetna, Medicare)","HITL Manager dashboard configured for Banner workflows"]},
{phase:"Phase 2",label:"Pilot & Calibrate",duration:"Weeks 4-8",color:C.teal,steps:["Select 2-3 highest-pain doc types for pilot","HC-Nodes calibrated on Banner denial patterns","BNCA accuracy reviewed daily with clinical team","Feedback loop with Main Strategist for Banner-specific rules"]},
{phase:"Phase 3",label:"Full Deployment",duration:"Week 9+",color:C.mint,steps:["All 8 document types live","HITL queue integrated into Banner approval workflows","Real-time dashboards for volume, accuracy, and ROI","Monthly calibration reviews and model updates"]}].forEach((ph,i)=>{const px=0.35+i*4.2,w=4.1,h=4.35,y=1.08;card(s,px,y,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x:px,y,w,h:0.9,fill:{color:ph.color},line:{color:ph.color}});s.addText(ph.phase,{x:px+0.15,y:y+0.05,w:w-0.25,h:0.3,fontSize:11,bold:true,color:"D4EEF8",fontFace:FONT_BODY});s.addText(ph.label,{x:px+0.15,y:y+0.32,w:w-0.25,h:0.35,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(ph.duration,{x:px+0.15,y:y+0.65,w:w-0.25,h:0.22,fontSize:10,color:"D4EEF8",fontFace:FONT_BODY});ph.steps.forEach((step,j)=>{const sy=y+1.08+j*0.78;s.addShape(pres.shapes.RECTANGLE,{x:px+0.15,y:sy,w:w-0.3,h:0.68,fill:{color:"F4F8FE"},line:{color:"DDEAF5",width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:px+0.15,y:sy,w:0.05,h:0.68,fill:{color:ph.color},line:{color:ph.color}});s.addText(step,{x:px+0.27,y:sy,w:w-0.45,h:0.68,fontSize:10.5,color:C.navy,fontFace:FONT_BODY,valign:"middle"});});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.55,w:12.55,h:0.5,fill:{color:C.ghostWhite},line:{color:"DDEAF5"}});
s.addText("Integrates with: Epic · Cerner · athenahealth · Change Healthcare · Availity · HL7 FHIR R4 compliant",{x:0.5,y:5.55,w:12.28,h:0.5,fontSize:10.5,color:C.slate,fontFace:FONT_BODY,valign:"middle",align:"center"});
s.addText("Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed.",{x:0.35,y:6.15,w:12.55,h:0.38,fontSize:10,color:C.muted,fontFace:FONT_BODY,align:"center"});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.65,w:12.55,h:0.58,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Banner can be processing real documents through GHS Healthcare Command within 3 weeks of agreement.",{x:0.5,y:6.65,w:12.28,h:0.58,fontSize:13,bold:true,color:C.teal,align:"center",valign:"middle",fontFace:FONT_HEAD});
addSlideNum(s,16,TOTAL,false);}

// SLIDE 17 - Q&A
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.amber);
sectionHeader(s,"Anticipated Questions — Prepared Answers","Be ready for these. Every answer reinforces GHS value and Banner fit.");
[{q:"How does GHS handle edge cases the nodes have not seen before?",a:"HC-Strategist routes low-confidence outputs to HITL Manager automatically. Unknown patterns trigger a learning flag for model calibration."},
{q:"What happens if the AI is wrong?",a:"Every BNCA is reviewed by HITL Manager before any action is taken. AI recommends; Banner people decide. Full audit trail means errors are caught, not buried."},
{q:"How does this work with our existing Epic/Cerner workflows?",a:"GHS integrates via HL7 FHIR R4 API. Documents pulled from existing workflows, BNCA outputs pushed back into Epic task queue or your PA/UM system."},
{q:"Is patient data leaving Banner systems?",a:"Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed."},
{q:"How do you validate accuracy before going live?",a:"Phase 2 is a calibration period — BNCA outputs reviewed daily against Banner actual decisions. We hit >92% agreement before expanding."},
{q:"What does it cost and what is the ROI model?",a:"Pricing is per document volume. At Banner scale, recovered denials alone typically return 4-8x the annual contract value in year one."}].forEach((qa,i)=>{const y=1.2+i*0.9;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.82,fill:{color:C.white,transparency:93},line:{color:"FFFFFF",transparency:85,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:0.35,h:0.82,fill:{color:C.amber,transparency:20},line:{color:C.amber,transparency:20}});s.addText("Q",{x:0.35,y,w:0.35,h:0.82,fontSize:14,bold:true,color:C.amber,align:"center",valign:"middle"});s.addText(qa.q,{x:0.82,y:y+0.05,w:11.95,h:0.3,fontSize:11,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(qa.a,{x:0.82,y:y+0.38,w:11.95,h:0.4,fontSize:10.5,color:"AAC4E0",fontFace:FONT_BODY,lineSpacingMultiple:1.2});});
addSlideNum(s,17,TOTAL,true);}

// SLIDE 18 - CLOSE
{const s=pres.addSlide();bgNavy(s);
s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.08,h:7.5,fill:{color:C.teal},line:{color:C.teal}});
s.addShape(pres.shapes.RECTANGLE,{x:0.55,y:0.45,w:1.6,h:0.55,fill:{color:C.teal},line:{color:C.teal}});
s.addText("GHS",{x:0.55,y:0.45,w:1.6,h:0.55,fontSize:20,bold:true,color:C.white,align:"center",valign:"middle",fontFace:FONT_HEAD,margin:0});
s.addText("Healthcare Command",{x:2.3,y:0.55,w:5.5,h:0.38,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText("What happens next",{x:0.55,y:1.3,w:9.5,h:0.65,fontSize:42,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText("is up to Banner.",{x:0.55,y:1.9,w:9.5,h:0.65,fontSize:42,bold:true,color:C.teal,fontFace:FONT_HEAD});
[{n:"1",label:"Technical discovery call",sub:"Map GHS intake to Banner document workflows — 1 hour"},
{n:"2",label:"Identify 2 pilot doc types",sub:"Select highest-pain types for Phase 2 calibration"},
{n:"3",label:"Sign pilot agreement",sub:"3-week onboarding, no long-term commitment required"},
{n:"4",label:"Go live — see results",sub:"Real Banner documents, real BNCA outputs, real ROI data"}].forEach((st,i)=>{const y=2.82+i*0.85;s.addShape(pres.shapes.OVAL,{x:0.55,y:y+0.04,w:0.42,h:0.42,fill:{color:C.teal},line:{color:C.teal}});s.addText(st.n,{x:0.55,y:y+0.04,w:0.42,h:0.42,fontSize:14,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(st.label,{x:1.1,y,w:6.0,h:0.4,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(st.sub,{x:1.1,y:y+0.4,w:6.0,h:0.38,fontSize:11,color:"AAC4E0",fontFace:FONT_BODY});});
card(s,9.2,1.3,3.9,4.6,"FFFFFF",C.teal);
s.addShape(pres.shapes.RECTANGLE,{x:9.2,y:1.3,w:3.9,h:0.55,fill:{color:C.teal},line:{color:C.teal}});
s.addText("Ready to start?",{x:9.35,y:1.36,w:3.6,h:0.42,fontSize:15,bold:true,color:C.white,fontFace:FONT_HEAD});
[{label:"Platform",val:"Healthcare Command"},{label:"Pilot timeline",val:"3 weeks to first live doc"},{label:"Contract",val:"Pilot-first, no lock-in"},{label:"Pilot data",val:"Synthetic / de-identified only"},{label:"Integration",val:"HL7 FHIR R4 ready"},{label:"URL",val:"tsm-shell.fly.dev/html/ghs/"}].forEach((ci,i)=>{s.addText(ci.label,{x:9.35,y:2.0+i*0.55,w:1.5,h:0.42,fontSize:10,bold:true,color:C.muted,fontFace:FONT_BODY});s.addText(ci.val,{x:10.9,y:2.0+i*0.55,w:2.08,h:0.42,fontSize:11,bold:true,color:C.navy,fontFace:FONT_BODY});});
s.addText("GHS Healthcare Command. Every document enters. Every action is accountable.",{x:0.55,y:6.95,w:12.3,h:0.35,fontSize:11,color:C.muted,fontFace:FONT_BODY,align:"center"});
addSlideNum(s,18,TOTAL,true);}

// SAVE
pres.writeFile({fileName:"/workspaces/tsm-shell/GHS_BannerHealth_Presentation.pptx"})
  .then(()=>console.log("✅ Saved: GHS_BannerHealth_Presentation.pptx"))
  .catch(e=>{console.error("❌",e);process.exit(1);});
