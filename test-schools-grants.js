#!/usr/bin/env node
/**
 * E2E test: Schools Command -> Grants tab -> Load Sample Data -> Run AI Analysis
 *
 * Usage (in Codespace, repo root):
 *   npm install puppeteer --no-save   (one-time, if not already present)
 *   GROQ_API_KEY=your_real_key node test-schools-grants.js
 *
 * Starts server.js itself, runs the click-through in a real headless
 * Chrome, asserts each step, prints PASS/FAIL, and shuts the server down.
 * Exit code 0 = all assertions passed, 1 = something failed.
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 8080;
const BASE = `http://localhost:${PORT}`;
const PAGE_URL = `${BASE}/html/war-rooms/schools-command/schools-command.html`;

function waitForServer(timeoutMs = 15000) {
  const http = require('http');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      http.get(BASE, res => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server did not start in time'));
          else setTimeout(poll, 300);
        });
    })();
  });
}

function check(label, cond, detail) {
  const line = `${cond ? 'PASS' : 'FAIL'} - ${label}${detail ? ' :: ' + detail : ''}`;
  console.log(line);
  if (!cond) failures.push(label);
}

const failures = [];

(async () => {
  if (!process.env.GROQ_API_KEY) {
    console.warn('WARNING: GROQ_API_KEY not set — Run AI Analysis will 500 (that step will be reported, not skipped).');
  }

  console.log(`Starting server.js on port ${PORT}...`);
  const server = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverLog = '';
  server.stdout.on('data', d => (serverLog += d.toString()));
  server.stderr.on('data', d => (serverLog += d.toString()));

  const cleanup = () => { try { server.kill('SIGTERM'); } catch (_) {} };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  try {
    await waitForServer();
  } catch (e) {
    console.error('Server failed to start. Log:\n' + serverLog);
    cleanup();
    process.exit(1);
  }

  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const consoleErrors = [];
  const badRequests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push('PAGEERROR: ' + err.message));
  page.on('response', res => {
    if (res.status() >= 400 && !res.url().endsWith('favicon.ico')) {
      badRequests.push(`HTTP ${res.status()}: ${res.url()}`);
    }
  });

  console.log(`\nLoading ${PAGE_URL} ...`);
  const resp = await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 20000 });
  check('page loads with 200', resp.status() === 200, `got ${resp.status()}`);

  await page.click('button[data-tab="grants"]');
  await new Promise(r => setTimeout(r, 300));
  const grantsVisible = await page.$eval('#tab-grants', el => el.style.display !== 'none');
  check('Grants tab becomes visible', grantsVisible);

  const beforeText = await page.$eval('#schBreachBody', el => el.textContent.trim());
  check('empty state shown before data load', /No data loaded/i.test(beforeText), beforeText.slice(0, 60));

  await page.click('#schBtnLoadSample');
  await new Promise(r => setTimeout(r, 600));
  const afterText = await page.$eval('#schBreachBody', el => el.textContent.trim());
  check('records table populates after Load Sample Data', afterText.length > 0 && !/No data loaded/i.test(afterText), afterText.slice(0, 80));

  const kpiCount = await page.$eval('#schKpiGrid', el => el.children.length);
  check('KPI grid populates after Load Sample Data', kpiCount > 0, `${kpiCount} tiles`);

  await page.click('#schBtnRunAnalysis');
  await new Promise(r => setTimeout(r, 3000));
  const aiOutput = await page.$eval('#schAiOutput', el => el.textContent.trim());
  const aiSucceeded = !/Analysis failed/i.test(aiOutput) && aiOutput.length > 0;
  check('Run AI Analysis returns a result (not the fallback error)', aiSucceeded, aiOutput.slice(0, 120));
  if (!aiSucceeded) {
    const serverErrLine = serverLog.split('\n').filter(l => /SCHOOLS ANALYSIS GROQ ERROR/i.test(l)).join('\n');
    console.log('  server-side error detail:', serverErrLine || '(not found in server log -- see full dump below)');
  }

  check('no unexpected failed HTTP requests', badRequests.length === 0, badRequests.join(' | '));
  check('no uncaught JS console errors', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();
  cleanup();

  console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : failures.length + ' CHECK(S) FAILED: ' + failures.join(', ')}`);
  if (failures.length > 0) {
    console.log('\n--- full server log (for diagnosing the failures above) ---');
    console.log(serverLog);
  }
  process.exit(failures.length === 0 ? 0 : 1);
})().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
