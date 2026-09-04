#!/usr/bin/env node
/**
 * Batch-analyze a text file of tickets through the L1 Copilot /analyze endpoint.
 *
 * Usage:
 *   node scripts/batch-analyze.js path/to/tickets.txt
 *   node scripts/batch-analyze.js path/to/tickets.txt --url http://localhost:3000 --out results.md
 *
 * Input file format: multiple tickets in one .txt file, separated EITHER by:
 *   - a numbered/lettered header at the start of a line, e.g. "1.", "2)", "Ticket 3:", "#4"
 *   - or, if no numbering is found, two or more consecutive blank lines
 *
 * Example input:
 *   1. User can't print to the 3rd floor printer, error says "offline"...
 *
 *   2. Outlook won't open, crashes on launch with error 0x8004010F...
 *
 *   3. Laptop won't connect to VPN, GlobalProtect says "gateway unreachable"...
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { file: null, url: 'http://localhost:3000', out: null, delayMs: 1500 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--url') args.url = rest[++i];
    else if (a === '--out') args.out = rest[++i];
    else if (a === '--delay') args.delayMs = parseInt(rest[++i], 10);
    else if (!args.file) args.file = a;
  }
  return args;
}

function splitTickets(raw) {
  const text = raw.replace(/\r\n/g, '\n').trim();
  // Strategy 1: numbered/lettered headers at start of a line, e.g. "1.", "2)", "Ticket 3:", "#4"
  const headerPattern = /^\s*(?:ticket\s*)?(?:#\s*)?\d+[\.\):]\s+/gim;
  const headerMatches = [...text.matchAll(headerPattern)];

  if (headerMatches.length >= 2) {
    const chunks = [];
    for (let i = 0; i < headerMatches.length; i++) {
      const start = headerMatches[i].index;
      const end = i + 1 < headerMatches.length ? headerMatches[i + 1].index : text.length;
      const chunk = text.slice(start, end).replace(headerPattern, '').trim();
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  }

  // Strategy 2: fall back to splitting on 2+ consecutive blank lines
  return text
    .split(/\n\s*\n\s*\n*/)
    .map(s => s.trim())
    .filter(Boolean);
}

async function analyzeTicket(baseUrl, description) {
  const res = await fetch(`${baseUrl}/api/l1-copilot/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: { description } })
  });
  const body = await res.json().catch(() => ({ ok: false, error: `non-JSON response (status ${res.status})` }));
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

function formatResult(index, description, result, error) {
  const lines = [];
  lines.push(`## Ticket ${index}`);
  lines.push('');
  lines.push('**Raw text:**');
  lines.push('```');
  lines.push(description.slice(0, 500) + (description.length > 500 ? '…' : ''));
  lines.push('```');
  lines.push('');
  if (error) {
    lines.push(`**Analysis failed:** ${error}`);
  } else {
    const a = result.analysis || result;
    lines.push(`**Issue summary:** ${a.issue_summary || 'n/a'}`);
    lines.push(`**Severity:** ${a.severity || 'n/a'}  |  **Confidence:** ${a.confidence ?? 'n/a'}`);
    if (a.likely_causes?.length) {
      lines.push(`**Likely causes:**`);
      a.likely_causes.forEach(c => lines.push(`- ${c}`));
    }
    lines.push(`**Recommended path:** ${a.recommended_path || 'n/a'}`);
    if (a.extracted_fields) {
      const ef = Object.entries(a.extracted_fields).filter(([, v]) => v);
      if (ef.length) {
        lines.push(`**Extracted fields:** ${ef.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    }
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage: node scripts/batch-analyze.js <tickets.txt> [--url http://localhost:3000] [--out results.md] [--delay 1500]');
    process.exit(1);
  }

  const raw = fs.readFileSync(args.file, 'utf8');
  const tickets = splitTickets(raw);

  if (tickets.length === 0) {
    console.error('No tickets found in file — check formatting (numbered lines or blank-line-separated blocks).');
    process.exit(1);
  }

  console.log(`Found ${tickets.length} ticket(s) in ${args.file}. Analyzing against ${args.url} ...\n`);

  const outPath = args.out || path.join(path.dirname(args.file), `results-${Date.now()}.md`);
  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  outStream.write(`# Batch Analysis Results\n\n_${tickets.length} tickets, run ${new Date().toISOString()}_\n\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < tickets.length; i++) {
    const description = tickets[i];
    process.stdout.write(`[${i + 1}/${tickets.length}] Analyzing... `);
    try {
      const result = await analyzeTicket(args.url, description);
      outStream.write(formatResult(i + 1, description, result, null));
      console.log('done');
      successCount++;
    } catch (e) {
      outStream.write(formatResult(i + 1, description, null, e.message));
      console.log(`FAILED: ${e.message}`);
      failCount++;
    }
    // Small delay between calls — polite to the LLM API and avoids rate limits
    if (i < tickets.length - 1 && args.delayMs > 0) {
      await new Promise(r => setTimeout(r, args.delayMs));
    }
  }

  outStream.end();
  console.log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
  console.log(`Results written to: ${outPath}`);
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
