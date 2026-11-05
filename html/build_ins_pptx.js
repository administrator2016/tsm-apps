const PptxGenJS = require("pptxgenjs");
const pres = new PptxGenJS();
pres.layout = "LAYOUT_WIDE";
const TOTAL = 18;
const FONT_HEAD = "Trebuchet MS";
const FONT_BODY = "Calibri";
const C = {
  navy:"0B1628", navy2:"152338", gold:"C9A84C", gold2:"E8C870",
  teal:"2A9D8F", teal2:"3BBFAF", mint:"34D399",
  green:"10B981", greenLt:"D1FAE5",
  red:"EF4444", redLt:"FEE2E2",
  amber:"F59E0B", amberLt:"FEF3C7",
  steel:"4A6A8A", slate:"334155",
  purple:"7C3AED", purpleLt:"EDE9FE",
  white:"FFFFFF", offWhite:"F8F5EF",
  muted:"5A6A80", dark:"1A2838",
  ghostWhite:"F0F4F8",
};
function bgNavy(s){s.background={color:C.navy};}
function bgWhite(s){s.background={color:C.offWhite};}
function addSideBar(s,color){s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.18,h:7.5,fill:{color:color||C.gold},line:{color:color||C.gold}});}
function addSlideNum(s,n,total,light){s.addText(n+" / "+total,{x:12.3,y:7.15,w:0.9,h:0.25,fontSize:9,color:light?C.white:C.muted,align:"right",fontFace:FONT_BODY});}
function pill(s,label,x,y,w,bg,fg){s.addShape(pres.shapes.ROUNDED_RECTANGLE,{x,y,w:w||1.4,h:0.28,fill:{color:bg},line:{color:bg},rectRadius:0.14});s.addText(label,{x,y,w:w||1.4,h:0.28,fontSize:9,bold:true,color:fg,align:"center",valign:"middle",fontFace:FONT_BODY,margin:0});}
function card(s,x,y,w,h,fillColor,strokeColor){s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:fillColor||C.white},line:{color:strokeColor||"DDEAF5",width:0.75},shadow:{type:"outer",color:"0B1628",blur:8,offset:2,angle:135,opacity:0.07}});}
function sectionHeader(s,text,sub){s.addText(text,{x:0.35,y:0.22,w:12.6,h:0.52,fontSize:28,bold:true,color:C.white,fontFace:FONT_HEAD,align:"left"});if(sub)s.addText(sub,{x:0.35,y:0.76,w:12.6,h:0.3,fontSize:13,color:C.gold2,fontFace:FONT_BODY,align:"left"});}
function contentTitle(s,text,sub){s.addText(text,{x:0.35,y:0.18,w:12.6,h:0.5,fontSize:24,bold:true,color:C.navy,fontFace:FONT_HEAD,align:"left"});if(sub)s.addText(sub,{x:0.35,y:0.68,w:12.6,h:0.28,fontSize:12,color:C.steel,fontFace:FONT_BODY,align:"left"});}
function makeShadow(){return {type:"outer",color:"000000",blur:6,offset:2,angle:135,opacity:0.12};}

// SLIDE 1 - COVER
{const s=pres.addSlide();bgNavy(s);
s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.06,h:7.5,fill:{color:C.gold},line:{color:C.gold}});
s.addShape(pres.shapes.RECTANGLE,{x:9.5,y:0,w:3.8,h:3.2,fill:{color:C.gold,transparency:92},line:{color:C.gold,transparency:92}});
s.addShape(pres.shapes.RECTANGLE,{x:0.55,y:0.55,w:1.6,h:0.55,fill:{color:C.gold},line:{color:C.gold}});
s.addText("TSM",{x:0.55,y:0.55,w:1.6,h:0.55,fontSize:20,bold:true,color:C.navy,align:"center",valign:"middle",fontFace:FONT_HEAD,margin:0});
s.addShape(pres.shapes.RECTANGLE,{x:2.35,y:0.67,w:2.6,h:0.3,fill:{color:C.teal},line:{color:C.teal}});
s.addText("Insurance Intelligence Suite",{x:2.35,y:0.67,w:2.6,h:0.3,fontSize:10,bold:true,color:C.white,align:"center",valign:"middle",fontFace:FONT_BODY,margin:0});
s.addText("TSM Insurance",{x:0.55,y:1.55,w:9.5,h:0.85,fontSize:56,bold:true,color:C.white,fontFace:FONT_HEAD,align:"left"});
s.addText("Intelligence Suite",{x:0.55,y:2.3,w:9.5,h:0.85,fontSize:56,bold:true,color:C.gold2,fontFace:FONT_HEAD,align:"left"});
s.addText("AI-Powered Tools for Every Line of Business\nMedicare · ACA · P&C · Life · DME · Compliance · Agent Intelligence",{x:0.55,y:3.28,w:9.0,h:0.7,fontSize:15,color:"AAC4E0",fontFace:FONT_BODY,align:"left",lineSpacingMultiple:1.35});
[{v:"5",l:"AI-Powered Apps"},{v:"< 60s",l:"Quote to BNCA"},{v:"100%",l:"Audit Trail"}].forEach((st,i)=>{const bx=0.55+i*3.0;s.addShape(pres.shapes.RECTANGLE,{x:bx,y:4.3,w:2.7,h:1.1,fill:{color:"FFFFFF",transparency:92},line:{color:C.gold,width:0.75}});s.addText(st.v,{x:bx,y:4.38,w:2.7,h:0.55,fontSize:32,bold:true,color:C.gold2,align:"center",valign:"middle",fontFace:FONT_HEAD});s.addText(st.l,{x:bx,y:4.9,w:2.7,h:0.4,fontSize:11,color:"AAC4E0",align:"center",fontFace:FONT_BODY});});
s.addText("TSMatter · NPN 18818059 · Licensed AZ Producer · AI Intelligence for Insurance Professionals",{x:0.55,y:6.9,w:12.2,h:0.3,fontSize:10,color:C.muted,fontFace:FONT_BODY,align:"left"});
addSlideNum(s,1,TOTAL,true);}

// SLIDE 2 - PROBLEM
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.red);
contentTitle(s,"The Insurance Gap — What AI Solves Today","Agents, agencies, and carriers are leaving revenue, compliance, and clients on the table every day.");
s.addShape(pres.shapes.RECTANGLE,{x:9.8,y:0.15,w:3.3,h:0.65,fill:{color:C.redLt},line:{color:C.red,width:0.5}});
s.addText("$17B lost annually to insurance admin inefficiency (ACLI)",{x:9.8,y:0.15,w:3.3,h:0.65,fontSize:10,color:C.red,align:"center",valign:"middle",fontFace:FONT_BODY,bold:true});
const problems=[
{icon:"📋",type:"Prior Auth & Enrollment",pain:"Manual eligibility checks\nSlow plan comparisons\nMissed enrollment windows"},
{icon:"💊",type:"Medicare & DME",pain:"Unclaimed Part B benefits\nNo automated benefit check\nAgent time wasted on lookup"},
{icon:"❌",type:"Claim Denials",pain:"Low appeal rates\nDeadlines missed\nDenial codes misrouted"},
{icon:"📑",type:"Compliance & Audits",pain:"State regs change constantly\nCMS rule gaps undetected\nE&O exposure from misadvice"},
{icon:"🏢",type:"P&C Operations",pain:"Quote cycle too slow\nCarrier appetite mismatches\nRenewal leakage"},
{icon:"👤",type:"Agent Productivity",pain:"Hours on carrier portals\nNo real-time market intel\nNew agent ramp time: 6+ months"},
{icon:"💼",type:"Agency Management",pain:"No cross-sell visibility\nClient retention reactive\nBook analysis manual"},
{icon:"📊",type:"Carrier Intelligence",pain:"Loss ratio blind spots\nUnderwriting gaps\nNo predictive risk scoring"}];
problems.forEach((p,i)=>{const col=i%4,row=Math.floor(i/4),x=0.35+col*3.12,y=1.08+row*1.64;
card(s,x,y,3.0,1.52,C.white,"DDEAF5");
s.addShape(pres.shapes.RECTANGLE,{x,y,w:0.06,h:1.52,fill:{color:C.red},line:{color:C.red}});
s.addText(p.icon,{x:x+0.15,y:y+0.08,w:0.4,h:0.35,fontSize:18});
s.addText(p.type,{x:x+0.55,y:y+0.1,w:2.35,h:0.35,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText(p.pain,{x:x+0.15,y:y+0.5,w:2.75,h:0.9,fontSize:10,color:"4A5568",fontFace:FONT_BODY,lineSpacingMultiple:1.3});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.95,w:12.6,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("TSM Insurance Intelligence addresses all 8 problem areas simultaneously — with AI nodes built for insurance workflows.",{x:0.35,y:6.95,w:12.6,h:0.38,fontSize:11,bold:true,color:C.gold2,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,2,TOTAL,false);}

// SLIDE 3 - SUITE OVERVIEW
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.gold);
sectionHeader(s,"TSM Insurance Intelligence Suite","5 AI-powered apps. Every line of business. One intelligence layer.");
const apps=[
{icon:"🏛",name:"AZ Insurance Command",sub:"Full-spectrum insurance operations dashboard",bullets:["Medicare · ACA · Life · P&C tabs","Live compliance monitoring","Carrier appetite matrix","BNCA-powered recommendations"],color:C.teal},
{icon:"💊",name:"DME Benefits Engine",sub:"Medicare Part B benefit maximizer for agents and clients",bullets:["8 DME categories auto-checked","Eligibility verification","Client-facing benefit guide","Lead generation built in"],color:C.gold},
{icon:"🤝",name:"Agents Intelligence",sub:"AI platform for agents, agencies, and carriers",bullets:["Real-time market intelligence","Carrier rule library","Cross-sell opportunity engine","Training and compliance AI"],color:C.mint},
{icon:"🏢",name:"P&C Enterprise Command",sub:"Property & casualty operations command center",bullets:["Quote pipeline management","Loss ratio analytics","Underwriting gap detection","Renewal risk scoring"],color:C.purple},
{icon:"💰",name:"TSM Pricing Engine",sub:"Transparent value-based pricing for every client",bullets:["Per-user or volume pricing","ROI calculator built in","Tier comparison view","Custom enterprise quotes"],color:C.steel}];
apps.forEach((app,i)=>{const x=0.35+i*2.55,y=1.18,w=2.42,h=5.42;
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h,fill:{color:C.white,transparency:93},line:{color:app.color,width:1.0}});
s.addShape(pres.shapes.RECTANGLE,{x,y,w,h:0.72,fill:{color:app.color,transparency:12},line:{color:app.color}});
s.addText(app.icon+"  "+app.name,{x:x+0.1,y:y+0.05,w:w-0.18,h:0.35,fontSize:10,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText(app.sub,{x:x+0.1,y:y+0.42,w:w-0.18,h:0.28,fontSize:8.5,color:"C8E0F4",fontFace:FONT_BODY});
app.bullets.forEach((b,j)=>{const iy=y+0.88+j*0.58;
s.addShape(pres.shapes.RECTANGLE,{x:x+0.1,y:iy,w:w-0.2,h:0.5,fill:{color:C.white,transparency:88},line:{color:"FFFFFF",transparency:80,width:0.5}});
s.addShape(pres.shapes.RECTANGLE,{x:x+0.1,y:iy,w:0.04,h:0.5,fill:{color:app.color},line:{color:app.color}});
s.addText(b,{x:x+0.2,y:iy,w:w-0.32,h:0.5,fontSize:9.5,color:C.white,fontFace:FONT_BODY,valign:"middle"});});});
s.addText("All 5 apps share the same BNCA intelligence layer — every recommendation is auditable, human-reviewed, and actionable.",{x:0.35,y:6.82,w:12.6,h:0.4,fontSize:12,bold:true,color:C.gold2,align:"center",fontFace:FONT_BODY});
addSlideNum(s,3,TOTAL,true);}

// SLIDE 4 - PIPELINE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.teal);
contentTitle(s,"The TSM Insurance Pipeline","From client question to HITL-approved action — every step tracked, every decision logged");
const stages=[
{icon:"📥",name:"Document\n& Query Intake",sub:"Any line · Any doc\nAny question",color:C.steel,x:0.38},
{icon:"🔬",name:"AI Nodes\n(4 Parallel)",sub:"Compliance · Coverage\nClaims · Risk",color:C.teal,x:2.82},
{icon:"🧠",name:"Insurance\nStrategist",sub:"Synthesizes nodes\ninto BNCA",color:C.gold,x:5.26},
{icon:"📊",name:"Main\nStrategist",sub:"Priority · Escalation\nCarrier routing",color:C.slate,x:7.7},
{icon:"👤",name:"HITL\nManager",sub:"Human review\nFinal approval",color:C.purple,x:10.14}];
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
["Compliance Node → state reg gaps, CMS rules, E&O exposure flagged","Coverage Node → plan-to-need match, gaps identified, alternatives ranked","Claims Node → denial probability, appeal path, deadline tracked","Risk Node → carrier appetite match, loss ratio exposure, escalation path","Insurance Strategist → synthesizes all 4 nodes into single BNCA","Main Strategist → assigns urgency, routes to agent, compliance, or HITL"].forEach((item,i)=>{const col=i<3?0.55:6.85;s.addText("• "+item,{x:col,y:4.5+i%3*0.33,w:6.1,h:0.3,fontSize:10,color:"1A5C3A",fontFace:FONT_BODY});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:5.72,w:12.55,h:0.52,fill:{color:C.purpleLt},line:{color:C.purple,width:0.75}});
s.addText("👤  HITL Manager — Reviews BNCA, approves or modifies action, full audit trail. Every decision accountable.",{x:0.55,y:5.72,w:12.2,h:0.52,fontSize:11,color:C.purple,fontFace:FONT_BODY,valign:"middle"});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.38,w:12.55,h:0.42,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Total pipeline time: under 60 seconds · Zero manual carrier lookup · 100% audit trail",{x:0.38,y:6.38,w:12.55,h:0.42,fontSize:11,bold:true,color:C.gold2,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,4,TOTAL,false);}

// SLIDE 5 - AI NODES
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.mint);
sectionHeader(s,"The Insurance AI Nodes — 4 Parallel Analyzers","Every query and document processed simultaneously across all four nodes.");
const nodes=[
{icon:"📋",name:"Compliance Node",color:C.teal,what:"Checks state, federal, and CMS requirements",catches:["State-specific insurance regs","CMS Medicare/Medicaid rules","E&O exposure flags","Required disclosures missing"],example:"Medicare Advantage quote: IOEP window closed. SEP eligibility check required before enrollment."},
{icon:"🛡",name:"Coverage Node",color:C.gold,what:"Evaluates plan-to-need match and gaps",catches:["Benefit gaps vs client needs","Plan network adequacy","Formulary coverage gaps","Underinsurance red flags"],example:"P&C: Commercial GL policy has liquor liability exclusion. Client runs a restaurant. Critical gap."},
{icon:"❌",name:"Claims Node",color:C.red,what:"Identifies denial risk and appeal opportunities",catches:["Denial probability scoring","Appeal deadline tracking","Coordination of benefits issues","Medical necessity documentation"],example:"DME claim: CPAP prior auth missing. Supplier submitted without RX. Appeal window: 12 days."},
{icon:"⚠",name:"Risk Node",color:C.amber,what:"Quantifies exposure and revenue risk",catches:["Carrier appetite mismatches","Loss ratio exposure","Renewal risk scoring","Premium adequacy gaps"],example:"Commercial auto: 3 drivers with MVRs not disclosed. Carrier will non-renew at next cycle."}];
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
s.addText("All four nodes report simultaneously to the Insurance Strategist — who synthesizes findings into a single BNCA.",{x:0.38,y:6.2,w:12.55,h:0.35,fontSize:11,bold:true,color:C.gold2,align:"center",fontFace:FONT_BODY});
addSlideNum(s,5,TOTAL,true);}

// SLIDE 6 - STRATEGISTS
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.slate);
contentTitle(s,"Insurance Strategist & Main Strategist — The Decision Layer","Two AI layers that transform node findings into prioritized, human-ready recommendations");
card(s,0.38,1.05,5.85,5.45,C.offWhite,C.teal);
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:1.05,w:5.85,h:0.65,fill:{color:C.teal},line:{color:C.teal}});
s.addText("🧠  Insurance Strategist",{x:0.55,y:1.1,w:5.5,h:0.52,fontSize:18,bold:true,color:C.white,fontFace:FONT_HEAD});
[{h:"Receives all 4 node findings",b:"Compliance, Coverage, Claims, and Risk outputs arrive simultaneously"},{h:"Resolves conflicts between nodes",b:"When nodes disagree, Insurance Strategist adjudicates on line-of-business rules"},{h:"Generates the BNCA",b:"Best Next Course of Action — single, specific, carrier-ready recommendation"},{h:"Assigns confidence score",b:"Low/Medium/High confidence routes to different HITL escalation paths"},{h:"Tags for routing",b:"Flags for agent action, carrier submission, compliance review, or HITL queue"}].forEach((p,i)=>{const y=1.85+i*0.85;s.addShape(pres.shapes.OVAL,{x:0.52,y,w:0.32,h:0.32,fill:{color:C.teal},line:{color:C.teal}});s.addText(""+(i+1),{x:0.52,y,w:0.32,h:0.32,fontSize:11,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(p.h,{x:0.95,y:y-0.02,w:5.1,h:0.28,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(p.b,{x:0.95,y:y+0.26,w:5.1,h:0.38,fontSize:10,color:"3A5068",fontFace:FONT_BODY});});
s.addText("▶",{x:6.32,y:3.42,w:0.38,h:0.52,fontSize:18,color:C.white,align:"center",valign:"middle"});
card(s,6.78,1.05,5.88,5.45,C.ghostWhite,C.slate);
s.addShape(pres.shapes.RECTANGLE,{x:6.78,y:1.05,w:5.88,h:0.65,fill:{color:C.slate},line:{color:C.slate}});
s.addText("📊  Main Strategist",{x:6.95,y:1.1,w:5.5,h:0.52,fontSize:18,bold:true,color:C.white,fontFace:FONT_HEAD});
[{h:"Receives BNCA from Insurance Strategist",b:"Reviews confidence score and routing tag"},{h:"Cross-account pattern recognition",b:"Identifies systemic issues across book of business"},{h:"Priority tier assignment",b:"P1 Urgent · P2 Revenue Critical · P3 Standard · P4 Info"},{h:"Escalation path determination",b:"Routes to agent, carrier, compliance officer, or HITL"},{h:"Reports to HITL Manager",b:"Delivers BNCA + findings + priority for human sign-off"}].forEach((p,i)=>{const y=1.85+i*0.85;s.addShape(pres.shapes.OVAL,{x:6.92,y,w:0.32,h:0.32,fill:{color:C.slate},line:{color:C.slate}});s.addText(""+(i+1),{x:6.92,y,w:0.32,h:0.32,fontSize:11,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(p.h,{x:7.35,y:y-0.02,w:5.15,h:0.28,fontSize:12,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(p.b,{x:7.35,y:y+0.26,w:5.15,h:0.38,fontSize:10,color:"3A5068",fontFace:FONT_BODY});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.6,w:12.28,h:0.6,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Main Strategist delivers to HITL Manager: full audit package ready for agent review and approval",{x:0.38,y:6.6,w:12.28,h:0.6,fontSize:12,bold:true,color:C.gold2,align:"center",valign:"middle",fontFace:FONT_BODY});
addSlideNum(s,6,TOTAL,false);}

// SLIDE 7 - HITL
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.purple);
sectionHeader(s,"HITL Manager — Human-in-the-Loop","AI recommends. Licensed agents decide. Every action is compliant and accountable.");
card(s,0.38,1.18,5.9,4.5,"FFFFFF",C.purple);
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:1.18,w:5.9,h:0.55,fill:{color:C.purple,transparency:10},line:{color:C.purple}});
s.addText("What HITL Manager receives:",{x:0.55,y:1.23,w:5.6,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD});
["Original document or client query","All 4 AI Node findings — individually labeled","Insurance Strategist BNCA with confidence score","Main Strategist priority tier (P1-P4)","Recommended action and carrier routing","Escalation flag if compliance or E&O risk detected","Full time-stamped audit trail from intake to review"].forEach((r,i)=>{s.addShape(pres.shapes.RECTANGLE,{x:0.48,y:1.85+i*0.49,w:0.26,h:0.26,fill:{color:C.purple},line:{color:C.purple}});s.addText("✓",{x:0.48,y:1.85+i*0.49,w:0.26,h:0.26,fontSize:10,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(r,{x:0.82,y:1.82+i*0.49,w:5.28,h:0.38,fontSize:11,color:C.navy,fontFace:FONT_BODY,valign:"middle"});});
card(s,6.88,1.18,5.9,4.5,"FFFFFF",C.teal);
s.addShape(pres.shapes.RECTANGLE,{x:6.88,y:1.18,w:5.9,h:0.55,fill:{color:C.teal,transparency:10},line:{color:C.teal}});
s.addText("What HITL Manager can do:",{x:7.05,y:1.23,w:5.6,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD});
[{a:"✅ Approve",b:"Accept BNCA and trigger agent or carrier action"},{a:"✏ Modify",b:"Edit BNCA before approval — reason logged"},{a:"↩ Return",b:"Send back to Insurance Strategist with context"},{a:"⬆ Escalate",b:"Elevate to compliance officer or E&O carrier"},{a:"🚨 Flag urgent",b:"Override to P1 — same-day resolution"},{a:"🗂 Archive",b:"Mark resolved, saved to client record"}].forEach((a,i)=>{const ay=1.88+i*0.58;s.addShape(pres.shapes.RECTANGLE,{x:6.98,y:ay,w:5.68,h:0.48,fill:{color:"F0F4FF"},line:{color:C.teal,width:0.5}});s.addText(a.a,{x:7.06,y:ay,w:1.35,h:0.48,fontSize:11,bold:true,color:C.teal,fontFace:FONT_HEAD,valign:"middle"});s.addText(a.b,{x:8.45,y:ay,w:4.08,h:0.48,fontSize:10,color:"2A4060",fontFace:FONT_BODY,valign:"middle"});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:5.85,w:12.4,h:1.3,fill:{color:C.white,transparency:93},line:{color:C.gold,width:0.75}});
s.addText("Why HITL is non-negotiable in insurance: State licensing requires human agent sign-off · E&O liability stays with the licensee · Edge cases handled by experienced agents · Every TSM action is auditable and defensible.",{x:0.55,y:6.0,w:12.0,h:1.0,fontSize:10.5,color:"C8E0F4",fontFace:FONT_BODY,lineSpacingMultiple:1.35});
addSlideNum(s,7,TOTAL,true);}

// SLIDE 8 - DEMO WALKTHROUGH
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.teal);
contentTitle(s,"Live Demo — Insurance Suite Walkthrough","5 apps · Click any scenario · Watch pipeline · Read the BNCA");
[{n:"1",label:"Open AZ Insurance Command",icon:"🏛",detail:"Full dashboard at\ntsm-shell.fly.dev/html/az-ins/\nAll tabs live"},{n:"2",label:"Run a Medicare Scenario",icon:"💊",detail:"Select Medicare tab\nEnter client profile\nWatch compliance node fire"},{n:"3",label:"Switch to DME Benefits",icon:"📋",detail:"tsm-shell.fly.dev/html/dme/\nClient-facing benefit guide\nPart B coverage shown instantly"},{n:"4",label:"Open Agents Intelligence",icon:"🤝",detail:"tsm-shell.fly.dev/html/agents-ins/\nAI for agent workflows\nCross-sell engine live"},{n:"5",label:"P&C Enterprise Command",icon:"🏢",detail:"tsm-shell.fly.dev/html/pc-command/\nCommercial lines dashboard\nLive ticker + risk scoring"},{n:"6",label:"Show Pricing Page",icon:"💰",detail:"tsm-shell.fly.dev/html/pricing1.html\nTier comparison\nROI calculator"}].forEach((st,i)=>{const x=0.38+(i%3)*4.28,y=i<3?1.1:3.7,w=4.05,h=2.35;card(s,x,y,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.OVAL,{x:x+0.15,y:y+0.12,w:0.45,h:0.45,fill:{color:C.teal},line:{color:C.teal}});s.addText(st.n,{x:x+0.15,y:y+0.12,w:0.45,h:0.45,fontSize:14,bold:true,color:C.white,align:"center",valign:"middle"});s.addText(st.icon,{x:x+0.72,y:y+0.12,w:0.45,h:0.45,fontSize:22,align:"center",valign:"middle"});s.addText(st.label,{x:x+0.15,y:y+0.65,w:w-0.3,h:0.4,fontSize:14,bold:true,color:C.navy,fontFace:FONT_HEAD});s.addText(st.detail,{x:x+0.15,y:y+1.08,w:w-0.3,h:1.1,fontSize:11,color:"4A5568",fontFace:FONT_BODY,lineSpacingMultiple:1.35});});
s.addShape(pres.shapes.RECTANGLE,{x:0.38,y:6.25,w:12.55,h:1.02,fill:{color:C.amberLt},line:{color:C.amber,width:0.75}});
s.addText("💡 Demo Tip: Start with the Medicare compliance scenario — show a HOLD result first, then a clean approval. The contrast between a compliance flag and a clean BNCA lands the value instantly.",{x:0.55,y:6.35,w:12.0,h:0.82,fontSize:11,color:"5C3A00",fontFace:FONT_BODY,lineSpacingMultiple:1.3});
addSlideNum(s,8,TOTAL,false);}

// SLIDE 9 - AZ INSURANCE COMMAND DEEP DIVE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.teal);
s.addText("🏛  AZ Insurance Command — Full Dashboard",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Multi-line insurance command center. Every tab is a live AI node. NPN 18818059 licensed AZ producer.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.steel,fontFace:FONT_BODY,italic:true});
[{label:"Medicare Tab",icon:"💊",color:C.teal,items:["Medicare Advantage plan comparison","Part D formulary checker","IOEP/SEP eligibility validator","BNCA: enroll, hold, or SEP-route"]},
{label:"ACA Tab",icon:"📋",color:C.green,items:["Income-based subsidy calculator","Metal tier optimizer","Network adequacy checker","BNCA: optimal plan + enrollment path"]},
{label:"Compliance Tab",icon:"🛡",color:C.purple,items:["State reg violation scanner","CMS rule change tracker","E&O exposure flags","BNCA: remediation steps with deadlines"]},
{label:"Carrier Intel Tab",icon:"📊",color:C.amber,items:["Carrier appetite matrix by zip","Underwriting rule library","Loss ratio trend by carrier","BNCA: best carrier match for risk"]}].forEach((tab,i)=>{const x=0.35+i*3.18;card(s,x,1.12,3.05,4.35,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x,y:1.12,w:3.05,h:0.55,fill:{color:tab.color},line:{color:tab.color}});s.addText(tab.icon+"  "+tab.label,{x:x+0.12,y:1.17,w:2.85,h:0.42,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});tab.items.forEach((item,ii)=>{const iy=1.78+ii*0.6;s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:iy,w:2.82,h:0.52,fill:{color:C.white,transparency:20},line:{color:tab.color,width:0.5}});s.addText("• "+item,{x:x+0.22,y:iy,w:2.68,h:0.52,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.62,w:12.55,h:0.68,fill:{color:"E8F8F5"},line:{color:C.teal,width:0.75}});
s.addText("AZ Insurance Command unifies every line of business into one dashboard — no more portal-hopping between carriers.",{x:0.52,y:5.7,w:12.2,h:0.52,fontSize:11,color:"0D4A3E",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.42,w:12.55,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("URL: tsm-shell.fly.dev/html/az-ins/",{x:0.5,y:6.42,w:12.3,h:0.38,fontSize:11,bold:true,color:C.gold2,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,9,TOTAL,false);}

// SLIDE 10 - DME DEEP DIVE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.gold);
s.addText("💊  Medicare DME Benefits Engine",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Most Medicare beneficiaries leave thousands in Part B benefits unclaimed. This tool fixes that — for agents and clients.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.steel,fontFace:FONT_BODY,italic:true});
[{label:"CPAP & Sleep Equipment",value:"$1,500–$3,000",tag:"HIGH DEMAND",color:C.teal,detail:"Medicare covers CPAP machines, masks, and supplies with AHI diagnosis. Agents can identify candidates from current book."},
{label:"CGM & Diabetes Supplies",value:"$2,000–$4,000",tag:"FAST GROWING",color:C.green,detail:"Continuous glucose monitors now covered under Part B. Major benefit gap most agents miss on new Medicare clients."},
{label:"Power Wheelchairs",value:"$3,000–$6,000",tag:"HIGH VALUE",color:C.purple,detail:"Full power wheelchair coverage with home mobility assessment. Agent identifies need, triggers referral workflow."},
{label:"Oxygen Concentrators",value:"$2,500–$5,000",tag:"RECURRING",color:C.amber,detail:"Monthly oxygen rental covered indefinitely for qualifying diagnoses. Creates long-term client stickiness and referrals."}].forEach((item,i)=>{const x=0.35+i*3.18;card(s,x,1.12,3.05,3.5,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x,y:1.12,w:3.05,h:0.55,fill:{color:item.color},line:{color:item.color}});s.addText(item.label,{x:x+0.12,y:1.17,w:2.85,h:0.42,fontSize:12,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});s.addText(item.value,{x:x+0.12,y:1.8,w:2.85,h:0.42,fontSize:20,bold:true,color:item.color,fontFace:FONT_HEAD});s.addText(item.tag,{x:x+0.12,y:2.22,w:2.0,h:0.28,fontSize:9,bold:true,color:C.white,fontFace:FONT_BODY,align:"center"});s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:2.22,w:2.0,h:0.28,fill:{color:item.color,transparency:30},line:{color:item.color,width:0.5}});s.addText(item.detail,{x:x+0.12,y:2.6,w:2.82,h:0.9,fontSize:9.5,color:"4A5568",fontFace:FONT_BODY,lineSpacingMultiple:1.3});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:4.78,w:12.55,h:0.68,fill:{color:"FFFBEB"},line:{color:C.gold,width:0.75}});
s.addText("Agent use case: Run DME check on every Medicare client annually. Average unclaimed benefit per client: $2,400. Becomes a referral machine.",{x:0.52,y:4.86,w:12.2,h:0.52,fontSize:11,color:"5C3A00",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.58,w:12.55,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("URL: tsm-shell.fly.dev/html/dme/",{x:0.5,y:5.58,w:12.3,h:0.38,fontSize:11,bold:true,color:C.gold2,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,10,TOTAL,false);}

// SLIDE 11 - AGENTS INTELLIGENCE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.mint);
s.addText("🤝  Agents Intelligence Platform",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("AI for insurance professionals — agents, agencies, and carriers. Every line, every question, in real time.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.steel,fontFace:FONT_BODY,italic:true});
[{label:"For Independent Agents",color:C.teal,items:["Real-time carrier rule lookup — no more portal-hopping","Cross-sell opportunity scanner across book","Medicare, ACA, Life, P&C in one AI interface","Client conversation scripts powered by BNCA"]},
{label:"For Agencies & IMOs",color:C.green,items:["Agent onboarding AI — 6-month ramp cut to weeks","Production tracking with BNCA coaching","Compliance monitoring across all licensed agents","Book analysis: retention risk and growth gaps"]},
{label:"For Carriers",color:C.purple,items:["Distribution intelligence — which agents sell what","Product appetite matching at point of sale","Agent education and rule change notifications","Loss ratio early warning by agent segment"]}].forEach((group,i)=>{const x=0.35+i*4.2;card(s,x,1.12,4.05,4.6,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x,y:1.12,w:4.05,h:0.55,fill:{color:group.color},line:{color:group.color}});s.addText(group.label,{x:x+0.12,y:1.17,w:3.85,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});group.items.forEach((item,ii)=>{const iy=1.78+ii*0.72;s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:iy,w:3.82,h:0.62,fill:{color:C.white,transparency:20},line:{color:group.color,width:0.5}});s.addText("• "+item,{x:x+0.22,y:iy,w:3.66,h:0.62,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.88,w:12.55,h:0.68,fill:{color:"ECFDF5"},line:{color:C.mint,width:0.75}});
s.addText("New agents using TSM Intelligence hit production benchmarks 3x faster. Senior agents add 18-25% to annual revenue from cross-sell AI.",{x:0.52,y:5.96,w:12.2,h:0.52,fontSize:11,color:"064E3B",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.68,w:12.55,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("URL: tsm-shell.fly.dev/html/agents-ins/",{x:0.5,y:6.68,w:12.3,h:0.38,fontSize:11,bold:true,color:C.gold2,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,11,TOTAL,false);}

// SLIDE 12 - P&C COMMAND
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.purple);
s.addText("🏢  P&C Enterprise Command",{x:0.35,y:0.18,w:12.6,h:0.45,fontSize:20,bold:true,color:C.navy,fontFace:FONT_HEAD});
s.addText("Property & casualty operations command center. Commercial and personal lines. Live ticker, risk scoring, renewal intelligence.",{x:0.35,y:0.65,w:12.6,h:0.38,fontSize:11,color:C.steel,fontFace:FONT_BODY,italic:true});
[{label:"Quote Pipeline",color:C.purple,items:["Commercial GL, BOP, Workers Comp, Auto in one view","Carrier appetite match by NAICS code","Missing underwriting info flagged before submission","BNCA: submit, hold, or re-quote with alternate carrier"]},
{label:"Risk Intelligence",color:C.amber,items:["Loss ratio by policy, account, and segment","Prior claim history pattern detection","Adverse MVR and CLUE report alerts","BNCA: renew, non-renew, or reunderwrite"]},
{label:"Renewal Engine",color:C.teal,items:["90-day renewal pipeline with risk scoring","Premium adequacy gap detection","Retention risk ranked by account value","BNCA: retain, rerate, or market account"]}].forEach((panel,i)=>{const x=0.35+i*4.2;card(s,x,1.12,4.05,4.35,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x,y:1.12,w:4.05,h:0.55,fill:{color:panel.color},line:{color:panel.color}});s.addText(panel.label,{x:x+0.12,y:1.17,w:3.85,h:0.42,fontSize:14,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});panel.items.forEach((item,ii)=>{const iy=1.78+ii*0.72;s.addShape(pres.shapes.RECTANGLE,{x:x+0.12,y:iy,w:3.82,h:0.62,fill:{color:C.white,transparency:20},line:{color:panel.color,width:0.5}});s.addText("• "+item,{x:x+0.22,y:iy,w:3.66,h:0.62,fontSize:10.5,color:C.dark,fontFace:FONT_BODY,valign:"middle"});});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.62,w:12.55,h:0.68,fill:{color:C.purpleLt},line:{color:C.purple,width:0.75}});
s.addText("P&C agencies using enterprise command reduce renewal leakage by 22% and cut quote-to-bind time from days to hours.",{x:0.52,y:5.7,w:12.2,h:0.52,fontSize:11,color:"3B0764",fontFace:FONT_BODY});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.42,w:12.55,h:0.38,fill:{color:C.navy},line:{color:C.navy}});
s.addText("URL: tsm-shell.fly.dev/html/pc-command/",{x:0.5,y:6.42,w:12.3,h:0.38,fontSize:11,bold:true,color:C.gold2,fontFace:FONT_BODY,valign:"middle"});
addSlideNum(s,12,TOTAL,false);}

// SLIDE 13 - NARRATIVE SCRIPT
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.gold);
sectionHeader(s,"Real-Time Narrative — What the Audience Sees","Follow this script during the live demo.");
[{time:"0:00",action:"Open AZ Insurance Command",say:"This is TSM Insurance Intelligence. Every line of business your agency writes is already loaded.",color:C.steel},
{time:"0:15",action:"Click Medicare tab",say:"Here is what a Medicare client inquiry looks like when it hits your queue. Let us run it.",color:C.steel},
{time:"0:22",action:"Enter client profile",say:"Watch the nodes — Compliance, Coverage, Claims, Risk — all firing simultaneously.",color:C.teal},
{time:"0:45",action:"BNCA: HOLD — SEP issue",say:"Enrollment window closed. This would have been a CMS violation. Your E&O carrier would not be happy.",color:C.red},
{time:"1:00",action:"Switch to clean scenario",say:"Same client — qualifying SEP event documented. Same workflow, same button.",color:C.teal},
{time:"1:30",action:"BNCA: APPROVE & ENROLL",say:"Plan selected. Enrollment path confirmed. No compliance flag. No carrier callback.",color:C.green},
{time:"1:45",action:"Open DME Benefits",say:"Now watch what this does for your existing Medicare book. Every client is leaving money on the table.",color:C.gold},
{time:"2:00",action:"Run CPAP benefit check",say:"Client qualifies for $2,400 in Part B equipment. Did you know that? Did they?",color:C.amber},
{time:"2:20",action:"Pause",say:"That is a referral, a retention tool, and a value-add conversation — in 45 seconds.",color:C.gold},
{time:"2:35",action:"P&C Command — renewal",say:"Commercial account. Three drivers not disclosed. Carrier would non-renew. We caught it at 90 days.",color:C.purple}].forEach((b,i)=>{const y=1.2+i*0.54;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.48,fill:{color:C.white,transparency:93},line:{color:b.color,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:0.65,h:0.48,fill:{color:b.color,transparency:20},line:{color:b.color,transparency:20}});s.addText(b.time,{x:0.35,y,w:0.65,h:0.48,fontSize:10,bold:true,color:b.color,align:"center",valign:"middle",fontFace:FONT_BODY});s.addText(b.action,{x:1.1,y:y+0.04,w:2.5,h:0.4,fontSize:10.5,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});s.addText(b.say,{x:3.75,y:y+0.04,w:9.0,h:0.4,fontSize:10,color:"B8D0E8",fontFace:FONT_BODY,valign:"middle",italic:true});});
addSlideNum(s,13,TOTAL,true);}

// SLIDE 14 - FEATURE GUIDE
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.steel);
contentTitle(s,"App Feature Guide — Exact URLs & Actions","Reference during the demo to navigate TSM Insurance Intelligence confidently");
[{zone:"AZ Insurance Command",color:C.teal,url:"tsm-shell.fly.dev/html/az-ins/",items:[{btn:"Tab Navigation",action:"Medicare · ACA · P&C · Life · Compliance — each tab is a live AI node. Click to activate."},{btn:"DEPLOY button",action:"Runs full BNCA pipeline on current query. Active once profile or document entered."},{btn:"Carrier Intel tab",action:"Shows live carrier appetite matrix. Filter by line, zip, and risk type."}]},
{zone:"DME Benefits Engine",color:C.gold,url:"tsm-shell.fly.dev/html/dme/",items:[{btn:"DME Category Cards",action:"Click any of 8 DME types — CPAP, CGM, wheelchair, oxygen, etc. Shows benefit amount instantly."},{btn:"Check Eligibility CTA",action:"Runs Medicare Part B eligibility check against client profile."},{btn:"How It Works grid",action:"3-step process: check, qualify, refer. Client-facing explainer for use in appointments."}]},
{zone:"Agents Intelligence",color:C.mint,url:"tsm-shell.fly.dev/html/agents-ins/",items:[{btn:"Agent / Agency / Carrier tabs",action:"Three distinct user modes — each surfaces different AI capabilities and BNCA outputs."},{btn:"Cross-sell Engine",action:"Scans current client profile for uncovered lines. Returns ranked opportunities with scripts."},{btn:"Compliance AI",action:"Real-time state reg checker. Enter carrier + state + product = instant compliance flag."}]},
{zone:"P&C Enterprise Command",color:C.purple,url:"tsm-shell.fly.dev/html/pc-command/",items:[{btn:"Live Ticker",action:"Top bar shows real-time pipeline: quotes pending, renewal alerts, risk flags, carrier updates."},{btn:"Quote Pipeline panel",action:"Active quotes with carrier match score. Flagged items show underwriting gaps before submission."},{btn:"Renewal Engine tab",action:"90-day renewal calendar with retention risk score. BNCA per account: retain, rerate, or market."}]}].forEach((f,i)=>{const col=i%2,row=Math.floor(i/2),fx=0.35+col*6.25,fy=1.05+row*2.95,w=6.1,h=2.78;card(s,fx,fy,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x:fx,y:fy,w,h:0.45,fill:{color:f.color},line:{color:f.color}});s.addText(f.zone,{x:fx+0.12,y:fy+0.04,w:w-0.2,h:0.37,fontSize:13,bold:true,color:C.white,fontFace:FONT_HEAD,valign:"middle"});s.addText(f.url,{x:fx+0.12,y:fy+0.46,w:w-0.2,h:0.22,fontSize:9,color:f.color,fontFace:FONT_BODY,italic:true});f.items.forEach((item,j)=>{const iy=fy+0.74+j*0.6;s.addShape(pres.shapes.RECTANGLE,{x:fx+0.12,y:iy,w:1.55,h:0.48,fill:{color:f.color,transparency:82},line:{color:f.color,width:0.5}});s.addText(item.btn,{x:fx+0.15,y:iy,w:1.5,h:0.48,fontSize:9.5,bold:true,color:C.dark,fontFace:FONT_HEAD,valign:"middle",align:"center"});s.addText(item.action,{x:fx+1.78,y:iy,w:w-1.92,h:0.48,fontSize:10,color:"3A4A5E",fontFace:FONT_BODY,valign:"middle"});});});
addSlideNum(s,14,TOTAL,false);}

// SLIDE 15 - ROI
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.teal);
sectionHeader(s,"The Business Impact","Conservative projections based on industry benchmarks and agency book averages");
[{category:"Medicare Enrollment",before:"72-hr manual eligibility check",after:"< 60s with TSM compliance node",impact:"More enrolled clients per day · Zero CMS violations"},
{category:"DME Benefit Recovery",before:"0% of agents check DME at renewal",after:"100% auto-checked with TSM",impact:"Avg $2,400 per client · Retention and referral tool"},
{category:"Claim Denial Appeals",before:"< 20% of denials pursued",after:"100% scored, deadlines tracked",impact:"$150K–$500K recovered per agency annually"},
{category:"Agent Onboarding",before:"6-month ramp to first production",after:"Weeks with TSM AI coaching",impact:"3x faster to quota · Lower manager burden"},
{category:"P&C Renewal Retention",before:"Reactive — lost at non-renewal",after:"90-day risk scoring, proactive BNCA",impact:"22% reduction in renewal leakage"},
{category:"Compliance & E&O",before:"Reactive — discovered at audit or claim",after:"Proactive — caught at point of sale",impact:"Zero surprise violations · Defensible audit trail"}].forEach((m,i)=>{const y=1.22+i*0.88;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.78,fill:{color:C.white,transparency:93},line:{color:"FFFFFF",transparency:85,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:2.75,h:0.78,fill:{color:C.navy,transparency:60},line:{color:C.gold,width:0.5}});s.addText(m.category,{x:0.42,y,w:2.62,h:0.78,fontSize:11,bold:true,color:C.gold2,fontFace:FONT_HEAD,valign:"middle"});s.addShape(pres.shapes.RECTANGLE,{x:3.18,y:y+0.08,w:2.55,h:0.62,fill:{color:C.redLt,transparency:20},line:{color:C.red,width:0.5}});s.addText("BEFORE  "+m.before,{x:3.25,y:y+0.08,w:2.45,h:0.62,fontSize:10,color:C.white,fontFace:FONT_BODY,valign:"middle"});s.addShape(pres.shapes.RECTANGLE,{x:5.85,y:y+0.08,w:2.55,h:0.62,fill:{color:C.greenLt,transparency:20},line:{color:C.green,width:0.5}});s.addText("WITH TSM  "+m.after,{x:5.92,y:y+0.08,w:2.45,h:0.62,fontSize:10,color:C.white,fontFace:FONT_BODY,valign:"middle"});s.addText(m.impact,{x:8.55,y,w:4.25,h:0.78,fontSize:10,color:"AAC4E0",fontFace:FONT_BODY,valign:"middle",italic:true});});
s.addText("TSM Insurance Intelligence pays for itself in recovered denials and DME benefits alone — everything else is growth.",{x:0.35,y:7.08,w:12.55,h:0.28,fontSize:11,bold:true,color:C.gold2,align:"center",fontFace:FONT_BODY});
addSlideNum(s,15,TOTAL,true);}

// SLIDE 16 - IMPLEMENTATION
{const s=pres.addSlide();bgWhite(s);addSideBar(s,C.navy);
contentTitle(s,"Implementation — How TSM Integrates with Your Agency","No rip-and-replace. TSM layers on your existing workflows and adds value from day one.");
[{phase:"Phase 1",label:"Activate & Configure",duration:"Days 1–7",color:C.steel,steps:["Set GROQ API key — single setup, all apps unlocked","Choose starting app: AZ Command, DME, or Agents Intel","Carrier library loaded for your top 10 markets","HITL Manager workflow configured for your team"]},
{phase:"Phase 2",label:"Pilot & Calibrate",duration:"Weeks 2–4",color:C.teal,steps:["Run 20 real client scenarios through BNCA pipeline","Calibrate node outputs against your agency decisions","BNCA accuracy reviewed daily with senior agent","Feedback loop tunes Insurance Strategist to your market"]},
{phase:"Phase 3",label:"Full Deployment",duration:"Month 2+",color:C.gold,steps:["All 5 apps live across agency","HITL queue integrated into daily agent workflow","Book analysis: cross-sell, DME, and renewal scoring","Monthly calibration reviews and model updates"]}].forEach((ph,i)=>{const px=0.35+i*4.2,w=4.1,h=4.35,y=1.08;card(s,px,y,w,h,C.white,"DDEAF5");s.addShape(pres.shapes.RECTANGLE,{x:px,y,w,h:0.9,fill:{color:ph.color},line:{color:ph.color}});s.addText(ph.phase,{x:px+0.15,y:y+0.05,w:w-0.25,h:0.3,fontSize:11,bold:true,color:"D4EEF8",fontFace:FONT_BODY});s.addText(ph.label,{x:px+0.15,y:y+0.32,w:w-0.25,h:0.35,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(ph.duration,{x:px+0.15,y:y+0.65,w:w-0.25,h:0.22,fontSize:10,color:"D4EEF8",fontFace:FONT_BODY});ph.steps.forEach((step,j)=>{const sy=y+1.08+j*0.78;s.addShape(pres.shapes.RECTANGLE,{x:px+0.15,y:sy,w:w-0.3,h:0.68,fill:{color:"F4F8FE"},line:{color:"DDEAF5",width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:px+0.15,y:sy,w:0.05,h:0.68,fill:{color:ph.color},line:{color:ph.color}});s.addText(step,{x:px+0.27,y:sy,w:w-0.45,h:0.68,fontSize:10.5,color:C.navy,fontFace:FONT_BODY,valign:"middle"});});});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:5.55,w:12.55,h:0.5,fill:{color:C.ghostWhite},line:{color:"DDEAF5"}});
s.addText("Compatible with: EzLynx · Applied Epic · Hawksoft · AgencyZoom · Medicare Compare · Healthcare.gov",{x:0.5,y:5.55,w:12.28,h:0.5,fontSize:10.5,color:C.slate,fontFace:FONT_BODY,valign:"middle",align:"center"});
s.addText("Designed with HIPAA safeguards in mind; pilots use synthetic or de-identified data only. A BAA and security review are required before any PHI is processed.",{x:0.35,y:6.15,w:12.55,h:0.38,fontSize:10,color:C.muted,fontFace:FONT_BODY,align:"center"});
s.addShape(pres.shapes.RECTANGLE,{x:0.35,y:6.65,w:12.55,h:0.58,fill:{color:C.navy},line:{color:C.navy}});
s.addText("Your agency can be running live BNCA outputs on real client scenarios within one week of agreement.",{x:0.5,y:6.65,w:12.28,h:0.58,fontSize:13,bold:true,color:C.gold2,align:"center",valign:"middle",fontFace:FONT_HEAD});
addSlideNum(s,16,TOTAL,false);}

// SLIDE 17 - Q&A
{const s=pres.addSlide();bgNavy(s);addSideBar(s,C.amber);
sectionHeader(s,"Anticipated Questions — Prepared Answers","Be ready for these. Every answer reinforces TSM value.");
[{q:"Is this legal — can AI give insurance advice?",a:"TSM AI recommends. The licensed agent decides and signs off. Every BNCA goes through HITL before any action. AI is the research tool; you are the advisor of record."},
{q:"What if the AI gives wrong carrier guidance?",a:"Every output has a confidence score. Low-confidence outputs auto-route to HITL. The agent reviews before submission. TSM is a second opinion engine, not an autopilot."},
{q:"How current is the carrier and compliance data?",a:"Carrier appetite matrix and state regs update continuously. CMS rule changes are pushed within 24 hours of publication. Your GROQ key runs against live data."},
{q:"Does this work with our existing AMS or CRM?",a:"TSM apps run alongside your existing tools via browser. API integration with EzLynx, Applied Epic, and AgencyZoom available for enterprise deployments."},
{q:"What does it cost and what is the ROI?",a:"Pricing is per user or per agency. At average agency size, recovered claim denials and DME benefits alone return 5-10x the annual cost. See pricing1.html for tier breakdown."},
{q:"Can we white-label this for our agents or clients?",a:"Yes. Agency and carrier white-labeling is available at enterprise tier. Your brand, your NPN, TSM intelligence layer underneath."}].forEach((qa,i)=>{const y=1.2+i*0.9;s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:12.55,h:0.82,fill:{color:C.white,transparency:93},line:{color:"FFFFFF",transparency:85,width:0.5}});s.addShape(pres.shapes.RECTANGLE,{x:0.35,y,w:0.35,h:0.82,fill:{color:C.amber,transparency:20},line:{color:C.amber,transparency:20}});s.addText("Q",{x:0.35,y,w:0.35,h:0.82,fontSize:14,bold:true,color:C.amber,align:"center",valign:"middle"});s.addText(qa.q,{x:0.82,y:y+0.05,w:11.95,h:0.3,fontSize:11,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(qa.a,{x:0.82,y:y+0.38,w:11.95,h:0.4,fontSize:10.5,color:"AAC4E0",fontFace:FONT_BODY,lineSpacingMultiple:1.2});});
addSlideNum(s,17,TOTAL,true);}

// SLIDE 18 - CLOSE
{const s=pres.addSlide();bgNavy(s);
s.addShape(pres.shapes.RECTANGLE,{x:0,y:0,w:0.08,h:7.5,fill:{color:C.gold},line:{color:C.gold}});
s.addShape(pres.shapes.RECTANGLE,{x:0.55,y:0.45,w:1.6,h:0.55,fill:{color:C.gold},line:{color:C.gold}});
s.addText("TSM",{x:0.55,y:0.45,w:1.6,h:0.55,fontSize:20,bold:true,color:C.navy,align:"center",valign:"middle",fontFace:FONT_HEAD,margin:0});
s.addText("Insurance Intelligence",{x:2.3,y:0.55,w:6.0,h:0.38,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText("What happens next",{x:0.55,y:1.3,w:9.5,h:0.65,fontSize:42,bold:true,color:C.white,fontFace:FONT_HEAD});
s.addText("is your call.",{x:0.55,y:1.9,w:9.5,h:0.65,fontSize:42,bold:true,color:C.gold2,fontFace:FONT_HEAD});
[{n:"1",label:"Pick your starting app",sub:"AZ Command, DME, Agents Intel, or P&C — choose highest pain point first"},
{n:"2",label:"Run 5 real client scenarios",sub:"Live BNCA outputs on your actual book — see it work on your business"},
{n:"3",label:"Configure your HITL workflow",sub:"Set up agent review queue — 1 hour to configure for your team"},
{n:"4",label:"Go live — see results",sub:"Real clients, real BNCA outputs, real ROI — tracked from day one"}].forEach((st,i)=>{const y=2.82+i*0.85;s.addShape(pres.shapes.OVAL,{x:0.55,y:y+0.04,w:0.42,h:0.42,fill:{color:C.gold},line:{color:C.gold}});s.addText(st.n,{x:0.55,y:y+0.04,w:0.42,h:0.42,fontSize:14,bold:true,color:C.navy,align:"center",valign:"middle"});s.addText(st.label,{x:1.1,y,w:6.0,h:0.4,fontSize:16,bold:true,color:C.white,fontFace:FONT_HEAD});s.addText(st.sub,{x:1.1,y:y+0.4,w:6.0,h:0.38,fontSize:11,color:"AAC4E0",fontFace:FONT_BODY});});
card(s,9.2,1.3,3.9,4.6,"FFFFFF",C.gold);
s.addShape(pres.shapes.RECTANGLE,{x:9.2,y:1.3,w:3.9,h:0.55,fill:{color:C.gold},line:{color:C.gold}});
s.addText("Ready to start?",{x:9.35,y:1.36,w:3.6,h:0.42,fontSize:15,bold:true,color:C.navy,fontFace:FONT_HEAD});
[{label:"NPN",val:"18818059"},{label:"License",val:"AZ Producer · Active"},{label:"Apps live",val:"5 of 5 online"},{label:"Start",val:"1 week to first BNCA"},{label:"Contract",val:"Month-to-month"},{label:"White-label",val:"Available at Enterprise"}].forEach((ci,i)=>{s.addText(ci.label,{x:9.35,y:2.0+i*0.55,w:1.5,h:0.42,fontSize:10,bold:true,color:C.muted,fontFace:FONT_BODY});s.addText(ci.val,{x:10.9,y:2.0+i*0.55,w:2.08,h:0.42,fontSize:11,bold:true,color:C.navy,fontFace:FONT_BODY});});
s.addText("TSM Insurance Intelligence. Every client question answered. Every action accountable.",{x:0.55,y:6.95,w:12.3,h:0.35,fontSize:11,color:C.muted,fontFace:FONT_BODY,align:"center"});
addSlideNum(s,18,TOTAL,true);}

// SAVE
pres.writeFile({fileName:"/workspaces/tsm-shell/TSM_Insurance_Presentation.pptx"})
  .then(()=>console.log("✅ Saved: TSM_Insurance_Presentation.pptx"))
  .catch(e=>{console.error("❌",e);process.exit(1);});
