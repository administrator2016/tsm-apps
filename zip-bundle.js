const fs = require('fs');
const { execSync } = require('child_process');

const filesToZip = [
  'html/js/career/tsm-rcm-career-engine.js',
  'html/js/career/tsm-rcm-career-progression.js',
  'html/js/career/tsm-denial-recovery-career-adapter.js',
  'html/js/career/tsm-revenue-leakage-career-adapter.js',
  'html/js/career/tsm-hc-portfolio-career-bridge.js',
  'html/tsm-career-training-platform.html',
  'html/healthcare/hc-denial-war-room.html',
  'server/healthcare/revenue-leakage-contract.js',
  'server/healthcare/portfolio-intelligence.js',
  'server/tsm-output-contract.js',
  'tests/playwright/leakage-001-career-canonical.spec.js',
  'tests/playwright/hc-portfolio-career-bridge.spec.js'
];

const outputZip = 'tsm-career-bundle.zip';

const existingFiles = filesToZip.filter(file => {
  if (fs.existsSync(file)) {
    return true;
  }
  console.warn(`Skipping missing file: ${file}`);
  return false;
});

if (existingFiles.length === 0) {
  console.error('Error: None of the specified target files were found in the workspace.');
  process.exit(1);
}

try {
  const fileListArgs = existingFiles.map(f => `"${f}"`).join(' ');
  execSync(`zip ${outputZip} ${fileListArgs}`, { stdio: 'inherit' });
  console.log(`Successfully generated ${outputZip} containing ${existingFiles.length} files.`);
} catch (error) {
  console.error('Error executing zip utility. Ensure system zip package is available.', error.message);
  process.exit(1);
}