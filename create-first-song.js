// create-first-song.js
// End-to-end walkthrough: runs a real song through the actual TSM Music
// War Room pipeline against a live server, using the real endpoints in
// routes/music.js — no mocking. Prints each stage's output so you can see
// exactly what the system does at every step.
//
// Maps to the in-app guide's "Complete Song Workflow — Start to Finish"
// (html/war-rooms/music-war/how-to-guide.html):
//   Step 1  DNA          -> POST /api/music/dna/learn
//   Step 2  Skeleton     -> (manual — this song already has its structure)
//   Step 3  Hook         -> POST /api/music/agent/chain (ZAY -> RIYA -> DJ)
//   Step 3b Hook options  -> POST /api/music/hooks/generate10
//   Step 4  Verse draft  -> POST /api/music/agent/run (single-agent pass)
//   Step 5  Revise       -> POST /api/music/revision/generate
//                        -> POST /api/music/revision/pick-rerun
//   Step 7  Instrumental -> POST /api/music/instrumentals/upload + tag
//                           (producer notes become genre/bpm tags)
//   Step 8  Final export -> POST /api/music/session/save
//                        -> POST /api/music/export
//
// Run: node create-first-song.js [base_url]
//   node create-first-song.js https://tsm-shell.fly.dev

const BASE = process.argv[2] || 'https://tsm-shell.fly.dev';

const ARTIST = 'Current Artist'; // matches server's default session artist
const TITLE = 'On The Rise';

const HOOK = `Yeah, I'm on the rise, got the game in a chokehold
Money on my mind, can't nobody take control
I'm flexing hard, got the spotlight on me
Haters in they feelings, can't you see?
I'm running circles 'round the competition
Leaving them in the dust, no need for explanation
My success is fire, burning out of control
Got the game on lock, and I'm in the mode`;

const VERSE_1 = `I came from nothing, from the bottom to the top
Had to grind hard, never gonna stop
I was sleeping on floors, now I'm living large
My bank account's fat, and my future's in charge
I remember nights, I went to bed with stress
Worrying 'bout my next meal, and my next address
But now I'm on the map, and my name is known
I'm making moves, got the game in the zone
I'm a boss, I'm a star, I'm a movement by myself
I'm a one-woman army, and I'm doing well
My flow's on point, my style's on fire
I'm leaving haters in the dust, like a heart's desire
I'm a mastermind, got the game on lock
My success is the key, and I won't stop
I'm on a mission, to make it to the top
And when I get there, I won't stop`;

const BRIDGE = `You mad, I'm glad, I'm on the rise
You hate, I elevate, got the game in the skies
You talk, I walk, I'm on the move
My success is the proof, and it's all I improve`;

const VERSE_2 = `My rival's mad, she can't keep up the pace
She's out of breath, and she's running in place
She thought she was the best, but now she's in last
My success is the proof, and it's leaving her aghast
I'm the queen of the game, and I'm here to stay
My flow's unstoppable, in every single way
I'm a force to be reckoned with, I'm on the rise
My name is in lights, and it's opening eyes
I'm a superstar, got the game in a trance
My success is the magic, that's taking over the dance
I'm a winner, got the trophy in my hand
My success is the story, that's making history grand
I'm on top of the world, and I won't apologize
My success is the reason, why I'm opening eyes`;

const OUTRO = `I'm on the top, and I won't apologize
My success is the proof, and it's opening eyes
I'm the queen of the game, and I'm here to stay
My name is in lights, and it's here to stay`;

const FULL_SONG = [
  '[HOOK]', HOOK, '', '[VERSE 1]', VERSE_1, '', '[BRIDGE]', BRIDGE,
  '', '[VERSE 2]', VERSE_2, '', '[OUTRO]', OUTRO,
].join('\n');

const CADENCE_NOTES = 'mix rapid-fire flow with relaxed drawling delivery, ' +
  'emphasize beats 2 and 4 per bar, use internal/multi-syllable rhymes';
const PRODUCER_NOTES = 'heavy bass-driven 808s + bright piercing hi-hats, ' +
  'synth leads and plucky arpeggios for playfulness/wit, tempo ~120-125 BPM';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function run() {
  // Step 1 — Artist DNA learns the finished song (in real use you'd do this
  // as you write; here we seed it with the full song since it's already done).
  section('STEP 1 — Teach Artist DNA this song (/api/music/dna/learn)');
  const dna = await post('/api/music/dna/learn', {
    title: TITLE,
    lyrics: FULL_SONG,
  });
  console.log('DNA style terms:', dna.dna.styleTerms.join(', '));
  console.log('Score for this song:', JSON.stringify(dna.score));

  // Step 3 — Run the hook through the full ZAY -> RIYA -> DJ chain to
  // sharpen cadence, emotion, and hook structure in one pass.
  section('STEP 3 — Refine the hook via the multi-agent chain (/api/music/agent/chain)');
  const hookChain = await post('/api/music/agent/chain', {
    draft: HOOK,
    request: `Sharpen this hook for commercial impact. Cadence notes: ${CADENCE_NOTES}`,
    title: TITLE,
  });
  console.log('Refined hook (after ZAY -> RIYA -> DJ):\n' + hookChain.run.output);
  console.log('Score:', JSON.stringify(hookChain.run.score));

  // Step 3b — Generate 10 alternate hook options to compare against.
  section('STEP 3b — Generate 10 alternate hook options (/api/music/hooks/generate10)');
  const hooks10 = await post('/api/music/hooks/generate10', {
    draft: HOOK,
    artist: ARTIST,
  });
  hooks10.hooks.slice(0, 3).forEach(h => console.log(`  #${h.id} [${h.angle}] ${h.text}`));
  console.log(`  ...(${hooks10.hooks.length} total options generated)`);

  // Step 4 — Single-agent pass on verse 1 (e.g. RIYA sharpening imagery).
  section('STEP 4 — Single-agent pass on Verse 1 (/api/music/agent/run)');
  const verse1Pass = await post('/api/music/agent/run', {
    agent: 'RIYA',
    draft: VERSE_1,
    request: 'Sharpen the emotional imagery in this verse while keeping the voice plain-spoken',
  });
  console.log('RIYA output:\n' + verse1Pass.run.output);

  // Step 5 — Revision Mode: generate 3 strategic options for Verse 2,
  // then pick the top-scoring one and rerun it through the chain again.
  section('STEP 5 — Revision Mode: 3 options for Verse 2 (/api/music/revision/generate)');
  const revision = await post('/api/music/revision/generate', {
    draft: VERSE_2,
    request: 'Escalate the energy relative to Verse 1, keep the rival narrative',
  });
  revision.session.options.forEach(o =>
    console.log(`  ${o.id} — ${o.title} (score: ${o.score.overall})`));
  console.log('Recommended:', revision.session.recommended);

  section('STEP 5b — Pick the recommended option and rerun (/api/music/revision/pick-rerun)');
  const rerun = await post('/api/music/revision/pick-rerun', {
    sessionId: revision.session.id,
    optionId: revision.session.recommended,
  });
  console.log('Final Verse 2 after pick + rerun:\n' + rerun.rerun.output);
  console.log('Hit potential:', JSON.stringify(rerun.rerun.hitPotential));

  // Step 7 — Attach the instrumental. Producer notes become tags on the
  // uploaded file (genre/bpm), matching how Beat Workbench tags files.
  section('STEP 7 — Upload + tag the instrumental (/api/music/instrumentals/upload)');
  const pcmBytes = 2000;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(88200, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes, 40);
  const placeholderWav = Buffer.concat([header, Buffer.alloc(pcmBytes)]);

  const form = new FormData();
  form.append('file', new Blob([placeholderWav], { type: 'audio/wav' }), `${TITLE.replace(/\s+/g, '-')}-instrumental.wav`);
  const uploadRes = await fetch(BASE + '/api/music/instrumentals/upload', { method: 'POST', body: form });
  const uploadData = await uploadRes.json();
  if (!uploadData.ok) throw new Error('instrumental upload failed: ' + JSON.stringify(uploadData));
  console.log('Uploaded instrumental, file id:', uploadData.file._id);

  const bpmMatch = PRODUCER_NOTES.match(/(\d{2,3})-?(\d{2,3})?\s*BPM/i);
  const bpm = bpmMatch ? bpmMatch[1] : '';
  const tagRes = await post(`/api/music/instrumentals/${uploadData.file._id}/tag`, {
    genre: 'Trap / Hip-Hop',
    bpm,
    notes: PRODUCER_NOTES,
  });
  console.log('Tagged instrumental:', JSON.stringify(tagRes.file.tags));

  // Step 8 — Save the finished session and export a shareable doc.
  section('STEP 8 — Save session + export (/api/music/session/save, /api/music/export)');
  const finalSong = [
    '[HOOK]', hookChain.run.output, '',
    '[VERSE 1]', verse1Pass.run.output, '',
    '[BRIDGE]', BRIDGE, '',
    '[VERSE 2]', rerun.rerun.output, '',
    '[OUTRO]', OUTRO,
  ].join('\n');

  const saved = await post('/api/music/session/save', {
    artist: ARTIST,
    title: TITLE,
    draft: FULL_SONG,
    output: finalSong,
    score: rerun.rerun.score,
    notes: `Cadence: ${CADENCE_NOTES} | Producer: ${PRODUCER_NOTES}`,
  });
  console.log('Session saved, id:', saved.session.id);

  const exported = await post('/api/music/export', {
    artist: ARTIST,
    title: TITLE,
    output: finalSong,
    score: rerun.rerun.score,
  });
  console.log('\n--- EXPORTED DOCUMENT ---\n');
  console.log(exported.export.content);

  section('DONE');
  console.log(`"${TITLE}" has moved through DNA learning, hook refinement,`);
  console.log('verse agent passes, Revision Mode pick+rerun, instrumental');
  console.log('tagging, session save, and export — the full first-song loop.');
}

run().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
