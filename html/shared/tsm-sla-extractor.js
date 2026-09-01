/**
 * TSM SLA Extractor v1.0
 * --------------------------------------------------------------------------
 * Deterministic, non-LLM parsing helpers for pulling structured case fields
 * (deadline, required evidence, financial exposure, confidence/tier) out of
 * the free-text engine output already produced by each vertical's strategist
 * page.
 *
 * hc-denial-war-room.html implements this same extraction logic (deadline
 * regex match, evidence bullet-list scan, dollar-range parsing, a
 * confidence-from-score mapping, and confidenceTierFor's HIGH/MEDIUM/LOW
 * cutoffs) inline, once, for Healthcare. Every other vertical that wants the
 * same "structured case" contract (Legal, Insurance, FinOps, RE,
 * Construction, BPO) needs the identical parsing behavior against its own
 * engine text and regexes — this file pulls that logic out into one shared,
 * tested utility instead of re-writing (and re-diverging) it six times.
 *
 * Nothing here is vertical-specific: every function takes the raw text and
 * the vertical's own regex/config as arguments, so each strategist page
 * still owns its own field regexes (they differ per vertical's engine
 * prompts) and just calls into this shared parser.
 *
 * Exposes (all pure functions, no state, safe to call from any page that
 * loads this script):
 *   TSMSLAExtractor.extractDeadline(text, regex) -> string | null
 *     Runs regex against text, returns the trimmed capture group. Returns
 *     null (never a literal "NOT STATED..." string) when the source
 *     document had no real deadline — callers should treat null as
 *     "unknown", not fabricate a date.
 *   TSMSLAExtractor.extractEvidenceList(text, headerRegex) -> string[]
 *     Finds headerRegex in text, collects bullet lines (*, -, •) until the
 *     next numbered section header (e.g. "2. ..."), returns them trimmed.
 *     Stops at the next section so a following section's bullets are never
 *     swept in by mistake.
 *   TSMSLAExtractor.parseDollarAmount(str) -> number | null
 *     Parses one or more dollar figures (supports K/M/B suffixes and
 *     "$500K – $8.4M" ranges) and returns their average, rounded. Returns
 *     null if no parseable dollar figure is present.
 *   TSMSLAExtractor.confidenceFromScore(score, opts?) -> number | null
 *     opts.invert: true for scores where higher = worse (e.g. a risk
 *     score), so confidence = 100 - score. Without opts.invert, confidence
 *     = the score itself (e.g. a win-probability style score already on a
 *     "higher = more confident" scale). Returns null for a non-numeric
 *     score.
 *   TSMSLAExtractor.confidenceTierFor(confidence) -> 'HIGH'|'MEDIUM'|'LOW'|null
 *     >=90 HIGH, >=70 MEDIUM, else LOW — same cutoffs as
 *     hc-denial-war-room.html's confidenceTierFor, kept identical here so a
 *     confidence score means the same thing across every vertical.
 * ==========================================================================
 */
(function (global) {
  'use strict';

  // TSM FIX: this shared extractor never stripped markdown from the raw
  // LLM text before running its field regexes — the exact bug class
  // already found and fixed in Healthcare's own (separately duplicated)
  // extraction code: "**3. Deadline:**" or a deadline/evidence header
  // wrapped in bold breaks a "label[:\s]+value" regex, and an LLM answer
  // formatted as a markdown table row ("| ... |") rides straight through
  // untouched. Because this file is the *shared* extractor for Legal,
  // Insurance, and FinOps (see header comment), the bug was live in three
  // verticals at once here, not one. Deliberately does NOT strip bullet
  // markers (-, *, +) the way Healthcare's stripMd() does — extractEvidenceList
  // below identifies evidence items by matching that exact bullet-marker
  // prefix, so stripping it first would make every evidence list come back
  // empty. Bold/italic/heading/table-pipe noise around a bullet's *content*
  // still gets cleaned; only the marker itself survives, and only until stripped
  // per-line inside extractEvidenceList once it isn't needed anymore.
  function _stripInlineMd(text) {
    if (!text) return text;
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold**
      .replace(/\*(.*?)\*/g, '$1')       // *italic*
      .replace(/__(.*?)__/g, '$1')       // __bold__
      .replace(/_(.*?)_/g, '$1')         // _italic_
      .replace(/`(.*?)`/g, '$1')         // `code`
      .replace(/^#{1,6}\s+/gm, '')       // # headings
      .replace(/^\s*\|?[\s:-]*\|[\s:|-]*\|?\s*$/gm, '') // table separator rows (---|---)
      .replace(/^\s*\|\s*(.*?)\s*\|\s*$/gm, function (_, inner) {
        return inner.split('|').map(function (c) { return c.trim(); }).filter(Boolean).join(' — ');
      });
  }

  // TSM FIX: the table-row stripping above only catches a *full line*
  // formatted as "| ... |" (Healthcare's original bug: an LLM's whole
  // answer was one table row). It doesn't catch a value that's pipe-wrapped
  // mid-line as part of a longer templated line -- e.g. FinOps' "1. Action
  // — $5,000 — Owner — | Jun 30, 2026 |", where only the trailing captured
  // field picked up stray pipes, not the entire line. Trim any leading/
  // trailing "|" (and adjacent whitespace) off a value after it's been
  // captured, as a second, position-independent safety net.
  function _stripWrappingPipes(val) {
    if (!val) return val;
    return val.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim();
  }

  function extractDeadline(text, regex) {
    if (!text || !regex) return null;
    var m = _stripInlineMd(text).match(regex);
    if (!m || !m[1]) return null;
    var val = _stripWrappingPipes(m[1].trim());
    if (!val || /NOT STATED/i.test(val)) return null;
    return val;
  }

  function extractEvidenceList(text, headerRegex) {
    if (!text || !headerRegex) return [];
    var clean = _stripInlineMd(text);
    var idx = clean.search(headerRegex);
    if (idx === -1) return [];
    var afterHeader = clean.slice(idx).replace(headerRegex, '');
    // Stop at the next numbered section header (e.g. "\n2. Appeal Letter
    // Points:") so a following section's bullets never get swept in.
    var nextSection = afterHeader.match(/\n\s*\d+\.\s/);
    var scoped = nextSection ? afterHeader.slice(0, nextSection.index) : afterHeader;
    var items = [];
    scoped.split('\n').forEach(function (line) {
      var m = line.match(/^\s*[*\-\u2022]\s*(.+)/);
      if (m && m[1].trim()) items.push(_stripWrappingPipes(m[1].trim()));
    });
    return items;
  }

  function parseDollarAmount(str) {
    if (!str) return null;
    var re = /\$?\s*([\d,]+(?:\.\d+)?)\s*([KMB])?/gi;
    var vals = [];
    var m;
    while ((m = re.exec(str))) {
      var num = parseFloat(m[1].replace(/,/g, ''));
      if (isNaN(num)) continue;
      var suffix = m[2] ? m[2].toUpperCase() : null;
      var mult = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
      vals.push(num * mult);
    }
    if (!vals.length) return null;
    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
    return Math.round(avg);
  }

  function confidenceFromScore(score, opts) {
    opts = opts || {};
    var s = typeof score === 'number' ? score : parseInt(score, 10);
    if (isNaN(s)) return null;
    var c = opts.invert ? (100 - s) : s;
    return Math.max(0, Math.min(100, c));
  }

  function confidenceTierFor(confidence) {
    if (typeof confidence !== 'number') return null;
    if (confidence >= 90) return 'HIGH';
    if (confidence >= 70) return 'MEDIUM';
    return 'LOW';
  }

  var TSMSLAExtractor = {
    extractDeadline: extractDeadline,
    extractEvidenceList: extractEvidenceList,
    parseDollarAmount: parseDollarAmount,
    confidenceFromScore: confidenceFromScore,
    confidenceTierFor: confidenceTierFor
  };

  global.TSMSLAExtractor = TSMSLAExtractor;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TSMSLAExtractor;
  }
})(typeof window !== 'undefined' ? window : this);
