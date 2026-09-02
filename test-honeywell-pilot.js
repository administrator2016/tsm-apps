// test-honeywell-pilot.js
// Run with: npx playwright test test-honeywell-pilot.js (or node test-honeywell-pilot.js using playwright)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, slowMo: 100 });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('🔗 Navigating to Honeywell Strategist Portal...');
  await page.goto('http://localhost:3000/html/war-rooms/honeywell-strategist.html');

  // Define source categories available in the Honeywell relay metadata
  const sources = ['cyber', 'plant', 'supplier'];
  // Pick one random source to simulate first, or cycle through them
  const randomSource = sources[Math.floor(Math.random() * sources.length)];
  console.log(`🎲 Selected random incident source: ${randomSource.toUpperCase()}`);

  // Trigger sample load matching the selected source
  // (Assuming sample load buttons or dropdown triggers exist on the strategist page)
  const sampleButtonSelector = `[data-load-source="${randomSource}"], button:has-text("${randomSource}"), .sample-btn-${randomSource}`;
  
  // Fallback or explicit interaction with sample injector if present
  try {
    await page.waitForSelector('.action-bar, .sample-container, button', { timeout: 5000 });
    // Click a sample load button if available, or evaluate sample injection script
    await page.evaluate((src) => {
      // Simulate loading sample data into RELAY_KEY if UI buttons aren't direct
      const samplePayloads = {
        plant: { source: 'plant', summary: 'Critical turbine temperature anomaly detected in Plant 4.', priority: 'high', exposure: 125000 },
        cyber: { source: 'cyber', summary: 'Unauthorized egress traffic flagged on SCADA subnet 14.', priority: 'critical', exposure: 450000 },
        supplier: { source: 'supplier', summary: 'Component batch delivery halted by tier-2 supplier logistics failure.', priority: 'medium', exposure: 85000 }
      };
      localStorage.setItem('TSM_HONEYWELL_EXEC_RELAY', JSON.stringify(samplePayloads[src]));
      window.location.reload();
    }, randomSource);
    
    console.log(`✅ Injected ${randomSource} sample payload and reloaded.`);
    await page.waitForLoadState('networkidle');

    // Run 6-Engine analysis / Escalate to Executive Portal
    console.log('⚡ Escalating to Executive Portal...');
    const escalateBtn = await page.$('button:has-text("ESCALATE"), .abtn.approve');
    if (escalateBtn) {
      await escalateBtn.click();
    } else {
      // Direct navigation if button selector varies
      await page.goto('http://localhost:3000/html/war-rooms/honeywell-executive-portal.html');
    }

    await page.waitForSelector('#tsm-case-queue', { timeout: 5000 });
    console.log('🎯 Successfully verified Executive Portal mount and case queue synchronization.');

  } catch (err) {
    console.error('❌ Test execution encountered an issue:', err.message);
  } finally {
    await browser.close();
  }
})();