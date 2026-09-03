/**
 * tsm-music-guidance.js
 * TSM Sweet Music™ OS — Guidance Layer
 *
 * Three things, all self-contained (no markup changes needed on the
 * pages that include this):
 *
 *  1. Floating glossary (🎓): ~22 jargon terms a first-time artist/
 *     producer would hit across this vertical, with plain-English
 *     definitions. Searchable panel, bottom-left so it doesn't collide
 *     with the Producer AI bubble (bottom-right).
 *
 *  2. Guided Flow toggle (🧭): walks the 10-page Idea→Analytics
 *     pipeline in order, with real cross-page navigation (actual
 *     <a href> to the next/prev page's real URL) and progress
 *     checkmarks persisted in localStorage so progress survives
 *     across page loads/sessions.
 *
 *  3. Inline explainers: on pages known to be jargon-heavy (Song
 *     Builder, the 4 producer coaches), the first occurrence of each
 *     glossary term found in the page's visible text gets a dotted
 *     underline + hover/tap tooltip with its definition — pulled from
 *     the same glossary data, not a separate hand-maintained list.
 *
 * Usage: <script src="/music/shared/tsm-music-guidance.js"></script>
 * (absolute path — works the same regardless of page depth, since
 * html/war-rooms/music-war/ is served at /music per server.js)
 */

(function () {
  if (typeof window === 'undefined') return;

  // ── Glossary data (~22 terms) ──────────────────────────────────
  const GLOSSARY = [
    { term: 'Ad-libs', def: 'Short vocal interjections layered around the main lyric ("yeah", "let\'s go") that add energy and fill space without being part of the core hook/verse.' },
    { term: 'Cadence', def: 'The rhythmic pattern and timing of how lyrics are delivered over a beat — where the stresses and pauses land relative to the beat.' },
    { term: 'Syllable pocket', def: 'The number of syllables that comfortably fits a given bar/beat without feeling rushed or dragging — different beats have different pockets.' },
    { term: 'EQ', def: 'Equalization — boosting or cutting specific frequency ranges in a sound to fix muddiness, harshness, or make room for other elements in a mix.' },
    { term: 'LUFS', def: 'Loudness Units Full Scale — the industry-standard measurement for a track\'s overall perceived loudness, used to hit streaming platform loudness targets.' },
    { term: 'BPM', def: 'Beats Per Minute — the tempo of a track. Higher BPM generally feels more energetic/uptempo, lower BPM feels slower/more laid-back.' },
    { term: 'Hook', def: 'The most memorable, repeated part of a song (often the chorus or a catchy line) designed to stick in the listener\'s head.' },
    { term: 'Bridge', def: 'A contrasting section, usually appearing once, that breaks up the verse/hook pattern before returning to the final hook.' },
    { term: 'Mixdown', def: 'The process of blending all individual recorded/programmed tracks (vocals, drums, bass, etc.) into a single balanced stereo file.' },
    { term: 'Mastering', def: 'The final polish pass applied to a finished mix — loudness, tonal balance, and consistency — to make it release-ready across platforms.' },
    { term: 'Compression', def: 'An effect that reduces the volume difference between the loudest and quietest parts of a sound, making levels more consistent.' },
    { term: 'Reverb', def: 'An effect that simulates the natural reflections of a sound in a physical space, adding depth or a sense of room.' },
    { term: 'Delay', def: 'An effect that repeats a sound after a set time gap, often used rhythmically (e.g. "slap" delay) to add texture without full reverb.' },
    { term: 'Key', def: 'The musical scale a song is built around (e.g. "F Minor") — matters for which notes/chords will sound in tune together.' },
    { term: 'Pocket', def: 'Playing or delivering exactly in time with the groove of the beat — "in the pocket" means the timing feels locked in, not rushed or dragging.' },
    { term: 'Flow', def: 'How an artist\'s cadence, rhythm, and phrasing move over a beat as a whole — a distinct, personal delivery style.' },
    { term: 'Bar', def: 'A single musical measure — the basic unit songs and verses are counted/structured in (e.g. "a 16-bar verse").' },
    { term: '808', def: 'A deep, sustained sub-bass drum sound (named after the Roland TR-808 drum machine) that is a foundation of trap/hip-hop production.' },
    { term: 'Stem', def: 'An individual grouped audio track (e.g. "drums stem", "vocal stem") exported separately from the full mix, used for remixing or handing off to another engineer.' },
    { term: 'DAW', def: 'Digital Audio Workstation — the software used to record, edit, arrange, and mix music (e.g. FL Studio, Ableton, Pro Tools).' },
    { term: 'Split sheet', def: 'A document listing everyone who contributed to a song and their agreed percentage ownership/royalty split — settled before release to avoid disputes.' },
    { term: 'Sync licensing', def: 'Licensing a song for use alongside visual media (TV, film, ads, games) — a revenue stream separate from streaming/sales royalties.' },
  ];

  // ── Guided Flow: the 10-page Idea→Analytics pipeline ───────────
  const FLOW = [
    { id: 'cadence', label: 'Idea / Lyrics', url: '/music/cadence-builder.html' },
    { id: 'song-builder', label: 'Song Structure', url: '/music/creation/song-builder.html' },
    { id: 'beat-workbench', label: 'Beat', url: '/music/creation/beat-workbench.html' },
    { id: 'producer-ai', label: 'Producer Direction', url: '/music/producer/producer-ai.html' },
    { id: 'recording-coach', label: 'Recording', url: '/music/producer/recording-coach.html' },
    { id: 'mixing-coach', label: 'Mixing', url: '/music/producer/mixing-coach.html' },
    { id: 'mastering-coach', label: 'Mastering', url: '/music/producer/mastering-coach.html' },
    { id: 'release-center', label: 'Release', url: '/music/release/release-center.html' },
    { id: 'marketing', label: 'Marketing', url: '/music/release/marketing.html' },
    { id: 'analytics', label: 'Analytics', url: '/music/analytics.html' },
  ];

  // Pages that get auto inline-explainer scanning (jargon-heavy pages
  // named explicitly in scope: Song Builder + the 4 producer coaches).
  const INLINE_EXPLAINER_PAGES = [
    '/music/creation/song-builder.html',
    '/music/producer/mixing-coach.html',
    '/music/producer/mastering-coach.html',
    '/music/producer/recording-coach.html',
    '/music/producer/producer-ai.html',
  ];

  const PROGRESS_KEY = 'smos_guided_flow_progress';
  const ENABLED_KEY = 'smos_guided_flow_enabled';

  function getProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }
  function setProgress(arr) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(arr));
  }
  function isEnabled() {
    return localStorage.getItem(ENABLED_KEY) === '1';
  }
  function setEnabled(v) {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
  }

  function currentFlowIndex() {
    const path = window.location.pathname;
    return FLOW.findIndex((step) => path.endsWith(step.url.replace(/^\/music/, '')) || path === step.url);
  }

  function boot() {
    injectStyles();
    injectGlossary();
    injectGuidedFlow();
    if (INLINE_EXPLAINER_PAGES.some((p) => window.location.pathname === p || window.location.pathname.endsWith(p.replace(/^\/music/, '')))) {
      injectInlineExplainers();
    }
  }

  // ── Styles ──────────────────────────────────────────────────────
  function injectStyles() {
    const css = `
      #tmg-gloss-bubble{position:fixed;bottom:22px;left:22px;width:54px;height:54px;border-radius:50%;
        background:var(--cyan,#00e5ff);color:#000;display:flex;align-items:center;justify-content:center;
        font-size:1.3rem;cursor:pointer;z-index:9999;box-shadow:0 4px 18px rgba(0,229,255,0.4);
        border:none;transition:transform 0.15s ease;font-family:'IBM Plex Mono',monospace;}
      #tmg-gloss-bubble:hover{transform:scale(1.07);}

      #tmg-gloss-panel{position:fixed;bottom:88px;left:22px;width:320px;max-height:60vh;overflow-y:auto;
        background:var(--card,#13131f);border:1px solid rgba(0,229,255,0.35);border-radius:10px;
        padding:16px;z-index:9998;font-family:'IBM Plex Mono',monospace;font-size:0.7rem;
        color:var(--text,#e0e0e0);box-shadow:0 8px 24px rgba(0,0,0,0.5);display:none;}
      #tmg-gloss-panel.show{display:block;}
      #tmg-gloss-panel h3{font-family:'Orbitron',sans-serif;font-size:0.65rem;color:var(--cyan,#00e5ff);
        letter-spacing:0.1em;margin-bottom:10px;}
      #tmg-gloss-search{width:100%;background:var(--bg,#0a0a0c);border:1px solid var(--border,#1e1e2e);
        border-radius:6px;padding:6px 10px;color:var(--text,#e0e0e0);font-family:inherit;font-size:0.68rem;
        margin-bottom:10px;outline:none;}
      #tmg-gloss-list dt{color:var(--cyan,#00e5ff);font-weight:700;margin-top:8px;}
      #tmg-gloss-list dd{color:var(--muted,#666680);margin:2px 0 0 0;line-height:1.5;}

      #tmg-flow-bar{position:sticky;top:0;z-index:500;background:var(--card,#13131f);
        border-bottom:1px solid var(--border,#1e1e2e);padding:8px 16px;display:flex;align-items:center;
        gap:12px;font-family:'IBM Plex Mono',monospace;font-size:0.65rem;color:var(--text,#e0e0e0);
        flex-wrap:wrap;}
      #tmg-flow-toggle{cursor:pointer;border:1px solid var(--amber,#ffb300);color:var(--amber,#ffb300);
        border-radius:4px;padding:4px 10px;background:transparent;font-family:inherit;font-size:0.62rem;
        letter-spacing:0.05em;}
      #tmg-flow-toggle.on{background:var(--amber,#ffb300);color:#000;}
      #tmg-flow-steps{display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
      .tmg-step{display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;
        border:1px solid var(--border,#1e1e2e);color:var(--muted,#666680);font-size:0.6rem;
        text-decoration:none;white-space:nowrap;}
      .tmg-step.done{border-color:var(--green,#00ff88);color:var(--green,#00ff88);}
      .tmg-step.current{border-color:var(--amber,#ffb300);color:var(--amber,#ffb300);font-weight:700;}
      #tmg-flow-nav{display:flex;gap:8px;margin-left:auto;}
      #tmg-flow-nav a{color:var(--cyan,#00e5ff);text-decoration:none;font-size:0.62rem;}
      #tmg-flow-nav a:hover{text-decoration:underline;}

      .tmg-gloss-term{border-bottom:1px dotted var(--cyan,#00e5ff);cursor:help;position:relative;}
      .tmg-gloss-term:hover .tmg-tooltip,.tmg-gloss-term:focus .tmg-tooltip{display:block;}
      .tmg-tooltip{display:none;position:absolute;bottom:130%;left:0;width:220px;background:var(--card,#13131f);
        border:1px solid var(--cyan,#00e5ff);border-radius:6px;padding:8px 10px;font-size:0.62rem;
        color:var(--text,#e0e0e0);line-height:1.4;z-index:2000;box-shadow:0 4px 14px rgba(0,0,0,0.5);}
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── 1. Floating glossary ────────────────────────────────────────
  function injectGlossary() {
    const bubble = document.createElement('button');
    bubble.id = 'tmg-gloss-bubble';
    bubble.title = 'Music terms glossary';
    bubble.textContent = '🎓';
    document.body.appendChild(bubble);

    const panel = document.createElement('div');
    panel.id = 'tmg-gloss-panel';
    panel.innerHTML = `
      <h3>// MUSIC TERMS GLOSSARY</h3>
      <input id="tmg-gloss-search" placeholder="Search terms...">
      <dl id="tmg-gloss-list"></dl>
    `;
    document.body.appendChild(panel);

    function renderList(filter) {
      const listEl = document.getElementById('tmg-gloss-list');
      const f = (filter || '').toLowerCase();
      const items = GLOSSARY.filter((g) => !f || g.term.toLowerCase().includes(f) || g.def.toLowerCase().includes(f));
      listEl.innerHTML = items.map((g) => `<dt>${g.term}</dt><dd>${g.def}</dd>`).join('') || '<dd>No matching terms.</dd>';
    }
    renderList('');

    bubble.addEventListener('click', () => {
      panel.classList.toggle('show');
    });
    document.getElementById('tmg-gloss-search').addEventListener('input', (e) => renderList(e.target.value));
  }

  // ── 2. Guided Flow toggle + cross-page progress ─────────────────
  function injectGuidedFlow() {
    const idx = currentFlowIndex();
    const bar = document.createElement('div');
    bar.id = 'tmg-flow-bar';

    const toggle = document.createElement('button');
    toggle.id = 'tmg-flow-toggle';
    toggle.textContent = '🧭 Guided Flow';
    if (isEnabled()) toggle.classList.add('on');
    bar.appendChild(toggle);

    const stepsWrap = document.createElement('div');
    stepsWrap.id = 'tmg-flow-steps';
    bar.appendChild(stepsWrap);

    const navWrap = document.createElement('div');
    navWrap.id = 'tmg-flow-nav';
    bar.appendChild(navWrap);

    document.body.insertBefore(bar, document.body.firstChild);

    function render() {
      const enabled = isEnabled();
      stepsWrap.style.display = enabled ? 'flex' : 'none';
      navWrap.style.display = enabled ? 'flex' : 'none';
      toggle.classList.toggle('on', enabled);
      if (!enabled) return;

      const progress = getProgress();
      stepsWrap.innerHTML = FLOW.map((step, i) => {
        const done = progress.includes(step.id);
        const isCurrent = i === idx;
        const cls = ['tmg-step', done ? 'done' : '', isCurrent ? 'current' : ''].filter(Boolean).join(' ');
        return `<a class="${cls}" href="${step.url}">${done ? '✓' : (i + 1)} ${step.label}</a>`;
      }).join('');

      navWrap.innerHTML = '';
      if (idx > 0) {
        const prev = document.createElement('a');
        prev.href = FLOW[idx - 1].url;
        prev.textContent = `← ${FLOW[idx - 1].label}`;
        navWrap.appendChild(prev);
      }
      if (idx >= 0 && idx < FLOW.length - 1) {
        const next = document.createElement('a');
        next.href = FLOW[idx + 1].url;
        next.textContent = `Mark done & continue → ${FLOW[idx + 1].label}`;
        next.addEventListener('click', () => {
          const p = getProgress();
          if (!p.includes(FLOW[idx].id)) {
            p.push(FLOW[idx].id);
            setProgress(p);
          }
        });
        navWrap.appendChild(next);
      } else if (idx === FLOW.length - 1) {
        const done = document.createElement('span');
        done.textContent = '🎉 Final step';
        navWrap.appendChild(done);
      }
    }

    toggle.addEventListener('click', () => {
      setEnabled(!isEnabled());
      render();
    });

    render();
  }

  // ── 3. Inline explainers (auto-detected, jargon-heavy pages only) ─
  function injectInlineExplainers() {
    // Sort longest-term-first so "syllable pocket" matches before the
    // standalone "pocket" entry would swallow part of it.
    const terms = GLOSSARY.slice().sort((a, b) => b.term.length - a.term.length);
    const seen = new Set();

    // Scan text nodes inside the main content area only (avoid header/
    // nav/scripts/the glossary panel itself/the flow bar).
    const root = document.querySelector('.main') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parentTag = node.parentElement && node.parentElement.tagName;
        if (['SCRIPT', 'STYLE', 'INPUT', 'TEXTAREA'].includes(parentTag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement && node.parentElement.closest('#tmg-gloss-panel, #tmg-flow-bar')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodesToProcess = [];
    let n;
    while ((n = walker.nextNode())) nodesToProcess.push(n);

    nodesToProcess.forEach((node) => {
      let text = node.nodeValue;
      let matched = null;
      let matchIndex = -1;

      for (const g of terms) {
        if (seen.has(g.term)) continue;
        const re = new RegExp(`\\b${g.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        const m = re.exec(text);
        if (m) {
          matched = g;
          matchIndex = m.index;
          break;
        }
      }
      if (!matched) return;

      seen.add(matched.term);
      const before = text.slice(0, matchIndex);
      const matchedText = text.slice(matchIndex, matchIndex + matched.term.length);
      const after = text.slice(matchIndex + matched.term.length);

      const span = document.createElement('span');
      span.className = 'tmg-gloss-term';
      span.tabIndex = 0;
      span.textContent = matchedText;
      const tooltip = document.createElement('span');
      tooltip.className = 'tmg-tooltip';
      tooltip.textContent = matched.def;
      span.appendChild(tooltip);

      const frag = document.createDocumentFragment();
      if (before) frag.appendChild(document.createTextNode(before));
      frag.appendChild(span);
      if (after) frag.appendChild(document.createTextNode(after));

      node.parentNode.replaceChild(frag, node);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
