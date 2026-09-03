// Integration test for /api/music/* endpoints.
// Verifies each endpoint accepts the field name it actually reads server-side.
// Run: node test-music-endpoints.js [base_url]
// Exits non-zero on any failure, so it's CI-friendly.

const BASE = process.argv[2] || 'https://app.tsmatter.com';

const cases = [
  {
    name: 'agent-pass (reads body.request, body.draft/lyrics, body.agent)',
    path: '/api/music/agent-pass',
    body: { request: 'Generate a one-line test hook about resilience' },
    check: (data) => data.ok === true && typeof data.output === 'string' && data.output.length > 0,
  },
  {
    name: 'strategy (reads body.query)',
    path: '/api/music/strategy',
    body: { query: 'Give a one-sentence test release strategy' },
    check: (data) => data.ok === true && typeof data.output === 'string' && data.output.length > 0,
  },
  {
    name: 'coach (reads body.query || body.message)',
    path: '/api/music/coach',
    body: { query: 'One sentence of test coaching advice' },
    check: (data) => data.ok === true && typeof data.output === 'string' && data.output.length > 0,
  },
  {
    name: 'guidance (reads body.query)',
    path: '/api/music/guidance',
    body: { query: 'One sentence of test industry guidance' },
    check: (data) => data.ok === true && typeof data.output === 'string' && data.output.length > 0,
  },
];

async function run() {
  let failures = 0;

  for (const c of cases) {
    process.stdout.write(`Testing ${c.name} ... `);
    try {
      const res = await fetch(BASE + c.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c.body),
      });
      const data = await res.json();
      if (c.check(data)) {
        console.log('PASS');
      } else {
        console.log('FAIL');
        console.log('  Response:', JSON.stringify(data).slice(0, 300));
        failures++;
      }
    } catch (e) {
      console.log('FAIL (request error)');
      console.log('  Error:', e.message);
      failures++;
    }
  }

  failures += await runInstrumentalsTests();

  console.log(`\n${cases.length + instrumentalsTestCount} total, ${cases.length + instrumentalsTestCount - failures} passed`);
  if (failures > 0) process.exit(1);
}

// ── BEAT WORKBENCH — instrumental file storage endpoints ──────────────────
// Exercises the real upload -> list -> tag -> stream -> delete lifecycle
// against a live server (routes/music.js -> tsm-music-instrumentals-service.js).
// Self-cleaning: deletes the file it creates even on failure, so it's safe
// to run repeatedly against a shared/prod BASE without leaking test data.
let instrumentalsTestCount = 0;

function ok(cond, label, results) {
  instrumentalsTestCount++;
  process.stdout.write(`Testing ${label} ... `);
  if (cond) {
    console.log('PASS');
  } else {
    console.log('FAIL');
    results.failed = true;
  }
  return cond;
}

async function runInstrumentalsTests() {
  const results = { failed: false };

  // Minimal-but-real WAV: 44-byte canonical header + a little silent PCM
  // data, so it round-trips through the chunking/encryption path with a
  // byte-exact comparison, not just a header sniff.
  const pcmBytes = 2000;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(44100, 24);
  header.writeUInt32LE(88200, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes, 40);
  const original = Buffer.concat([header, Buffer.alloc(pcmBytes)]);

  let fileId = null;

  try {
    // upload
    const form = new FormData();
    form.append('file', new Blob([original], { type: 'audio/wav' }), 'ci-test-tone.wav');
    const uploadRes = await fetch(BASE + '/api/music/instrumentals/upload', { method: 'POST', body: form });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!ok(uploadRes.ok && uploadData.ok === true && uploadData.file && uploadData.file._id,
      'instrumentals/upload (real multipart file)', results)) {
      console.log('  Response:', JSON.stringify(uploadData).slice(0, 300));
      return results.failed ? 1 : 0;
    }
    fileId = uploadData.file._id;
    ok(uploadData.file.sizeBytes === original.length, 'upload records correct sizeBytes', results);

    // list
    const listRes = await fetch(BASE + '/api/music/instrumentals/list');
    const listData = await listRes.json().catch(() => ({}));
    ok(listRes.ok && listData.ok === true && Array.isArray(listData.files) &&
      listData.files.some((f) => String(f._id) === String(fileId)),
      'instrumentals/list includes uploaded file', results);

    // tag
    const tagRes = await fetch(BASE + `/api/music/instrumentals/${fileId}/tag`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genre: 'CI-Test', bpm: '120' }),
    });
    const tagData = await tagRes.json().catch(() => ({}));
    ok(tagRes.ok && tagData.ok === true && tagData.file && tagData.file.tags &&
      tagData.file.tags.genre === 'CI-Test', 'instrumentals/tag persists genre', results);

    // stream — byte-exact round trip through chunking + at-rest encryption
    const streamRes = await fetch(BASE + `/api/music/instrumentals/${fileId}/stream`);
    const streamed = Buffer.from(await streamRes.arrayBuffer().catch(() => new ArrayBuffer(0)));
    ok(streamRes.ok && streamed.length === original.length && streamed.equals(original),
      'instrumentals/stream returns byte-exact original file', results);

    // delete
    const delRes = await fetch(BASE + `/api/music/instrumentals/${fileId}`, { method: 'DELETE' });
    const delData = await delRes.json().catch(() => ({}));
    ok(delRes.ok && delData.ok === true, 'instrumentals/delete succeeds', results);
    fileId = null; // cleaned up, no need for the finally-block safety net below

    // confirm gone
    const afterRes = await fetch(BASE + `/api/music/instrumentals/${fileId || uploadData.file._id}/stream`);
    ok(afterRes.status === 404, 'instrumentals/stream 404s after delete', results);
  } catch (e) {
    instrumentalsTestCount++;
    console.log('FAIL (request error): ' + e.message);
    results.failed = true;
  } finally {
    // Safety net: if any assertion above threw before we reached the
    // delete step, don't leave the test file behind in the DB.
    if (fileId) {
      await fetch(BASE + `/api/music/instrumentals/${fileId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  return results.failed ? 1 : 0;
}

run();

