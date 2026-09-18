// tests/e2e/legal-bnca-simulation-disclosure.spec.js
//
// Confirms html/legal-pro/case-strategist.html's runBNCA() visibly discloses
// when its output is simulated (generateMockBNCA fallback) rather than a
// real Groq analysis.
//
// Background: runBNCA() originally called /api/groq, which was never
// mounted in server.js (groq-route.js defined it but was never require()'d,
// and it had zero auth). This meant runBNCA() fell into its catch block on
// every single run, not as a rare degrade path. Before the disclosure fix,
// finalizeBNCA(text) had no way to distinguish mock output from real
// output, so a fabricated report was presented identically to a real one,
// badged "GROQ LLAMA-3.3-70B" with a randomized 88-95% confidence score.
//
// API_ENDPOINT now points at the existing, already-authenticated
// /api/legal/query route (requireAnyAuth-gated) instead of the unmounted
// /api/groq. This test covers both: (1) the disclosure gap — whenever the
// real call fails for any reason, the user-visible output is marked
// simulated — and (2) that the real path parses /api/legal/query's actual
// response shape ({ok, answer}), not the old raw-Groq {choices:[...]}
// shape the page never receives.
//
// Uses jsdom to load and execute the actual page script (not a source grep)
// so this fails honestly if the real DOM wiring breaks.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PAGE_PATH = path.join(__dirname, '..', '..', 'html', 'legal-pro', 'case-strategist.html');

async function loadPage({ mockFetchFails }) {
  const html = fs.readFileSync(PAGE_PATH, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost/legal-pro/case-strategist.html',
  });

  const { window } = dom;

  // Stub browser APIs jsdom doesn't implement that the page may touch.
  window.scrollTo = () => {};
  window.localStorage.setItem = window.localStorage.setItem || (() => {});
  window.sessionStorage.setItem = window.sessionStorage.setItem || (() => {});

  // Fake TSM_KERNEL so unrelated calls (e.g. tsmWriteRelay, if ever wired)
  // don't throw and derail the test — this page's global runtime shim.
  window.TSM_KERNEL = window.TSM_KERNEL || { setRelay: () => {}, getRelay: () => null };

  // Mock fetch: simulate /api/legal/query failing (network error, 401 from
  // requireAnyAuth, or a 500 from the Groq call itself all hit the same
  // catch block in runBNCA) or, for the control case, a real success
  // response in the route's actual shape ({ok, answer}), not raw Groq's
  // {choices:[...]} — the page never sees that shape directly.
  window.fetch = async (url, opts) => {
    if (mockFetchFails) {
      return { ok: false, status: 401, json: async () => ({ ok: false, error: 'Unauthorized' }) };
    }
    return {
      ok: true,
      json: async () => ({
        ok: true,
        answer: 'CONFIDENCE: 91%\nRISK LEVEL: HIGH\nSLA PRESSURE: Critical\n(real content)',
        createdAt: new Date().toISOString(),
      }),
    };
  };

  // Let inline scripts finish executing.
  await new Promise((resolve) => {
    if (window.document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  return { window, document: window.document };
}

async function run() {
  let passed = 0;
  const check = (label, cond) => {
    if (cond) { console.log('OK:', label); passed++; }
    else { console.error('FAIL:', label); process.exitCode = 1; }
  };

  // --- Degraded path: /api/groq fails (current real-world state) ---
  {
    const { window, document } = await loadPage({ mockFetchFails: true });

    // Fill minimal required inputs so runBNCA doesn't bail early.
    document.getElementById('matter-name').value = 'Test Matter';

    await window.runBNCA();
    // streamText renders character-by-character on a timer; give it room.
    await new Promise((r) => setTimeout(r, 500));

    const simBadge = document.getElementById('sim-badge');
    check('sim-badge exists in the DOM', !!simBadge);
    check('sim-badge is visible when output is simulated (fetch failed)',
      simBadge && simBadge.style.display !== 'none');
    check('rendered output is the mock report, not the "(real content)" marker',
      document.getElementById('bnca-output').textContent.includes('LEGAL MAIN STRATEGIST BNCA REPORT') &&
      !document.getElementById('bnca-output').textContent.includes('(real content)'));

    window.close();
  }

  // --- Real path: /api/groq succeeds ---
  {
    const { window, document } = await loadPage({ mockFetchFails: false });
    document.getElementById('matter-name').value = 'Test Matter';

    await window.runBNCA();
    await new Promise((r) => setTimeout(r, 200));

    const simBadge = document.getElementById('sim-badge');
    check('sim-badge is hidden when output is real (fetch succeeded)',
      simBadge && simBadge.style.display === 'none');
    check('real output text is rendered, not the mock generator\'s output',
      document.getElementById('bnca-output').textContent.includes('(real content)'));

    window.close();
  }

  // --- Canary: confirms /api/legal/query is genuinely mounted and
  // requireAnyAuth-gated against a live server, i.e. the fetch mocks above
  // reflect real current production behavior, not a hypothetical. An
  // unauthenticated call should get 401 from requireAnyAuth (route exists,
  // auth enforced) — not 404 (route missing) and not 200 (auth bypassed).
  // If this ever starts returning 404, API_ENDPOINT has drifted from the
  // real route again and this test's mocks need re-checking.
  {
    const base = process.env.TSM_BASE_URL || 'http://localhost:3000';
    try {
      const res = await fetch(base + '/api/legal/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x' }),
      });
      check('CANARY: /api/legal/query is mounted and auth-gated (401 unauthenticated, not 404/200)',
        res.status === 401);
    } catch (e) {
      console.log('SKIPPED canary check (no server reachable at', base, ') — run with a live server to include it.');
    }
  }

  console.log(`\n${passed} checks passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED — see above.');
}

run().catch(err => { console.error(err); process.exit(1); });
