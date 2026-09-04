// test-extract.js
const fs = require('fs');
const path = require('path');

async function runTest() {
  console.log('Testing /api/doc-router/extract-file endpoint...');
  
  const testFilePath = path.join(__dirname, 'test-ticket.txt');
  fs.writeFileSync(testFilePath, '[Playbook: Disk Full - Test]\n1. Run cleanmgr.exe\n2. Clear temporary files.');

  try {
    const formData = new FormData();
    const fileBlob = new Blob([fs.readFileSync(testFilePath)], { type: 'text/plain' });
    formData.append('file', fileBlob, 'test-ticket.txt');

    const response = await fetch('http://localhost:3000/api/doc-router/extract-file', {
      method: 'POST',
      body: formData
    });

    console.log(`Response Status: ${response.status} ${response.statusText}`);
    const result = await response.json();
    console.log('Response Body:', result);

    fs.unlinkSync(testFilePath);
    console.log('Test file cleaned up successfully.');
  } catch (err) {
    console.error('Extraction test failed:', err);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  }
}

runTest();