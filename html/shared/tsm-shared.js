
// TSM Persistent Dev Session Auto-Injector
if (!document.cookie.includes('tsm_session=')) {
  document.cookie = "tsm_session=dev-active-session-token; path=/; max-age=86400";
}

// ═══════════════════════════════════════════════
// TSM SHARED — Core launcher + Groq utility
// ═══════════════════════════════════════════════

window.TSM = {
  version: '2.0',
  launcher: {
    registry: {},
    register(name, fn){ this.registry[name] = fn; },
    run(action, argsStr, el){
      const fn = this.registry[action] || window[action];
      if(typeof fn === 'function'){
        try{
          const args = argsStr ? (function(){ return eval('['+argsStr+']'); }).call(el) : [];
          fn(...args);
        }catch(e){ console.warn('[TSM] Error running',action,e); }
      } else {
        console.warn('[TSM] launcher missing:',action, argsStr);
      }
    }
  }
};

// Global AI caller — routes through the real server-side proxy
// (routes/finance-chat.js POST /api/chat, contract: {message,
// conversationHistory, context} -> {answer}) instead of calling
// api.groq.com directly from the browser with a key read out of
// localStorage. No client-side key needed anymore.
window.callGroq = async function(messages, onStream){
  const withoutSystem = messages.filter(m => m.role !== 'system');
  const systemMsg = messages.find(m => m.role === 'system');
  const lastUser = [...withoutSystem].reverse().find(m => m.role === 'user');
  const msg = lastUser?.content || '';
  const conversationHistory = withoutSystem.slice(0, -1);

  let r;
  try {
    r = await fetch('/api/chat', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ message: msg, conversationHistory, context: systemMsg?.content })
    });
  } catch (networkErr) {
    throw new Error("Can't reach the AI backend — check your connection or that the server is running.");
  }
  const raw = await r.text();
  let d;
  try { d = raw ? JSON.parse(raw) : {}; } catch (parseErr) { d = {}; }
  const text = d.answer || d.text || d.response || '';
  const tok = d.usage?.completion_tokens || 0;
  const spd = Math.round(tok / ((d.usage?.total_time||1)));
  if(onStream) onStream(text, tok, spd);
  return {text, tokens:tok, speed:spd};
};

// TSM click dispatcher
document.addEventListener('click', e=>{
  const el = e.target.closest('[data-tsm-action]');
  if(!el) return;
  const action = el.getAttribute('data-tsm-action');
  const args = el.getAttribute('data-tsm-args') || '';
  TSM.launcher.run(action, args, el);
});

console.log('[TSM SHARED] v2.0 loaded');