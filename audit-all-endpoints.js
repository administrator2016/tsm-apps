// audit-all-endpoints.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const endpoints = [
  { path: '/api/doc-router/extract-file', method: 'POST', name: 'File Extraction' },
  { path: '/api/l1-copilot/analyze', method: 'POST', name: 'L1 Copilot Analyze' },
  { path: '/api/l1-copilot/assistant', method: 'POST', name: 'L1 Copilot Assistant' }
];

console.log('Starting comprehensive endpoint verification audit...\n');

async function testEndpoint(ep) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ test: true, query: 'audit check' });
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: ep.path,
      method: ep.method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`[${ep.method}] ${ep.path} -> Status: ${res.statusCode}`);
        resolve({ path: ep.path, status: res.statusCode, body });
      });
    });

    req.on('error', (err) => {
      console.log(`[${ep.method}] ${ep.path} -> Error: ${err.message}`);
      resolve({ path: ep.path, status: 'ERROR', error: err.message });
    });

    if (ep.method === 'POST') {
      req.write(data);
    }
    req.end();
  });
}

async function runAll() {
  // First test file upload specifically
  const testFilePath = path.join(__dirname, 'audit-ticket.txt');
  fs.writeFileSync(testFilePath, '[Audit Test] Server verification check file content.');

  try {
    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(testFilePath)], { type: 'text/plain' });
    formData.append('file', fileBlob, 'audit-ticket.txt');

    const res = await fetch('http://localhost:3000/api/doc-router/extract-file', {
      method: 'POST',
      body: formData
    });
    console.log(`[POST] /api/doc-router/extract-file (Multipart File Upload) -> Status: ${res.status}`);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  } catch (err) {
    console.log(`[POST] /api/doc-router/extract-file -> Error: ${err.message}`);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  }

  // Test other JSON endpoints
  for (const ep of endpoints) {
    if (ep.path !== '/api/doc-router/extract-file') {
      await testEndpoint(ep);
    }
  }

  console.log('\nAudit complete.');
}

runAll();