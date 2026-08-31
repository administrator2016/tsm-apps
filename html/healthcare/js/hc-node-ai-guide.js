(function(){
  if(window.__HC_NODE_AI_TAB_GUIDE__) return;
  window.__HC_NODE_AI_TAB_GUIDE__ = true;

  const css=document.createElement("style");
  css.textContent=`
    .hc-ai-guide{
      position:fixed;right:18px;bottom:18px;z-index:99999;
      width:360px;background:#07131d;border:1px solid rgba(0,255,198,.35);
      color:#dff7ff;border-radius:16px;padding:14px;
      box-shadow:0 0 30px rgba(0,255,198,.18);font-family:Inter,system-ui,Arial
    }
    .hc-ai-guide h3{margin:0 0 8px;color:#00ffc6;letter-spacing:.12em;font-size:14px}
    .hc-ai-guide p{color:#91aabd;font-size:12px;line-height:1.45}
    .hc-ai-guide button{
      width:100%;margin:6px 0;padding:10px;border-radius:10px;border:1px solid rgba(0,255,198,.25);
      background:#0b1722;color:#dff7ff;font-weight:900;cursor:pointer;text-align:left
    }
    .hc-ai-guide button.primary{background:#00ffc6;color:#001;border:0;text-align:center}
    .hc-ai-output{
      margin-top:10px;max-height:210px;overflow:auto;white-space:pre-wrap;
      background:#050b12;border:1px solid rgba(0,255,198,.18);border-radius:10px;padding:10px;font-size:12px
    }
    .hc-tab-ai-strip{
      display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;
      background:#06131d;border:1px solid rgba(0,255,198,.18);margin:10px 0;border-radius:12px
    }
    .hc-tab-ai-strip button{
      background:#00ffc6;color:#001;border:0;border-radius:9px;padding:9px 12px;font-weight:900;cursor:pointer
    }
  `;
  document.head.appendChild(css);

  function nodeName(){
    const h=document.querySelector("h1,h2,.logo,.title");
    return (h?.innerText || location.pathname.split("/").filter(Boolean).pop() || "HC Node").replace(/[-_]/g," ");
  }

  function activeTab(){
    const t=document.querySelector(".tab.active,.nav .active,[aria-selected='true'],button.active");
    return (t?.innerText || "Current Tab").trim();
  }

  async function ask(prompt){
    const out=document.getElementById("hc-ai-guide-output");
    if(!out) return;
    out.textContent="TSM Neural Core running...";
    try{
      const r=await fetch("/api/hc/query",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:"HC_NODE_TAB_GUIDE",
          agent:"HC_NODE_AI",
          payload:{
            node:nodeName(),
            tab:activeTab(),
            context:prompt,
            priority:"HIGH"
          }
        })
      });
      const d=await r.json();
      out.textContent=d.reply||d.content||"No response";
    }catch(e){
      out.textContent="Guide request failed. Check /api/hc/query.";
    }
  }

  function addFloatingGuide(){
    if(document.querySelector(".hc-ai-guide")) return;
    const box=document.createElement("div");
    box.className="hc-ai-guide";
    box.innerHTML=`
      <h3>HC NODE GUIDE</h3>
      <p>Use this panel while presenting. It explains the current tab, runs BNCA, and creates an Office Manager next-action summary.</p>
      <button onclick="window.hcNodeAsk('Explain this tab for an office manager demo.')">Explain Current Tab</button>
      <button onclick="window.hcNodeAsk('Find the highest risk item in this node and return BNCA.')">Find Highest Risk</button>
      <button onclick="window.hcNodeAsk('Create a 60-second talk track for this node.')">Presentation Talk Track</button>
      <button class="primary" onclick="window.hcNodeAsk('Return TOP ISSUE, WHY IT MATTERS, BEST NEXT ACTIONS, OWNER LANE, CONFIDENCE.')">Run Node BNCA</button>
      <div id="hc-ai-guide-output" class="hc-ai-output">Ready.</div>
    `;
    document.body.appendChild(box);
  }

  function addTabAI(){
    const target=document.querySelector("main,.content,.dashboard,body");
    if(!target || document.querySelector(".hc-tab-ai-strip")) return;

    const strip=document.createElement("div");
    strip.className="hc-tab-ai-strip";
    strip.innerHTML=`
      <button onclick="window.hcNodeAsk('Summarize this tab in plain English.')">AI Summary</button>
      <button onclick="window.hcNodeAsk('Identify risk, blockers, and owner lane for this tab.')">Risk + Owner</button>
      <button onclick="window.hcNodeAsk('Generate Best Next Course of Action for this tab.')">BNCA</button>
      <button onclick="window.hcNodeAsk('Create manager talk track for this tab.')">Talk Track</button>
    `;

    const nav=document.querySelector(".tabs,.tabbar,.nav,header");
    if(nav && nav.parentNode) nav.parentNode.insertBefore(strip,nav.nextSibling);
    else target.prepend(strip);
  }

  window.hcNodeAsk=ask;

  function boot(){
    addTabAI();
    addFloatingGuide();
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot);
  else boot();

  [600,1500,3000].forEach(ms=>setTimeout(boot,ms));

  console.log("HC Node AI Tab Guide installed");
})();
