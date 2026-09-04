// create-first-song-real.js
// End-to-end walkthrough of the ACTUAL, live "create your first song" flow —
// i.e. exactly what a user's browser does on song-builder.html and
// beat-workbench.html. No vestigial endpoints (agent/run, agent/chain,
// dna/learn, revision/*, hooks/generate10, session/save, export) — those
// exist in routes/music.js but nothing in the shipped UI calls them.
//
// Run: node create-first-song-real.js [base_url]
//   node create-first-song-real.js https://tsm-shell.fly.dev

const BASE = process.argv[2] || 'https://tsm-shell.fly.dev';

// ── Same inputs a user would type into song-builder.html's form ──────────
const context = {
  genre: 'Trap',
  mood: 'Confident / Triumphant',
  inspiration: 'General',
  message: 'From the bottom to the top through grind and self-belief, now on top of the game with no apologies',
  hookIdea: 'Let AI decide',
  bpm: '122',
  key: 'C minor',
  structure: 'Hook - Verse 1 - Bridge - Verse 2 - Outro',
  notes: 'Confident, playful delivery with internal rhymes',
};

// This is the EXACT prompt template from song-builder.html's generateSong(),
// just with the context values above substituted in.
const prompt = `You are a professional songwriter and music producer AI. Write a complete song based on:
Genre: ${context.genre}
Mood: ${context.mood}
Artists for inspiration (not imitation): ${context.inspiration}
Message/Concept: ${context.message}
Hook direction: ${context.hookIdea}
Beat: ${context.bpm} BPM, ${context.key} key
Structure: ${context.structure}
Style notes: ${context.notes}

Return ONLY valid JSON with this exact structure:
{
  "hook": "full hook lyrics, 8 bars, each bar separated by a \\n newline character — do not run bars together with commas",
  "verse1": "full verse 1 lyrics, 16 bars, each bar separated by a \\n newline character — do not run bars together with commas",
  "bridge": "bridge section (4-8 bars)",
  "verse2": "full verse 2 lyrics, 16 bars, each bar separated by a \\n newline character — do not run bars together with commas",
  "outro": "outro lines (4 bars)",
  "producerNotes": "practical producer advice specific to this song",
  "cadenceNotes": "syllable and flow tips for this genre/BPM",
  "commercialScore": "1-10 commercial potential with one-sentence reason"
}`;

function section(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

// LLMs asked for JSON with "\n" inside string values frequently emit an
// actual raw newline character instead of the two-character escape
// sequence -- which is invalid JSON (control characters can't appear
// unescaped inside a JSON string) and makes JSON.parse throw "Unterminated
// string". This walks the text once, tracking whether we're inside a
// string literal (respecting escaped quotes), and escapes raw newlines/
// tabs/carriage-returns only when found inside a string -- structural
// whitespace between keys/braces is left alone.
function sanitizeJsonNewlines(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') { out += ch; inString = true; continue; }
      out += ch;
    }
  }
  return out;
}

function parseModelJson(rawText) {
  const cleanedText = (rawText || '{}').replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleanedText);
  } catch (e) {
    return JSON.parse(sanitizeJsonNewlines(cleanedText));
  }
}

async function run() {
  // ── Step 1: song-builder.html's "Generate" button ───────────────────
  section('STEP 1 — Generate the song (song-builder.html -> /api/music/sweet/ai)');
  const res = await fetch(BASE + '/api/music/sweet/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: 'You are a professional songwriter AI. Respond ONLY with valid JSON, no markdown.',
      prompt,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'sweet/ai backend error');

  let song = parseModelJson(data.text);

  // Defensive: some model responses wrap the object (e.g. {"song": {...}}
  // or {"result": {...}}) despite the prompt asking for the bare object.
  if (!song.hook && !song.verse1) {
    const unwrapped = song.song || song.result || song.data || song.output;
    if (unwrapped && (unwrapped.hook || unwrapped.verse1)) song = unwrapped;
  }

  if (!song.hook && !song.verse1) {
    console.log('\n--- RAW data.text (first 800 chars) ---');
    console.log((data.text || '').slice(0, 800));
    console.log('--- Parsed keys:', Object.keys(song), '---\n');
  }

  console.log('[HOOK]\n' + song.hook);
  console.log('\n[VERSE 1]\n' + song.verse1);
  console.log('\n[BRIDGE]\n' + song.bridge);
  console.log('\n[VERSE 2]\n' + song.verse2);
  console.log('\n[OUTRO]\n' + song.outro);
  console.log('\nProducer notes: ' + song.producerNotes);
  console.log('Cadence notes: ' + song.cadenceNotes);
  console.log('Commercial score: ' + song.commercialScore);

  // At this point the real page just renders this and saves it to
  // localStorage (SMOS.song.save) — there is no server-side save call.

  // ── Step 2: Beat Workbench — upload + tag a real instrumental ───────
  // A real user would drag in an actual audio file here. We use a
  // minimal-but-real WAV so it round-trips through the real chunking/
  // encryption storage path, same as the CI instrumentals test.
  section('STEP 2 — Upload the instrumental (beat-workbench.html -> /api/music/instrumentals/upload)');
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
  form.append('file', new Blob([placeholderWav], { type: 'audio/wav' }), 'first-song-instrumental.wav');
  const uploadRes = await fetch(BASE + '/api/music/instrumentals/upload', { method: 'POST', body: form });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.ok) throw new Error(uploadData.error || 'upload_failed');
  console.log('Uploaded. File id:', uploadData.file._id);
  console.log('Streamable at:', `${BASE}/api/music/instrumentals/${uploadData.file._id}/stream`);

  // ── Step 3: tag it, same fields as the real Beat Workbench form ────
  section('STEP 3 — Tag the instrumental (beat-workbench.html -> /api/music/instrumentals/:id/tag)');
  const tagRes = await fetch(`${BASE}/api/music/instrumentals/${uploadData.file._id}/tag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      genre: context.genre,
      bpm: context.bpm,
      key: context.key,
      mood: context.mood,
      energy: 'High',
    }),
  });
  const tagData = await tagRes.json();
  if (!tagRes.ok || !tagData.ok) throw new Error(tagData.error || 'tag_failed');
  console.log('Tags saved:', JSON.stringify(tagData.file.tags));

  section('DONE');
  console.log('This is the real, complete "first song" flow as shipped:');
  console.log('song-builder.html generates lyrics via one AI call, the user');
  console.log('copies them out (or moves on to Cadence Studio / Recording');
  console.log('Coach), and beat-workbench.html separately stores a real');
  console.log('instrumental file with producer-supplied tags.');
  console.log('\nNothing here was deleted — the instrumental is now a real');
  console.log('file in the production Firestore-backed store. Run:');
  console.log(`  curl -X DELETE ${BASE}/api/music/instrumentals/${uploadData.file._id}`);
  console.log('if you want to remove it.');
}

run().catch(err => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});