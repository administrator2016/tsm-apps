// tests/e2e/song-builder-to-master.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE_URL = process.env.TSM_BASE_URL || 'http://localhost:8080';
const outDir = path.join(__dirname, 'screenshots', 'song-builder-to-master');
let shotNum = 0;

async function shot(page, label) {
  shotNum += 1;
  const file = String(shotNum).padStart(3, '0') + '-' + label + '.png';
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
}

test('Song Builder -> Cadence Studio -> Mastering Coach (full creation chain)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });

  // ---- STEP 1: Song Builder — genre / mood ----
  await page.goto(`${BASE_URL}/war-rooms/music-war/creation/song-builder.html`);
  await shot(page, 'hub-load');

  await page.click('#genreChips >> text=Melodic Rap');
  await shot(page, 'genre-selected');

  await page.click('#nextBtn'); // -> step1 (mood)
  await page.click('.chip-grid >> text=Triumph / Victory');
  await shot(page, 'mood-selected');

  await page.click('#nextBtn'); // -> step2 (inspiration)

  // ---- STEP 2: Sound Inspiration — one preset + one MANUAL/custom artist ----
  await page.click('.inspire-chip >> text=Drake');

  // Not a preset chip — types it in manually
  await page.fill('#customArtistInput', 'Anderson .Paak');
  await page.click('button:has-text("+ Add")');

  const customChip = page.locator('.inspire-chip.custom', { hasText: 'Anderson .Paak' });
  await expect(customChip).toBeVisible();
  await expect(customChip.locator('.genre')).toHaveText('Custom');
  await shot(page, 'custom-artist-added');

  // One more preset to hit the 3-artist cap (2 preset + 1 custom already picked)
  await page.click('.inspire-chip >> text=SZA');

  // Cap enforcement: a 4th artist (typed) should be rejected with an alert
  let alertMessage = '';
  page.once('dialog', async (dialog) => {
    alertMessage = dialog.message();
    await dialog.accept();
  });
  await page.fill('#customArtistInput', 'Someone Else');
  await page.click('button:has-text("+ Add")');
  expect(alertMessage).toContain('up to 3');
  await expect(page.locator('.inspire-chip.custom', { hasText: 'Someone Else' })).toHaveCount(0);
  await shot(page, 'cap-enforced');

  await page.click('#nextBtn'); // -> step3 message
  await page.fill('#messageInput',
    "A song about going from nothing to everything and not letting anyone act like they were there from the start.");
  await page.click('#nextBtn'); // -> step4 hook

  await page.fill('#hookInput', "It's me, it's me, it's only me, ain't no us");
  await page.click('#nextBtn'); // -> step5 beat intel

  await page.fill('#bpmInput', '148');
  await page.fill('#keyInput', 'F Minor');
  await page.click('#nextBtn'); // -> step6 structure

  await page.click('#nextBtn'); // keep default structure -> step7 notes
  await page.fill('#notesInput',
    "Cardi B-style delivery, sharp ad-libs, boastful metaphors, direct 'me not you' tone.");
  await shot(page, 'final-notes-filled');

  await page.click('button:has-text("Generate Song")');
  await page.waitForSelector('#output.show', { timeout: 60000 });
  await shot(page, 'song-generated');

  const hookText = await page.textContent('.output-section:has(h3:text("HOOK")) pre');
  expect(hookText.trim().length).toBeGreaterThan(0);

  // ---- STEP 3: Cadence Studio ----
  await page.click('button:has-text("Cadence Studio")');
  await page.waitForURL(/cadence-builder\.html/);
  await shot(page, 'cadence-studio-load');

  const bars = [
    "From rags to riches, runnin' circles round bitches",
    "Dey man face all in my cat like a Hungry Man dinner",
    "Started with lint in my pocket, now it's linen on my table",
    "Every no I got in twenty-nineteen turned to neon on the label",
    "Bag so heavy got my chiropractor on retainer",
    "I'm the forecast, everybody else just weather vane sir",
    "Diamonds doin' laps around my wrist like it's Nascar",
    "You a rental baby, I'm the one that own the dealer",
  ];
  for (let i = 0; i < bars.length; i++) {
    await page.fill(`#lyricsArea .lyric-row:nth-child(${i + 1}) .lyric-input`, bars[i]);
  }
  await shot(page, 'bars-entered');

  await page.click('.btn.btn-amber');
  await page.waitForFunction(
    () => document.getElementById('fbHeader')?.textContent.includes('Score:'),
    { timeout: 60000 }
  );
  const scoreHeader = await page.textContent('#fbHeader');
  expect(scoreHeader).toMatch(/Score:\s*\d+\/10/);
  await shot(page, 'analyze-flow-result');

  // ---- STEP 4: Mastering Coach (readiness check, not audio generation) ----
  await page.goto(`${BASE_URL}/war-rooms/music-war/producer/mastering-coach.html`);
  await shot(page, 'mastering-coach-load');

  await page.fill('#lufsInput', '-9.5');
  await page.fill('#peakInput', '-0.2');
  await page.fill('#notesInput', 'Hook feels a little hot compared to the verses.');
  await page.click('button:has-text("Check Readiness")');

  await page.waitForSelector('#resultPanel', { state: 'visible', timeout: 30000 });
  const verdict = await page.textContent('#verdict');
  expect(verdict.trim()).not.toBe('—');
  await shot(page, 'mastering-verdict');
});
