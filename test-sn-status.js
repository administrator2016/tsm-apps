// test-sn-status.js
const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/l1-copilot/servicenow/status',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log('Response Body:', body);
  });
});

req.on('error', (err) => {
  console.error('Error:', err.message);
});

req.end();