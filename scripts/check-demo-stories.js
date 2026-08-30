#!/usr/bin/env node
/**
 * Static checker for tests/e2e/demo/*.spec.js story files (demo/*.json).
 *
 * Walks each story's steps (goto/click/waitFor/fill) and verifies, without a
 * browser, that:
 *   - goto targets exist on disk
 *   - click/waitFor/fill selectors exist in the current page's HTML
 *   - click targets that navigate (via href, onclick, or a resolvable
 *     location.href assignment) point at a file that exists
 *
 * IMPORTANT — known limitations (do not trust a "FLAGGED" result blindly):
 *
 * 1. Dynamic DOM: many selectors only exist after JS runs (classList.add,
 *    innerHTML template injection, `${var}`-interpolated ids/attrs like
 *    `id="slaDot-${k}"`). This checker only sees the HTML as shipped, so
 *    these will always show as NOT FOUND even when the real app is correct.
 *    Grep the relevant .js/.html for the id/class to confirm before treating
 *    a flag as a real bug.
 *
 * 2. Nav-tracing gaps: this checker only resolves navigation through plain
 *    onclick="location.href='...'" patterns (including a short lookahead
 *    into the handler function body, and one level of `const X = '...'`
 *    variable resolution). It CANNOT resolve navigation through:
 *      - addEventListener-bound handlers
 *      - custom helper functions like nav('foo.html') that aren't a direct
 *        location.href assignment
 *      - location.href assignments buried past the ~4000-char lookahead
 *    When it can't trace a click's destination, it stays on the current
 *    page, and a later `waitFor` may then fall back to a same-directory
 *    "sibling" search — which can land on the WRONG page if multiple pages
 *    share a class name (e.g. `.sec-hdr`, `.tn-link.active`). A "clean"
 *    result driven by a sibling-fallback note is worth double-checking by
 *    hand; a "flagged" result caused by one is usually a false positive.
 *
 * This tool is a fast pre-check to catch genuinely dead selectors/paths
 * before a live Playwright run — it is NOT a substitute for one. Real
 * verification still requires running the actual *-demo.spec.js files
 * against a live server (see tests/e2e/demo/).
 *
 * Usage: node scripts/check-demo-stories.js
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const demoDir = path.join(REPO, 'demo');

function resolveGoto(gotoPath) {
  const clean = gotoPath.replace(/^\//, '');
  const attempts = [
    path.join(REPO, 'html', clean), // most goto paths omit the /html prefix
    path.join(REPO, clean),         // some already include it
  ];
  for (const a of attempts) if (fs.existsSync(a)) return a;
  return attempts[1];
}

function splitCompoundSelector(selector) {
  const attrRe = /\[([\w-]+)=["']([^"']*)["']\]/g;
  const attrs = [];
  let m;
  while ((m = attrRe.exec(selector))) attrs.push({ attr: m[1], val: m[2] });
  const withoutAttrs = selector.replace(attrRe, '');
  const idMatch = withoutAttrs.match(/#([\w-]+)/);
  const classMatches = [...withoutAttrs.matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
  return { id: idMatch ? idMatch[1] : null, classes: classMatches, attrs };
}

function selectorExistsInHtml(html, selector) {
  const { id, classes, attrs } = splitCompoundSelector(selector);
  if (!id && !classes.length && !attrs.length) return false; // unparseable, don't false-negative
  const tagRe = /<[a-zA-Z][\w-]*\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (id && !new RegExp(`id=["']${id}["']`).test(tag)) continue;
    let ok = true;
    for (const c of classes) {
      if (!new RegExp(`class=["'][^"']*\\b${c}\\b[^"']*["']`).test(tag)) { ok = false; break; }
    }
    if (!ok) continue;
    for (const a of attrs) {
      const re = new RegExp(`${a.attr}=["']${a.val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
      if (!re.test(tag)) { ok = false; break; }
    }
    if (!ok) continue;
    return true;
  }
  return false;
}

function findElementTag(html, selector) {
  const { id, classes, attrs } = splitCompoundSelector(selector);
  const tagRe = /<[a-zA-Z][\w-]*\b[^>]*>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    if (id && !new RegExp(`id=["']${id}["']`).test(tag)) continue;
    let ok = true;
    for (const c of classes) if (!new RegExp(`class=["'][^"']*\\b${c}\\b[^"']*["']`).test(tag)) { ok = false; break; }
    if (!ok) continue;
    for (const a of attrs) {
      const re = new RegExp(`${a.attr}=["']${a.val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
      if (!re.test(tag)) { ok = false; break; }
    }
    if (!ok) continue;
    return tag;
  }
  return null;
}

function resolveVarLiteral(html, varName) {
  const m = html.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*['"]([^'"]+)['"]`));
  return m ? m[1] : null;
}

function findNavTargetForSelector(html, selector) {
  const tag = findElementTag(html, selector);
  if (!tag) return null;
  const hrefM = tag.match(/href=["']([^"']+)["']/);
  if (hrefM && hrefM[1].endsWith('.html')) return hrefM[1];
  const onclickM = tag.match(/onclick=["']([^"']+)["']/);
  if (!onclickM) return null;
  const fnNameMatch = onclickM[1].match(/^([A-Za-z0-9_]+)\s*\(/);
  if (!fnNameMatch) {
    const inlineM = onclickM[1].match(/(?:location\.href|window\.location|location\.assign)\s*=?\(?\s*['"]([\w\-.\/]+\.html)['"]/);
    return inlineM ? inlineM[1] : null;
  }
  const fnName = fnNameMatch[1];
  const defIdx = html.search(new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{`));
  if (defIdx === -1) return null;
  const body = html.slice(defIdx, defIdx + 4000); // lookahead limit -- see known limitations
  const navMatch =
    body.match(/(?:location\.href|window\.location(?:\.href)?)\s*=\s*['"]([\w\-.\/]+\.html)['"]/) ||
    body.match(/location\.assign\(\s*['"]([\w\-.\/]+\.html)['"]/);
  if (navMatch) return navMatch[1];
  const varNavMatch = body.match(/(?:location\.href|window\.location(?:\.href)?)\s*=\s*([A-Za-z0-9_]+)\s*;/);
  if (varNavMatch) {
    const varVal = resolveVarLiteral(html, varNavMatch[1]);
    if (varVal && varVal.endsWith('.html')) return varVal;
  }
  return null;
}

function checkStory(storyPath) {
  const story = JSON.parse(fs.readFileSync(storyPath, 'utf8'));
  const results = { story: path.basename(storyPath), issues: [], pagesVisited: [], notes: [] };
  let currentFile = null;
  let currentHtml = null;

  for (const step of story.steps || []) {
    // A single step object commonly carries goto + click + waitFor (+ fill,
    // etc) together -- this mirrors demo/demo-engine.js's runStory(), which
    // processes every field present on a step unconditionally. Each field
    // below is handled independently (no early continue) so combined steps
    // get fully checked.

    if (step.goto) {
      currentFile = resolveGoto(step.goto);
      if (!fs.existsSync(currentFile)) {
        results.issues.push(`GOTO target missing on disk (tried html/-prefixed and literal): ${step.goto}`);
        currentHtml = '';
      } else {
        currentHtml = fs.readFileSync(currentFile, 'utf8');
        results.pagesVisited.push(step.goto);
      }
    }

    if (step.fill) {
      if (currentHtml === null) {
        results.issues.push(`fill before any goto: ${JSON.stringify(Object.keys(step.fill))}`);
      } else {
        for (const sel of Object.keys(step.fill)) {
          if (!selectorExistsInHtml(currentHtml, sel)) {
            results.issues.push(`fill target NOT FOUND on ${path.relative(REPO, currentFile)}: "${sel}"`);
          }
        }
      }
    }

    if (step.click) {
      if (currentHtml === null) {
        results.issues.push(`click "${step.click}" before any goto`);
      } else if (!selectorExistsInHtml(currentHtml, step.click)) {
        results.issues.push(`click selector NOT FOUND on ${currentFile ? path.relative(REPO, currentFile) : '?'}: "${step.click}"`);
      } else {
        const navTarget = findNavTargetForSelector(currentHtml, step.click);
        if (navTarget) {
          const resolved = navTarget.startsWith('/')
            ? resolveGoto(navTarget)
            : path.join(path.dirname(currentFile), navTarget);
          if (fs.existsSync(resolved)) {
            currentFile = resolved;
            currentHtml = fs.readFileSync(currentFile, 'utf8');
            results.pagesVisited.push(path.relative(REPO, resolved));
            results.notes.push(`click "${step.click}" navigates -> ${path.relative(REPO, resolved)}`);
          } else {
            results.issues.push(`click "${step.click}" appears to navigate to missing file: ${navTarget} (resolved ${resolved})`);
          }
        }
      }
    }

    if (step.waitFor) {
      if (currentHtml !== null && !selectorExistsInHtml(currentHtml, step.waitFor)) {
        const dir = path.dirname(currentFile);
        let foundSibling = null;
        try {
          for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith('.html')) continue;
            const full = path.join(dir, f);
            if (full === currentFile) continue;
            const html = fs.readFileSync(full, 'utf8');
            if (selectorExistsInHtml(html, step.waitFor)) { foundSibling = full; break; }
          }
        } catch (e) { /* ignore */ }
        if (foundSibling) {
          results.notes.push(
            `waitFor "${step.waitFor}" NOT on current page (${path.relative(REPO, currentFile)}) but found on sibling ` +
            `${path.relative(REPO, foundSibling)} -- possible untracked navigation or checker gap -- advancing`
          );
          currentFile = foundSibling;
          currentHtml = fs.readFileSync(foundSibling, 'utf8');
          results.pagesVisited.push(path.relative(REPO, foundSibling));
        } else {
          results.issues.push(`waitFor selector NOT FOUND anywhere near ${currentFile ? path.relative(REPO, currentFile) : '?'}: "${step.waitFor}"`);
        }
      }
    }
  }
  return results;
}

function main() {
  const storyFiles = fs.readdirSync(demoDir).filter((f) => f.endsWith('.json'));
  const allResults = storyFiles.map((sf) => {
    try {
      return checkStory(path.join(demoDir, sf));
    } catch (e) {
      return { story: sf, issues: [`PARSE/RUNTIME ERROR: ${e.message}`], pagesVisited: [], notes: [] };
    }
  });

  for (const r of allResults) {
    const status = r.issues.length ? 'FLAGGED' : 'CLEAN';
    console.log(`\n=== ${r.story} [${status}] ===`);
    console.log('pages:', r.pagesVisited.join(' -> '));
    r.notes.forEach((n) => console.log('  note:', n));
    r.issues.forEach((i) => console.log('  ISSUE:', i));
  }

  const flaggedCount = allResults.filter((r) => r.issues.length).length;
  console.log(`\n\nSUMMARY: ${allResults.length} stories checked, ${flaggedCount} flagged, ${allResults.length - flaggedCount} clean`);
  console.log('NOTE: "FLAGGED" here means "needs a human/browser to confirm" -- see the');
  console.log('known-limitations comment at the top of this file before treating any');
  console.log('flag as a confirmed bug.');
}

main();
