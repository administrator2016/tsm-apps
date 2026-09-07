const { JSDOM } = require('jsdom');

async function checkCollegeBanner() {
  const RELAY_PAYLOAD = {
    docText: 'FILE: title-iv-r2t4-notice.pdf\nTYPE: R2T4 Notice\nCLIENT: Example State University\nREF: R2T4-88213',
    docType: 'R2T4 Notice',
    fileName: 'title-iv-r2t4-notice.pdf',
    client: 'Example State University',
    ref: 'R2T4-88213',
    source: 'doc-search',
    timestamp: Date.now(),
  };

  const dom = await JSDOM.fromURL('http://localhost:8080/html/war-rooms/college-command/college-finaid-command.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.localStorage.setItem('TSM_COLLEGE_WAR_RELAY', JSON.stringify(RELAY_PAYLOAD));
      window.fetch = (input, init) => fetch(new URL(input, 'http://localhost:8080/').toString(), init); // jsdom lacks fetch; resolve relative URLs against the server
    },
  });

  // give async fetch()/DOMContentLoaded handlers a moment to run
  await new Promise((r) => setTimeout(r, 1500));

  const doc = dom.window.document;
  const banner = doc.getElementById('tsm-college-relay-banner');
  console.log('[College Finaid] banner present:', !!banner);
  if (banner) {
    const text = banner.textContent;
    console.log('[College Finaid] contains docType:', text.includes('R2T4 Notice'));
    console.log('[College Finaid] contains fileName:', text.includes('title-iv-r2t4-notice.pdf'));
    console.log('[College Finaid] contains client:', text.includes('Example State University'));
    console.log('[College Finaid] contains ref:', text.includes('R2T4-88213'));
    const dismissBtn = doc.getElementById('tsm-college-relay-dismiss');
    console.log('[College Finaid] dismiss button present:', !!dismissBtn);
    if (dismissBtn) {
      dismissBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 100));
      console.log('[College Finaid] banner removed after dismiss:', !doc.getElementById('tsm-college-relay-banner'));
      console.log('[College Finaid] relay key cleared after dismiss:', !dom.window.localStorage.getItem('TSM_COLLEGE_WAR_RELAY'));
    }
  }

  // Also confirm the underlying dashboard still renders (relay banner
  // shouldn't have broken the existing KPI/table rendering)
  const kpiRow = doc.getElementById('kpiRow');
  console.log('[College Finaid] KPI row still renders content:', !!(kpiRow && kpiRow.children.length > 0));

  dom.window.close();
}

async function checkCollegeNoRelay() {
  const dom = await JSDOM.fromURL('http://localhost:8080/html/war-rooms/college-command/college-bursar-command.html', {
    runScripts: 'dangerously',
    resources: 'usable',
    beforeParse(window) {
      window.fetch = (input, init) => fetch(new URL(input, 'http://localhost:8080/').toString(), init);
    },
  });
  await new Promise((r) => setTimeout(r, 1000));
  const banner = dom.window.document.getElementById('tsm-college-relay-banner');
  console.log('[College Bursar, no relay seeded] banner absent as expected:', !banner);
  dom.window.close();
}

async function checkConciergeCommand() {
  const dom = await JSDOM.fromURL('http://localhost:8080/html/concierge/concierge-command.html', {
    runScripts: 'dangerously',
    resources: 'usable',
  });
  await new Promise((r) => setTimeout(r, 800));
  const doc = dom.window.document;
  const frames = doc.querySelectorAll('#frameStack iframe');
  console.log('[Concierge Command] iframe created on first tab (lazy load):', frames.length === 1);
  console.log('[Concierge Command] first iframe src is war-room:', frames[0] && frames[0].getAttribute('src') === '/html/concierge/concierge-war-room.html');

  const strategistTab = [...doc.querySelectorAll('.combo-tab')].find((t) => t.dataset.stage === 'strategist');
  strategistTab.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const frames2 = doc.querySelectorAll('#frameStack iframe');
  console.log('[Concierge Command] second iframe created after clicking Strategist tab:', frames2.length === 2);
  const activeFrame = doc.querySelector('#frameStack iframe.active');
  console.log('[Concierge Command] active iframe is now strategist:', activeFrame && activeFrame.getAttribute('src') === '/html/concierge/concierge-strategist.html');
  console.log('[Concierge Command] war-room iframe not re-fetched (still 2 total, not 3):', doc.querySelectorAll('#frameStack iframe').length === 2);

  dom.window.close();
}

(async () => {
  console.log('=== College Finaid: relay seeded ===');
  await checkCollegeBanner();
  console.log('\n=== College Bursar: no relay ===');
  await checkCollegeNoRelay();
  console.log('\n=== Concierge Command: tab switching ===');
  await checkConciergeCommand();
})().catch((e) => { console.error('SANITY CHECK FAILED:', e); process.exit(1); });
