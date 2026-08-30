# Demo Story Audit — 2026-08-30

Static, no-browser check of all 23 `demo/*.json` story files (used by
`tests/e2e/demo/*.spec.js`) against the real HTML/JS on disk. Run via
`scripts/check-demo-stories.js`.

**Result: 23/23 stories check out — no dead selectors, no broken navigation
paths, no missing goto targets found.**

## Why this matters

The checker started at 20/23 flagged. Almost all of that was the checker's
own limitations, not app bugs — each flag was hand-verified against the real
source before being cleared. Two rounds of bugs in the checker itself were
found and fixed along the way:

1. **Attribute/compound selectors** (`button[onclick="..."]`, `.abtn.approve`)
   weren't parsed at all in the first pass — fixed by adding real selector
   parsing instead of naive id/class regex.
2. **Combined `click`+`waitFor` on a single step object** — the story JSON
   commonly puts both fields on one step (matching how `demo-engine.js`'s
   `runStory()` actually processes steps). The first fixed version of the
   checker used `continue` after each field, which silently skipped `waitFor`
   whenever it shared a step with `click`. This masked real gaps in what was
   being checked across nearly every story. Fixed by processing all fields
   on a step unconditionally.

After both fixes, every remaining flag was hand-verified by grepping the
actual target file. All 15 fell into two categories:

### A. Dynamic DOM (selector only exists after JS runs)
The checker only sees shipped HTML. These selectors are added via
`classList.add()`, `innerHTML` template injection, or `${var}`-interpolated
ids/attrs (e.g. `id="slaDot-${k}"`), so they're invisible to a static check
even though they're correct at runtime.

- `career-training-demo` — `#panel-X.active` set by `switchTo()`
- `construction-demo` / `-cashflow` / `-finance` / `-je` — `#vp-expansion.active` set via `classList.add`
- `finops-demo` — `#escalateBar.visible` toggled via `classList`
- `music-demo` — `.lyric-row` rows appended via JS, not static
- `noc-demo` (partial) — `#kpiGrid .kpi-card` rendered client-side
- `pm-copilot-demo` — `#pane-iot .row-item` rendered client-side
- `rcm-os-demo` — `.cadence-btn[data-k="..."]` / `#slaDot-*` built from a template literal with `${k}` interpolation
- `rcm-os-simulation-demo` — `#status.good` / `#status.bad` set via `status.className = ...`
- `schools-demo` — `#wrap .kpi-row` populated via `innerHTML` on load

### B. Nav-tracing gaps (checker followed the wrong page, not a real bug)
The checker only resolves navigation through direct
`onclick="location.href=...'"` patterns. When a page uses something else, the
checker stays put and a later `waitFor` can fall back to a same-directory
"sibling" search — which can land on the wrong page if two pages share a
class (`.sec-hdr`, `.tn-link.active`, `.ai-box`, etc).

- `healthcare-demo` — `escalateToExecPortal()`'s `window.location.href` assignment sits past the checker's lookahead window
- `legal-demo` — `escalateToChief()` navigates via a custom `nav()` helper, not a direct assignment
- `mortgage-demo`, `noc-demo` (remainder) — `#btnRelay` is wired via `addEventListener`, not `onclick`

In every case above, hand-grepping confirmed the selector genuinely exists on
the correct page.

## What this audit does NOT prove

- No live browser was run. This sandbox and the Codespace both hit a 403
  downloading `chrome-headless-shell` from Google's storage CDN, and no
  `GROQ_API_KEY` is present here, so the real 6-engine AI chains were not
  fired.
- A selector existing doesn't mean the JS behind it works correctly — a
  broken handler, a failing `fetch`, or a Groq 500 wouldn't show up here.
- This is a pre-check to catch dead selectors/paths cheaply before spending
  Playwright time — not a replacement for the real `test:e2e` run.

## Next step

Run the actual specs live (Codespaces, real server, real `GROQ_API_KEY`):

```bash
npm run test:e2e -- tests/e2e/demo/
```

or target the 15 that were flagged here first, since those are the ones
worth watching closest for a genuine runtime regression hiding behind the
"dynamic DOM" explanation above.
