// test-servicenow.js
const http = require('http');

async function testServiceNowRoutes() {
  console.log('Testing ServiceNow integration route handlers...');

  const payload = JSON.stringify({
    incidentNumber: 'INC0010029',
    demoMode: true
  });

  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/l1-copilot/servicenow', // Adjust path if your route differs
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    }
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
    console.error('ServiceNow route test error:', err.message);
  });

  req.write(payload);
  req.end();
}

testServiceNowRoutes();