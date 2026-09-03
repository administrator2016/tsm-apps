'use strict';
const express = require('express');
const router  = express.Router();

const fs   = require('fs');
const path = require('path');


// ===== FORCE MUSIC ROUTE (TOP LEVEL) =====
console.log("🚀 Registering MUSIC routes...");

global.MUSIC_SUITE_STATE = {
  artistsOnline: 12,
  releasesDropping: 3,
  monthlyStreams: "84M",
  revenueMTD: 847400,
  pipelineValue: 2400000,
  aiStatus: "online"
};

router.get('/api/music/state', (_req, res) => {
  console.log("🎵 /api/music/state HIT");
  return res.json({ ok: true, state: global.MUSIC_SUITE_STATE });
});

// ===== END MUSIC ROUTE =====

// ===== PER-VISITOR SESSION SCOPING =====
// Previously every route here read/wrote ONE shared global object
// (global.MUSIC_ENGINE, global.MUSIC_BILLING, global.MUSIC_REVISIONS,
// global.MUSIC_PRODUCT, global.MUSIC_SESSIONS) with no per-user key at all.
// That meant any two concurrent visitors — you testing while a prospect has
// a live demo open, or two prospects with separate links — saw and
// overwrote each other's Artist DNA, run history, and tier/billing usage.
// This keys all of that per-visitor: the existing demo_token (shared,
// watermarked prospect links) when present, otherwise a cookie-based
// anonymous session id.
const crypto = require('crypto');

global.MUSIC_STATE_BY_SESSION = global.MUSIC_STATE_BY_SESSION || {};

function newMusicState(){
  return {
    engine: {
      dna: {
        artist: "Current Artist",
        styleTerms: ["pain", "resilience", "late-night", "pressure", "bounce"],
        weights: { cadence: 0.88, emotion: 0.91, structure: 0.76, imagery: 0.82 },
        learnedSongs: []
      },
      runs: [],
      activity: []
    },
    revisions: { sessions: [], selected: null },
    product: {
      selectedHistory: [],
      dashboard: { lastSelected: null, lastHitPotential: null, monetizationTier: "Tier 1 · $99/mo", status: "ready" }
    },
    sessions: {
      artists: {},
      exports: [],
      upsells: [],
      tiers: {
        free: { name:"Free Trial", price:0, hooks:5, exports:false, sessions:1 },
        tier1: { name:"Tier 1", price:99, hooks:25, exports:true, sessions:5 },
        tier2: { name:"Tier 2", price:249, hooks:100, exports:true, sessions:25 },
        tier3: { name:"Tier 3", price:499, hooks:500, exports:true, sessions:100 }
      }
    },
    billing: {
      currentTier: "free",
      usage: { aiRuns: 0, exports: 0, hookPacks: 0, sessions: 0 },
      tiers: {
        free: { name:"Free Trial", price:0, aiRuns:5, sessions:1, exports:false, dna:"Preview only", label:"Test the system. See how it thinks.", bestFor:"Trying the engine before committing." },
        tier1: { name:"Creator Mode", price:99, aiRuns:25, sessions:5, exports:true, dna:"Basic Artist DNA", label:"Turn rough ideas into structured, polished drafts fast.", bestFor:"Independent artists writing consistently." },
        tier2: { name:"Studio Mode", price:249, aiRuns:100, sessions:25, exports:true, dna:"Advanced Artist DNA + evolution timeline", label:"Know which version is actually better. Stop guessing what works.", bestFor:"Artists serious about releasing music." },
        tier3: { name:"Label Mode", price:499, aiRuns:500, sessions:100, exports:true, dna:"Deep catalog memory + release decision engine", label:"Build a catalog. Not just songs. Operate like a label.", bestFor:"Teams, producers, and catalog builders." }
      },
      upgradeEvents: []
    },
    createdAt: new Date().toISOString()
  };
}

function parseMusicCookies(req){
  const header = req.headers && req.headers.cookie;
  const out = {};
  if(!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if(idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if(k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function musicSessionMiddleware(req, res, next){
  const demoToken = req.query.demo_token || req.headers['x-demo-token'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || null;

  let sid = demoToken;
  let isNewCookie = false;

  if(!sid){
    const cookies = parseMusicCookies(req);
    sid = cookies.tsm_music_sid;
    if(!sid){
      sid = 'anon-' + crypto.randomBytes(16).toString('hex');
      isNewCookie = true;
    }
  }

  if(isNewCookie){
    res.setHeader('Set-Cookie', `tsm_music_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
  }

  if(!global.MUSIC_STATE_BY_SESSION[sid]){
    global.MUSIC_STATE_BY_SESSION[sid] = newMusicState();
  }

  req.musicSessionId = sid;
  req.musicState = global.MUSIC_STATE_BY_SESSION[sid];
  next();
}

router.use(musicSessionMiddleware);
// ===== END PER-VISITOR SESSION SCOPING =====

function musicNow(){ return new Date().toISOString(); }

function scoreMusicDraft(text, styleTerms){
  const body = String(text || "");
  const lines = body.split(/\n+/).filter(Boolean).length;
  const lower = body.toLowerCase();
  const terms = styleTerms || [];
  const matches = terms.filter(t => lower.includes(String(t).toLowerCase())).length;

  const cadence = Math.min(.99, .72 + (lines >= 2 ? .08 : 0) + (body.length > 60 ? .06 : 0));
  const emotion = Math.min(.99, .70 + matches * .04 + (lower.includes("fight") ? .07 : 0));
  const structure = Math.min(.99, .68 + (lines >= 4 ? .12 : .05));
  const imagery = Math.min(.99, .66 + matches * .04 + (lower.includes("light") ? .08 : 0));
  const overall = (cadence + emotion + structure + imagery) / 4;

  return {
    cadence: Number(cadence.toFixed(2)),
    emotion: Number(emotion.toFixed(2)),
    structure: Number(structure.toFixed(2)),
    imagery: Number(imagery.toFixed(2)),
    overall: Number(overall.toFixed(2))
  };
}


function cleanAgentText(text){
  return String(text || "")
    .replace(/\[(ZAY|RIYA|DJ)[^\]]*\]/g, "")
    .replace(/^Agent move:.*$/gm, "")
    .replace(/^DNA influence:.*$/gm, "")
    .replace(/^Cadence note:.*$/gm, "")
    .replace(/^Tone note:.*$/gm, "")
    .replace(/^Arrangement note:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Self-contained Groq call — same direct-fetch pattern already used in
// server.js's /api/collective/bnca route. No dependency on server.js's
// local groqChat() helper, so this file stays a standalone router module.
async function musicGroqCall(systemPrompt, userPrompt, maxTokens){
  const groqKey = process.env.GROQ_API_KEY;
  if(!groqKey) throw new Error("GROQ_API_KEY not configured on server.");

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + groqKey },
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.85,
      max_tokens: maxTokens || 500,
      // gpt-oss-120b is a reasoning model — its hidden "thinking" tokens are
      // deducted from max_tokens same as visible output. "low" keeps more of
      // the budget available for the actual answer; without this, requests
      // that need a lot of structured output (e.g. a full song JSON) can
      // exhaust max_tokens on reasoning alone and return empty content with
      // finish_reason "length" while still reporting a 200/ok response.
      reasoning_effort: "low"
    })
  });

  if(!r.ok){
    const errText = await r.text().catch(() => "");
    throw new Error("Groq error " + r.status + ": " + errText.slice(0, 200));
  }

  const data = await r.json();
  const choice = (data.choices && data.choices[0]) || {};
  const content = ((choice.message && choice.message.content) || "").trim();

  if(!content && choice.finish_reason === "length"){
    throw new Error(
      "Groq returned no visible content: hit max_tokens (" + (maxTokens || 500) +
      ") before finishing its reasoning. Increase maxTokens or shorten the request."
    );
  }

  return content;
}

const MUSIC_AGENT_PROMPTS = {
  ZAY: "You are ZAY, a music producer AI focused on cadence, flow, and bounce. Given a lyric draft, rewrite it to tighten the rhythm, shorten heavy phrasing, and make the last line hit in-pocket. Preserve the artist's voice and meaning. Return ONLY the revised lyrics — no preamble, no labels, no explanation.",
  RIYA: "You are RIYA, a music producer AI focused on emotion and imagery. Given a lyric draft, sharpen the emotional imagery and make it more specific and vivid while keeping the artist's voice plain-spoken and authentic. Return ONLY the revised lyrics — no preamble, no labels, no explanation.",
  DJ: "You are DJ, a music producer AI focused on structure and hooks. Given a lyric draft, move the strongest repeatable phrase into hook position and clean up the transitions for commercial impact. Return ONLY the revised lyrics — no preamble, no labels, no explanation."
};

async function agentPass(agent, draft, request, dna){
  const a = String(agent || "ZAY").toUpperCase();
  const base = cleanAgentText(draft || "");
  const terms = ((dna && dna.styleTerms) || []).join(", ");
  const sys = MUSIC_AGENT_PROMPTS[a] || MUSIC_AGENT_PROMPTS.ZAY;
  const userPrompt = "Artist style terms: " + (terms || "none yet") +
    "\nRequest: " + (request || "Improve this draft") +
    "\n\nDraft:\n" + (base || "(no draft provided — write an original opening verse in this style)");

  try {
    const output = await musicGroqCall(sys, userPrompt, 500);
    return output || base;
  } catch(e){
    console.error("[music agentPass] Groq error:", e.message);
    return base; // fail safe: never break the chain, just pass the draft through unchanged
  }
}


function musicActivity(engine, type, title, detail){
  const item = { id: Date.now(), type, title, detail, createdAt: musicNow() };
  engine.activity.unshift(item);
  engine.activity = engine.activity.slice(0, 50);
  return item;
}

router.post('/api/music/agent/run', async (req, res) => {
  const body = req.body || {};
  const engine = req.musicState.engine;
  const billing = req.musicState.billing;
  const agent = String(body.agent || "ZAY").toUpperCase();
  const draft = body.draft || "";
  const request = body.request || "Improve draft";
  const output = await agentPass(agent, draft, request, engine.dna);
  const score = scoreMusicDraft(output, engine.dna.styleTerms);

  const run = {
    id: Date.now(),
    mode: "single",
    agent,
    request,
    input: draft,
    output,
    score,
    createdAt: musicNow()
  };

  engine.runs.unshift(run);
  engine.runs = engine.runs.slice(0, 25);
  musicActivity(engine, "agent", agent + " pass complete", request);

  billing.usage.aiRuns += 1;
  return res.json({ ok: true, run, engine, billing });
});

router.post('/api/music/agent/chain', async (req, res) => {
  const body = req.body || {};
  const engine = req.musicState.engine;
  const billing = req.musicState.billing;
  const draft = body.draft || "";
  const request = body.request || "Run full ZAY → RIYA → DJ chain";

  const baseDraft = cleanAgentText(draft);
  const zay = await agentPass("ZAY", baseDraft, request, engine.dna);
  const riya = await agentPass("RIYA", cleanAgentText(zay), request, engine.dna);
  const dj = await agentPass("DJ", cleanAgentText(riya), request, engine.dna);
  const score = scoreMusicDraft(dj, engine.dna.styleTerms);

  const run = {
    id: Date.now(),
    mode: "chain",
    agents: ["ZAY", "RIYA", "DJ"],
    request,
    input: draft,
    output: dj,
    pipeline: [
      { agent: "ZAY", output: zay, score: scoreMusicDraft(zay, engine.dna.styleTerms) },
      { agent: "RIYA", output: riya, score: scoreMusicDraft(riya, engine.dna.styleTerms) },
      { agent: "DJ", output: dj, score }
    ],
    score,
    createdAt: musicNow()
  };

  engine.runs.unshift(run);
  engine.runs = engine.runs.slice(0, 25);
  engine.dna.learnedSongs.unshift({
    title: body.title || "Working Draft",
    draft,
    output: dj,
    score,
    learnedAt: musicNow()
  });
  engine.dna.learnedSongs = engine.dna.learnedSongs.slice(0, 12);

  musicActivity(engine, "chain", "Multi-agent chain complete", "ZAY → RIYA → DJ score " + score.overall);

  billing.usage.aiRuns += 1;
  return res.json({ ok: true, run, engine, billing });
});

router.post('/api/music/dna/learn', (req, res) => {
  const engine = req.musicState.engine;
  const body = req.body || {};
  const draft = body.draft || body.lyrics || "";
  const score = scoreMusicDraft(draft, engine.dna.styleTerms);

  engine.dna.learnedSongs.unshift({
    id: Date.now(),
    title: body.title || "Learned Song",
    lyrics: draft,
    score,
    learnedAt: musicNow()
  });
  engine.dna.learnedSongs = engine.dna.learnedSongs.slice(0, 12);

  musicActivity(engine, "dna", "Artist DNA learned new song", body.title || "Learned Song");
  return res.json({ ok: true, dna: engine.dna, score });
});

router.get('/api/music/engine', (req, res) => {
  return res.json({ ok: true, engine: req.musicState.engine });
});
// ===== END MUSIC MULTI-AGENT ENGINE =====

// ===== MUSIC REVISION MODE =====

router.post('/api/music/revision/generate', (req, res) => {
  const engine = req.musicState.engine;
  const revisions = req.musicState.revisions;
  const billing = req.musicState.billing;
  const body = req.body || {};
  const draft = body.draft || "";
  const request = body.request || "Generate 3 revision options";

  const a = agentPass("ZAY", draft, request, engine.dna);
  const b = agentPass("RIYA", draft, request, engine.dna);
  const c = agentPass("DJ", draft, request, engine.dna);

  const options = [
    { id:"A", title:"Option A · Flow First", strategy:"Cadence and bounce", output:a, score:scoreMusicDraft(a, engine.dna.styleTerms) },
    { id:"B", title:"Option B · Emotion First", strategy:"Imagery and vulnerability", output:b, score:scoreMusicDraft(b, engine.dna.styleTerms) },
    { id:"C", title:"Option C · Hook First", strategy:"Structure and repeatability", output:c, score:scoreMusicDraft(c, engine.dna.styleTerms) }
  ].sort((x,y) => y.score.overall - x.score.overall);

  const session = {
    id: Date.now(),
    request,
    input: draft,
    options,
    recommended: options[0].id,
    createdAt: new Date().toISOString()
  };

  revisions.sessions.unshift(session);
  revisions.sessions = revisions.sessions.slice(0,20);

  billing.usage.aiRuns += 1;
  return res.json({ ok:true, session, billing });
});

router.post('/api/music/revision/select', (req, res) => {
  const engine = req.musicState.engine;
  const revisions = req.musicState.revisions;
  const body = req.body || {};
  const session = revisions.sessions.find(s => String(s.id) === String(body.sessionId));
  if(!session) return res.status(404).json({ ok:false, error:"Revision session not found" });

  const option = session.options.find(o => o.id === body.optionId);
  if(!option) return res.status(404).json({ ok:false, error:"Revision option not found" });

  revisions.selected = { sessionId:body.sessionId, optionId:body.optionId, option, selectedAt:new Date().toISOString() };

  engine.dna.learnedSongs.unshift({
    title:"Selected Revision " + body.optionId,
    draft:session.input,
    output:option.output,
    score:option.score,
    learnedAt:new Date().toISOString()
  });
  engine.dna.learnedSongs = engine.dna.learnedSongs.slice(0,12);

  return res.json({ ok:true, selected:revisions.selected });
});

router.get('/api/music/revision/state', (req, res) => {
  return res.json({ ok:true, revisions:req.musicState.revisions });
});
// ===== END MUSIC REVISION MODE =====

// ===== MUSIC PRODUCT LAYER =====

function hitPotential(score){
  const s = score || {};
  const base = ((s.cadence || .7) + (s.emotion || .7) + (s.structure || .7) + (s.imagery || .7)) / 4;
  const percent = Math.round(base * 100);
  let label = "Developing";
  if(percent >= 86) label = "Release Ready";
  else if(percent >= 80) label = "Strong Hook Potential";
  else if(percent >= 74) label = "Needs One More Pass";
  return { percent, label };
}

router.post('/api/music/revision/pick-rerun', async (req, res) => {
  const engine = req.musicState.engine;
  const revisions = req.musicState.revisions;
  const product = req.musicState.product;
  const billing = req.musicState.billing;
  const body = req.body || {};
  const session = revisions.sessions.find(s => String(s.id) === String(body.sessionId));

  if(!session) return res.status(404).json({ ok:false, error:"Revision session not found" });

  const option = session.options.find(o => o.id === body.optionId);
  if(!option) return res.status(404).json({ ok:false, error:"Revision option not found" });

  const cleanSelected = cleanAgentText(option.output);
  const rerunZay = await agentPass("ZAY", cleanSelected, "Pick + rerun", engine.dna);
  const rerunRiya = await agentPass("RIYA", cleanAgentText(rerunZay), "Pick + rerun", engine.dna);
  const rerunOutput = await agentPass("DJ", cleanAgentText(rerunRiya), "Pick + rerun", engine.dna);
  const score = scoreMusicDraft(rerunOutput, engine.dna.styleTerms);
  const hit = hitPotential(score);

  const rerun = {
    id: Date.now(),
    mode: "pick-rerun",
    selectedOption: option.id,
    input: option.output,
    output: rerunOutput,
    score,
    hitPotential: hit,
    createdAt: new Date().toISOString()
  };

  engine.runs.unshift(rerun);
  engine.runs = engine.runs.slice(0,25);

  engine.dna.learnedSongs.unshift({
    title: "Selected Revision " + option.id,
    draft: session.input,
    output: rerunOutput,
    score,
    learnedAt: new Date().toISOString()
  });
  engine.dna.learnedSongs = engine.dna.learnedSongs.slice(0,12);

  product.selectedHistory.unshift({
    sessionId: session.id,
    optionId: option.id,
    score,
    hitPotential: hit,
    createdAt: new Date().toISOString()
  });

  product.dashboard.lastSelected = option;
  product.dashboard.lastHitPotential = hit;
  product.dashboard.status = "iterated";

  billing.usage.aiRuns += 1;
  return res.json({ ok:true, selected:option, rerun, product, engine, billing });
});

router.get('/api/music/dashboard-sync', (req, res) => {
  return res.json({
    ok:true,
    product:req.musicState.product,
    engine:req.musicState.engine,
    revisions:req.musicState.revisions
  });
});
// ===== END MUSIC PRODUCT LAYER =====

// ===== MUSIC EVOLUTION TIMELINE =====
router.get('/api/music/evolution', (req, res) => {
  const runs = req.musicState.engine.runs;
  const product = req.musicState.product;
  const dna = req.musicState.engine.dna;

  const timeline = runs.slice(0, 12).map((r, i) => ({
    index: i,
    label: r.mode || "run",
    overall: r.score && r.score.overall ? r.score.overall : 0,
    score: r.score || {},
    hitPotential: r.hitPotential || null,
    createdAt: r.createdAt
  })).reverse();

  const latest = timeline[timeline.length - 1] || null;
  const previous = timeline[timeline.length - 2] || null;
  const delta = latest && previous ? Number((latest.overall - previous.overall).toFixed(2)) : 0;

  let hit = latest && latest.hitPotential ? latest.hitPotential : null;
  if(!hit){
    hit = hitPotential(latest ? latest.score : {});
  }

  let decision = "Iterate Again";
  if(hit && hit.percent >= 86) decision = "Release";
  else if(hit && hit.percent < 74) decision = "Scrap / Rework Hook";

  return res.json({
    ok:true,
    timeline,
    latest,
    previous,
    delta,
    hit,
    decision,
    dna,
    product
  });
});
// ===== END MUSIC EVOLUTION TIMELINE =====

// ===== MUSIC MONETIZATION + EXPORT + SESSIONS =====

function musicArtistKey(name){
  return String(name || "Current Artist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "current-artist";
}

function ensureMusicArtist(sessionsState, name){
  const key = musicArtistKey(name);
  if(!sessionsState.artists[key]){
    sessionsState.artists[key] = {
      key,
      artist:name || "Current Artist",
      tier:"tier1",
      sessions:[],
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
  }
  return sessionsState.artists[key];
}

function cleanCreativeOutput(text){
  return String(text || "")
    .replace(/\[(ZAY|RIYA|DJ)[^\]]*\]/g, "")
    .replace(/^Agent move:.*$/gm, "")
    .replace(/^DNA influence:.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

router.post('/api/music/session/save', (req, res) => {
  const sessionsState = req.musicState.sessions;
  const billing = req.musicState.billing;
  const body = req.body || {};
  const artist = ensureMusicArtist(sessionsState, body.artist || "Current Artist");

  const session = {
    id:Date.now(),
    title:body.title || "Untitled Session",
    draft:body.draft || "",
    output:body.output || "",
    score:body.score || null,
    notes:body.notes || "",
    createdAt:new Date().toISOString()
  };

  artist.sessions.unshift(session);
  artist.sessions = artist.sessions.slice(0, sessionsState.tiers[artist.tier].sessions);
  artist.updatedAt = new Date().toISOString();

  billing.usage.sessions += 1;
  return res.json({ ok:true, artist, session, billing });
});

router.get('/api/music/session/:artist', (req, res) => {
  const artist = ensureMusicArtist(req.musicState.sessions, req.params.artist || "Current Artist");
  return res.json({ ok:true, artist });
});

router.post('/api/music/hooks/generate10', (req, res) => {
  const sessionsState = req.musicState.sessions;
  const billing = req.musicState.billing;
  const body = req.body || {};
  const draft = cleanCreativeOutput(body.draft || "");
  const artist = ensureMusicArtist(sessionsState, body.artist || "Current Artist");

  const hooks = Array.from({length:10}).map((_, i) => ({
    id:i+1,
    title:"Hook Option " + (i+1),
    text:
      i % 3 === 0 ? "Still I rise when the night get heavy" :
      i % 3 === 1 ? "Wrong all around me, but I still move right" :
      "Turn the pain into light when the pressure get tight",
    angle:
      i % 3 === 0 ? "resilience" :
      i % 3 === 1 ? "conflict" :
      "release"
  }));

  sessionsState.upsells.unshift({
    id:Date.now(),
    artist:artist.artist,
    type:"generate10hooks",
    price:25,
    createdAt:new Date().toISOString()
  });

  billing.usage.hookPacks += 1;
  return res.json({
    ok:true,
    upsell:{ name:"Generate 10 Hooks", price:25 },
    hooks,
    source:draft
  });
});

router.post('/api/music/export', (req, res) => {
  const sessionsState = req.musicState.sessions;
  const billing = req.musicState.billing;
  const body = req.body || {};
  const artist = body.artist || "Current Artist";
  const title = body.title || "Music Export";
  const output = cleanCreativeOutput(body.output || body.draft || "");
  const score = body.score || null;

  const doc = [
    "TSM MUSIC COMMAND EXPORT",
    "Artist: " + artist,
    "Title: " + title,
    "Date: " + new Date().toISOString(),
    "",
    "OUTPUT",
    "------",
    output,
    "",
    "SCORE",
    "-----",
    score ? JSON.stringify(score, null, 2) : "No score attached.",
    "",
    "DAW NOTES",
    "---------",
    "Paste the output into Pro Tools, FL Studio, Ableton, Logic, or your writing doc.",
    "Use ZAY for cadence, RIYA for emotion, and DJ for hook/structure refinement."
  ].join("\n");

  const item = {
    id:Date.now(),
    artist,
    title,
    format:"txt",
    content:doc,
    createdAt:new Date().toISOString()
  };

  sessionsState.exports.unshift(item);
  sessionsState.exports = sessionsState.exports.slice(0,50);

  billing.usage.exports += 1;
  return res.json({ ok:true, export:item, billing });
});

router.get('/api/music/monetization/state', (req, res) => {
  const sessionsState = req.musicState.sessions;
  return res.json({
    ok:true,
    monetization:{
      tiers:sessionsState.tiers,
      upsells:[
        { name:"Generate 10 hooks", price:25 },
        { name:"Commercial rewrite pack", price:30 },
        { name:"Radio-ready polish", price:25 }
      ],
      recentUpsells:sessionsState.upsells,
      exports:sessionsState.exports.slice(0,10)
    },
    sessions:sessionsState
  });
});
// ===== END MUSIC MONETIZATION + EXPORT + SESSIONS =====

// ===== MUSIC TIER + PAYWALL + USAGE LAYER =====

function musicTier(billing){
  return billing.tiers[billing.currentTier] || billing.tiers.free;
}

function musicCanUse(billing, kind){
  const tier = musicTier(billing);
  const usage = billing.usage;

  if(kind === "aiRuns" && usage.aiRuns >= tier.aiRuns){
    return { ok:false, reason:"AI run limit reached", upgrade:true, tier };
  }

  if(kind === "sessions" && usage.sessions >= tier.sessions){
    return { ok:false, reason:"Session limit reached", upgrade:true, tier };
  }

  if(kind === "exports" && !tier.exports){
    return { ok:false, reason:"Exports require Creator Mode", upgrade:true, tier };
  }

  return { ok:true, tier };
}

router.get('/api/music/billing/state', (req, res) => {
  const billing = req.musicState.billing;
  const tier = musicTier(billing);
  return res.json({
    ok:true,
    billing,
    current:tier,
    remaining:{
      aiRuns:Math.max(0, tier.aiRuns - billing.usage.aiRuns),
      sessions:Math.max(0, tier.sessions - billing.usage.sessions),
      exports:tier.exports
    }
  });
});

router.post('/api/music/billing/upgrade-intent', (req, res) => {
  const billing = req.musicState.billing;
  const body = req.body || {};
  const targetTier = body.tier || "tier1";

  if(!billing.tiers[targetTier]){
    return res.status(400).json({ ok:false, error:"Invalid tier" });
  }

  const event = {
    id:Date.now(),
    from:billing.currentTier,
    to:targetTier,
    reason:body.reason || "manual upgrade intent",
    createdAt:new Date().toISOString(),
    stripeReady:true
  };

  billing.upgradeEvents.unshift(event);

  return res.json({
    ok:true,
    upgrade:event,
    checkout:{
      provider:"stripe-ready",
      tier:targetTier,
      price:billing.tiers[targetTier].price,
      note:"Connect Stripe checkout URL here."
    }
  });
});

router.post('/api/music/billing/set-tier-dev', (req, res) => {
  const billing = req.musicState.billing;
  const body = req.body || {};
  const tier = body.tier || "free";

  if(!billing.tiers[tier]){
    return res.status(400).json({ ok:false, error:"Invalid tier" });
  }

  billing.currentTier = tier;
  return res.json({ ok:true, billing });
});
// ===== END MUSIC TIER + PAYWALL + USAGE LAYER =====

// ===== MUSIC PROTECTION LAYER =====
global.MUSIC_DEMO_ACCESS = global.MUSIC_DEMO_ACCESS || {
  tokens: {},
  usage: {}
};

function makeDemoToken(client="demo", hours=48){
  const token = crypto.randomBytes(24).toString("hex") + Date.now();
  const expiresAt = Date.now() + Number(hours || 48) * 60 * 60 * 1000;

  global.MUSIC_DEMO_ACCESS.tokens[token] = {
    token,
    client,
    expiresAt,
    createdAt: new Date().toISOString(),
    watermark: `ZY MUSIC COMMAND · ${client} · ${token.slice(0,6)}`,
    maxViews: 3,
    maxApiHits: 15,
    views: 0,
    locked: false,
    lockReason: null,
    events: []
  };

  return global.MUSIC_DEMO_ACCESS.tokens[token];
}

function getDemoToken(req){
  return (
    req.query.demo_token ||
    req.headers["x-demo-token"] ||
    req.headers["authorization"]?.replace(/^Bearer\s+/i, "")
  );
}

function validateDemoAccess(req){
  const token = getDemoToken(req);
  if(!token) return { ok:false, error:"Missing demo token" };

  const record = global.MUSIC_DEMO_ACCESS.tokens[token];
  if(!record) return { ok:false, error:"Invalid demo token" };

  if(record.locked){
    return { ok:false, error:record.lockReason || "Demo link locked" };
  }

  if(Date.now() > record.expiresAt){
    record.locked = true;
    record.lockReason = "Demo token expired";
    return { ok:false, error:"Demo token expired" };
  }

  const usage = global.MUSIC_DEMO_ACCESS.usage[token];
  if(usage && usage.hits >= (record.maxApiHits || 15)){
    record.locked = true;
    record.lockReason = "Demo usage limit reached";
    return { ok:false, error:"Demo usage limit reached" };
  }

  return { ok:true, token, record };
}

function trackMusicUsage(req, action){
  const token = getDemoToken(req) || "public";
  const access = global.MUSIC_DEMO_ACCESS.tokens[token] || {
    client:"public",
    watermark:"ZY MUSIC COMMAND · PUBLIC"
  };

  if(!global.MUSIC_DEMO_ACCESS.usage[token]){
    global.MUSIC_DEMO_ACCESS.usage[token] = {
      token,
      client: access.client,
      hits: 0,
      actions: {},
      firstSeen: new Date().toISOString(),
      lastSeen: null
    };
  }

  const usage = global.MUSIC_DEMO_ACCESS.usage[token];
  usage.hits += 1;
  usage.lastSeen = new Date().toISOString();
  usage.actions[action] = (usage.actions[action] || 0) + 1;

  return usage;
}

function requireMusicDemo(req, res, next){
  // Allow local/dev and public marketing page access through normal static.
  if(req.path.includes("/api/music/demo/create")) return next();

  const access = validateDemoAccess(req);
  if(!access.ok){
    return res.status(401).json({
      ok:false,
      protected:true,
      error:access.error,
      message:"This Music Command demo requires an active share link."
    });
  }

  req.musicDemo = access.record;
  trackMusicUsage(req, req.path);
  next();
}

router.post('/api/music/demo/create', (req, res) => {
  const body = req.body || {};
  const client = body.client || "prospect";
  const hours = body.hours || 48;
  const record = makeDemoToken(client, hours);

  return res.json({
    ok:true,
    demo:record,
    // Real deployed pages live under html/war-rooms/music-war/ -- these
    // previously pointed at html/music-command/, a directory that has
    // never existed, so every prospect demo link 404'd. 'exec' dropped:
    // it pointed at index2.html, which has no counterpart anywhere in
    // music-war (this vertical has no separate exec-portal page), and
    // nothing in the codebase reads links.exec anyway.
    links:{
      app:`/html/war-rooms/music-war/index.html?demo_token=${record.token}`,
      presentation:`/html/war-rooms/music-war/presentation-live.html?demo_token=${record.token}`,
      marketing:`/html/war-rooms/music-war/release/marketing.html?demo_token=${record.token}`
    }
  });
});

router.get('/api/music/demo/validate', (req, res) => {
  const access = validateDemoAccess(req);
  if(!access.ok) return res.status(401).json({ ok:false, error:access.error });

  const usage = trackMusicUsage(req, "validate");
  return res.json({
    ok:true,
    demo:access.record,
    watermark:access.record.watermark,
    usage
  });
});

router.get('/api/music/demo/usage', (req, res) => {
  return res.json({
    ok:true,
    usage:global.MUSIC_DEMO_ACCESS.usage,
    tokens:Object.values(global.MUSIC_DEMO_ACCESS.tokens).map(t => ({
      client:t.client,
      token:t.token,
      createdAt:t.createdAt,
      expiresAt:t.expiresAt,
      watermark:t.watermark
    }))
  });
});
// ===== END MUSIC PROTECTION LAYER =====

// ===== MUSIC DEMO DEAL-CLOSING MODE =====
function recordDemoEvent(token, type, detail){
  const record = global.MUSIC_DEMO_ACCESS.tokens[token];
  if(!record) return null;

  const event = {
    id: Date.now(),
    type,
    detail: detail || "",
    createdAt: new Date().toISOString()
  };

  record.events = record.events || [];
  record.events.unshift(event);
  record.events = record.events.slice(0, 50);

  return event;
}

router.post('/api/music/demo/view', (req, res) => {
  const access = validateDemoAccess(req);
  if(!access.ok) return res.status(401).json({ ok:false, error:access.error, locked:true });

  const record = access.record;
  record.views = (record.views || 0) + 1;

  if(record.views > (record.maxViews || 3)){
    record.locked = true;
    record.lockReason = "Demo view limit reached";
    recordDemoEvent(access.token, "locked", "View limit reached");
    return res.status(403).json({ ok:false, error:"Demo view limit reached", locked:true, record });
  }

  const event = recordDemoEvent(access.token, "viewed", `Demo opened by ${record.client}`);
  const usage = trackMusicUsage(req, "demo_view");

  const hoursLeft = Math.max(0, Math.ceil((record.expiresAt - Date.now()) / (60 * 60 * 1000)));
  const viewsLeft = Math.max(0, (record.maxViews || 3) - record.views);

  return res.json({
    ok:true,
    viewed:true,
    event,
    usage,
    demo:record,
    urgency:{
      hoursLeft,
      viewsLeft,
      message: `Private demo link expires in ${hoursLeft} hour(s) or ${viewsLeft} view(s).`
    }
  });
});

router.post('/api/music/demo/lock', (req, res) => {
  const body = req.body || {};
  const token = body.token || getDemoToken(req);
  const record = global.MUSIC_DEMO_ACCESS.tokens[token];

  if(!record) return res.status(404).json({ ok:false, error:"Token not found" });

  record.locked = true;
  record.lockReason = body.reason || "Locked by owner";
  recordDemoEvent(token, "locked", record.lockReason);

  return res.json({ ok:true, demo:record });
});

router.post('/api/music/demo/unlock', (req, res) => {
  const body = req.body || {};
  const token = body.token || getDemoToken(req);
  const record = global.MUSIC_DEMO_ACCESS.tokens[token];

  if(!record) return res.status(404).json({ ok:false, error:"Token not found" });

  record.locked = false;
  record.lockReason = null;
  recordDemoEvent(token, "unlocked", "Unlocked by owner");

  return res.json({ ok:true, demo:record });
});

router.get('/api/music/demo/deal-room', (req, res) => {
  return res.json({
    ok:true,
    tokens:Object.values(global.MUSIC_DEMO_ACCESS.tokens).map(t => ({
      token:t.token,
      client:t.client,
      createdAt:t.createdAt,
      expiresAt:t.expiresAt,
      views:t.views || 0,
      maxViews:t.maxViews || 3,
      maxApiHits:t.maxApiHits || 15,
      locked:!!t.locked,
      lockReason:t.lockReason || null,
      watermark:t.watermark,
      events:t.events || []
    })),
    usage:global.MUSIC_DEMO_ACCESS.usage
  });
});
// ===== END MUSIC DEMO DEAL-CLOSING MODE =====

// ===== MUSIC REVISION RUN COMPATIBILITY ROUTE =====
router.post('/api/music/revision/run', (req, res) => {
  const musicState = req.musicState;
  const body = req.body || {};
  const draft = body.draft || body.input || body.text || "";
  const request = body.request || "guided creation app";

  if (!draft.trim()) {
    return res.status(400).json({ ok:false, error:"No draft provided" });
  }

  function localScore(txt){
    const len = String(txt || "").length;
    const base = Math.min(0.86, 0.70 + (len % 18) / 100);
    return {
      cadence: +(base + 0.06).toFixed(2),
      emotion: +(base + 0.00).toFixed(2),
      structure: +(base + 0.04).toFixed(2),
      imagery: +(base - 0.02).toFixed(2),
      overall: +(base + 0.03).toFixed(2)
    };
  }

  const score = localScore(draft);

  const flow = `[ZAY — CADENCE / BOUNCE]\n\n${draft}\n\nAgent move: tighten rhythm, shorten heavy phrasing, and make the last phrase hit in-pocket.`;
  const emotion = `[RIYA — EMOTION / IMAGERY]\n\n${draft}\n\nAgent move: make the emotional image more specific while keeping the artist voice plain-spoken.`;
  const hook = `[DJ — STRUCTURE / HOOK]\n\n${draft}\n\nAgent move: move the strongest repeatable phrase into hook position and clean the transition.`;

  const session = {
    id: Date.now(),
    request,
    input: draft,
    options: [
      { id:"A", title:"Flow First", strategy:"Cadence and bounce", output:flow, score },
      { id:"B", title:"Emotion First", strategy:"Imagery and vulnerability", output:emotion, score:{...score, overall:+(score.overall-.02).toFixed(2)} },
      { id:"C", title:"Hook First", strategy:"Structure and repeatability", output:hook, score:{...score, overall:+(score.overall-.01).toFixed(2)} }
    ],
    recommended:"A",
    createdAt:new Date().toISOString()
  };

  // Scoped to this visitor's own state — was previously written onto the
  // shared global.MUSIC_SUITE_STATE.lastRevision/lastRun, which meant one
  // visitor's "last run" would show up on every other visitor's dashboard.
  musicState.legacyRevisionSessions = musicState.legacyRevisionSessions || {};
  musicState.legacyRevisionSessions[String(session.id)] = session;

  musicState.lastRevision = session;
  musicState.lastRun = {
    agents:["ZAY","RIYA","DJ"],
    output:flow,
    score,
    createdAt:session.createdAt
  };

  return res.json({
    ok:true,
    session,
    run:musicState.lastRun
  });
});
// ===== END MUSIC REVISION RUN COMPATIBILITY ROUTE =====

// ===== MUSIC SUITE API INLINE =====
global.MUSIC_SUITE_STATE = global.MUSIC_SUITE_STATE || {
  artistsOnline: 12,
  releasesDropping: 3,
  monthlyStreams: "84M",
  revenueMTD: 847400,
  pipelineValue: 2400000,
  aiStatus: "online"
};



// ===== END MUSIC SUITE API INLINE =====

// ===== MUSIC PLATFORM EXECUTION LOOP =====
global.MUSIC_PLATFORM = global.MUSIC_PLATFORM || {
  artistDNA: {
    status: "active",
    artist: "Current Artist",
    styleTerms: ["pain", "resilience", "late-night", "pressure", "bounce"],
    weights: { cadence: 0.88, emotion: 0.91, structure: 0.76, imagery: 0.82 },
    learnedSongs: []
  },
  agentRuns: [],
  activity: []
};

function musicStamp(){ return new Date().toISOString(); }

function pushMusicActivity(type, title, detail){
  const item = { id: Date.now(), type, title, detail, createdAt: musicStamp() };
  global.MUSIC_PLATFORM.activity.unshift(item);
  global.MUSIC_PLATFORM.activity = global.MUSIC_PLATFORM.activity.slice(0, 50);
  return item;
}




// ===== END MUSIC PLATFORM EXECUTION LOOP =====

function requireMusicDemo(req, res, next){
  // Allow local/dev and public marketing page access through normal static.
  if(req.path.includes("/api/music/demo/create")) return next();

  const access = validateDemoAccess(req);
  if(!access.ok){
    return res.status(401).json({
      ok:false,
      protected:true,
      error:access.error,
      message:"This Music Command demo requires an active share link."
    });
  }

  req.musicDemo = access.record;
  trackMusicUsage(req, req.path);
  next();
}

// ===== SWEET MUSIC OS — generic AI bridge =====
// Front-end pages (beat-workbench, song-builder, daw-academy, release-center,
// cadence-builder) call this instead of api.anthropic.com directly (which
// has no key in the browser and always 401s in production).
router.post('/api/music/sweet/ai', async (req, res) => {
  try {
    const body = req.body || {};
    const system = body.system || 'You are a helpful AI music production assistant. Respond ONLY with valid JSON when asked for JSON — no markdown fences, no preamble.';
    const prompt = body.prompt || '';
    const maxTokens = Math.min(Number(body.maxTokens) || 1000, 3000);
    if (!prompt) return res.status(400).json({ ok: false, error: 'Missing prompt' });
    const text = await musicGroqCall(system, prompt, maxTokens);
    return res.json({ ok: true, text });
  } catch (e) {
    console.error('[sweet/ai] error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== BEAT WORKBENCH — real instrumental file storage =====
// Replaces the old behavior (asking the AI to "analyze" a beat file it
// never received, i.e. hallucinate BPM/key from the filename string).
// Files are actually stored (chunked, see server/tsm-music-instrumentals-
// service.js) and streamed back for real playback. BPM/key/genre/mood
// are producer-supplied tags via /tag, never AI-guessed.
const multer = require('multer');
const instrumentalsService = require('../server/tsm-music-instrumentals-service');

const instrumentalsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: instrumentalsService.MAX_FILE_SIZE },
});

router.post('/api/music/instrumentals/upload', instrumentalsUpload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: 'No file uploaded' });

    const uploadedBy = (req.cookies && req.cookies.demo_token) || req.ip || null;
    const fileDoc = await instrumentalsService.storeFile({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      uploadedBy,
    });
    return res.json({ ok: true, file: fileDoc });
  } catch (e) {
    const status = e.message === 'unsupported_file_type' ? 415
      : e.message === 'file_too_large' ? 413
      : e.message === 'empty_file' ? 400
      : 500;
    console.error('[music/instrumentals upload] failed:', e.message);
    return res.status(status).json({ ok: false, error: e.message || 'upload_failed' });
  }
});

router.get('/api/music/instrumentals/list', async (req, res) => {
  try {
    const uploadedBy = (req.cookies && req.cookies.demo_token) || req.ip || null;
    const files = await instrumentalsService.listFiles({ uploadedBy });
    return res.json({ ok: true, files });
  } catch (e) {
    console.error('[music/instrumentals list] failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message || 'list_failed' });
  }
});

router.post('/api/music/instrumentals/:fileId/tag', async (req, res) => {
  try {
    const updated = await instrumentalsService.tagFile(req.params.fileId, req.body || {});
    if (!updated) return res.status(404).json({ ok: false, error: 'file_not_found' });
    return res.json({ ok: true, file: updated });
  } catch (e) {
    const status = e.message === 'no_valid_tag_fields' ? 400 : 500;
    console.error('[music/instrumentals tag] failed:', e.message);
    return res.status(status).json({ ok: false, error: e.message || 'tag_failed' });
  }
});

router.get('/api/music/instrumentals/:fileId/stream', async (req, res) => {
  try {
    const meta = await instrumentalsService.getFileMeta(req.params.fileId);
    if (!meta) return res.status(404).json({ ok: false, error: 'file_not_found' });

    res.setHeader('Content-Type', meta.mimetype || 'application/octet-stream');
    res.setHeader('Content-Length', meta.sizeBytes);
    res.setHeader('Content-Disposition', `inline; filename="${meta.filename}"`);

    for await (const chunk of instrumentalsService.readFileChunks(req.params.fileId)) {
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    console.error('[music/instrumentals stream] failed:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: e.message || 'stream_failed' });
    } else {
      res.end();
    }
  }
});

router.delete('/api/music/instrumentals/:fileId', async (req, res) => {
  try {
    const deleted = await instrumentalsService.deleteFile(req.params.fileId);
    if (!deleted) return res.status(404).json({ ok: false, error: 'file_not_found' });
    return res.json({ ok: true });
  } catch (e) {
    console.error('[music/instrumentals delete] failed:', e.message);
    return res.status(500).json({ ok: false, error: e.message || 'delete_failed' });
  }
});

module.exports = router;
