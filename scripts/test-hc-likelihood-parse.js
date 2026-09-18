// Regression: Engine 04 machine-readable line must parse across formats,
// and must NEVER yield a level that isn't literally present in the text.
const fs = require('fs');
const html = fs.readFileSync(__dirname + '/../html/healthcare/hc-denial-war-room.html', 'utf8');
const m = html.match(/function parseRecoveryLikelihood\(text\) \{[\s\S]*?\n\}\n/);
if (!m) { console.error('FAIL: parseRecoveryLikelihood not found'); process.exit(1); }
const parse = new Function(m[0] + '; return parseRecoveryLikelihood;')();
const cases = [
  ['RECOVERY LIKELIHOOD: MODERATE - documentation gap is curable', 'MODERATE'],
  ['**RECOVERY LIKELIHOOD:** STRONG - signed note exists', 'STRONG'],
  ['**RECOVERY LIKELIHOOD: WEAK** - no attestation', 'WEAK'],
  ['recovery likelihood: strong \u2014 fine', 'STRONG'],
  ['plan text\n\n2. **Gather required documents**\n3. **Prepare the appeal letter**\n   - **Opening**: State', null],
  ['', null], [null, null],
];
let bad = 0;
for (const [input, want] of cases) {
  const got = parse(input);
  const level = got ? got.level : null;
  if (level !== want) { bad++; console.error('FAIL', JSON.stringify(input), 'want', want, 'got', level); }
}
const j = parse('**RECOVERY LIKELIHOOD:** MODERATE - curable gap');
if (!j || j.justification !== 'curable gap') { bad++; console.error('FAIL justification', j); }
if (bad) process.exit(1);
console.log('PASS: RECOVERY LIKELIHOOD parser (' + (cases.length + 1) + ' cases)');
