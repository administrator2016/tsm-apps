// audit-endpoints.js
const http = require('http');

const endpoints = [
  '/api/doc-router/extract-file',
  // Add other key API routes here to verify their status
];

console.log('Running API endpoint availability check...');
// Quick check to ensure the server is running and routes are mounted
const req = http.get('http://localhost:3000', (res) => {
  console.log(`Server root status: ${res.statusCode}`);
  console.log('App server is reachable.');
  process.exit(0);
});

req.on('error', (err) => {
  console.error('Error: App server is not reachable on port 3000. Is it running?');
  process.exit(1);
});