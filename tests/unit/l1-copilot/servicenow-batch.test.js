// Standalone test (node tests/unit/l1-copilot/servicenow-batch.test.js).
// Covers createTicket/deleteTicket/createTicketsBatch against a local mock
// Table API — including the 429-retry/backoff path and the "one bad record
// doesn't sink the batch" behavior. Same honest caveat as
// servicenow-adapter.test.js: this proves the request-building/retry/chunking
// logic works, not that it's compatible with a real customer instance's
// schema, ACLs, or business rules — see scripts/test-servicenow-batch-pdi.js
// for that validation pass against a real (PDI or dev) instance.

const http = require('http');
const adapter = require('../../../server/l1-copilot/servicenow-adapter');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name); }
}

let nextSysId = 1;
const created = [];
let rateLimitRemaining = 0; // number of upcoming POSTs to answer with 429 before succeeding
let serverErrorRemaining = 0;
const postedBodies = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const u = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && u.pathname === '/api/now/table/incident') {
      const parsed = JSON.parse(body || '{}');
      postedBodies.push(parsed);

      if (rateLimitRemaining > 0) {
        rateLimitRemaining -= 1;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
        return;
      }
      if (serverErrorRemaining > 0) {
        serverErrorRemaining -= 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Internal instance error' } }));
        return;
      }
      if (parsed.short_description === 'REJECT_ME') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Mandatory field missing' } }));
        return;
      }

      const sysId = String(nextSysId).padStart(32, '0');
      nextSysId += 1;
      const number = `INC00${10000 + created.length}`;
      created.push({ sysId, number });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: { sys_id: sysId, number, ...parsed } }));
      return;
    }

    if (req.method === 'GET' && u.pathname === '/api/now/table/incident') {
      const q = u.searchParams.get('sysparm_query') || '';
      const match = created.find(c => q.includes(c.number) || q.includes(c.sysId));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: match ? [{ sys_id: match.sysId, number: match.number }] : [] }));
      return;
    }

    if (req.method === 'DELETE' && u.pathname.startsWith('/api/now/table/incident/')) {
      res.writeHead(204); res.end();
      return;
    }

    res.writeHead(404); res.end('not found');
  });
});

async function main() {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const config = { instanceUrl: `http://localhost:${port}`, username: 'admin', password: 'secret', fieldMap: adapter.DEFAULT_FIELD_MAP };

  // --- createTicket happy path ---
  const t1 = await adapter.createTicket({ short_description: 'Printer offline', priority: '3' }, config);
  check('createTicket reports success', t1.success === true);
  check('createTicket returns a number', /^INC00/.test(t1.number));
  check('createTicket returns a sysId', typeof t1.sysId === 'string' && t1.sysId.length === 32);

  // --- deleteTicket happy path (cleanup helper) ---
  const del = await adapter.deleteTicket(t1.number, config);
  check('deleteTicket reports success', del.success === true);

  // --- createTicketsBatch: all succeed ---
  const batch1 = await adapter.createTicketsBatch(
    [{ short_description: 'A' }, { short_description: 'B' }, { short_description: 'C' }],
    { chunkSize: 2, delayBetweenChunksMs: 0 },
    config
  );
  check('batch1 total is 3', batch1.total === 3);
  check('batch1 all succeeded', batch1.succeeded === 3 && batch1.failed === 0);
  check('batch1 results preserve input order', batch1.results.every((r, i) => r.index === i));

  // --- createTicketsBatch: one record fails, rest still succeed ---
  const batch2 = await adapter.createTicketsBatch(
    [{ short_description: 'ok-1' }, { short_description: 'REJECT_ME' }, { short_description: 'ok-2' }],
    { chunkSize: 3, delayBetweenChunksMs: 0 },
    config
  );
  check('batch2 partial failure: succeeded count', batch2.succeeded === 2);
  check('batch2 partial failure: failed count', batch2.failed === 1);
  check('batch2 failed record retains its fields for retry/inspection', batch2.results[1].fields.short_description === 'REJECT_ME');
  check('batch2 unrelated records still created', batch2.results[0].success && batch2.results[2].success);

  // --- createTicketsBatch: transient 429s are retried and eventually succeed ---
  rateLimitRemaining = 2;
  const batch3 = await adapter.createTicketsBatch(
    [{ short_description: 'retry-me' }],
    { chunkSize: 1, delayBetweenChunksMs: 0, initialBackoffMs: 5, maxRetries: 3 },
    config
  );
  check('batch3 succeeds after transient 429s', batch3.succeeded === 1 && batch3.failed === 0);

  // --- createTicketsBatch: retries exhausted on persistent 5xx -> reported failed, not thrown ---
  serverErrorRemaining = 10;
  const batch4 = await adapter.createTicketsBatch(
    [{ short_description: 'always-500' }],
    { chunkSize: 1, delayBetweenChunksMs: 0, initialBackoffMs: 1, maxRetries: 2 },
    config
  );
  check('batch4 reports failure after exhausting retries (does not throw)', batch4.failed === 1 && batch4.succeeded === 0);
  check('batch4 failure carries the upstream error message', /Internal instance error/.test(batch4.results[0].error));
  serverErrorRemaining = 0;

  // --- guardrails ---
  let threwEmpty = false;
  try { await adapter.createTicketsBatch([], {}, config); } catch (e) { threwEmpty = true; }
  check('createTicketsBatch rejects an empty array', threwEmpty);

  let threwTooLarge = false;
  try {
    const tooMany = new Array(adapter.MAX_BATCH_SIZE + 1).fill({ short_description: 'x' });
    await adapter.createTicketsBatch(tooMany, {}, config);
  } catch (e) { threwTooLarge = true; }
  check(`createTicketsBatch rejects more than ${adapter.MAX_BATCH_SIZE} records`, threwTooLarge);

  let threwNotConfigured = false;
  try { await adapter.createTicketsBatch([{ short_description: 'x' }], {}, {}); } catch (e) { threwNotConfigured = e instanceof adapter.ServiceNowNotConfiguredError; }
  check('createTicketsBatch throws ServiceNowNotConfiguredError when unconfigured', threwNotConfigured);

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
