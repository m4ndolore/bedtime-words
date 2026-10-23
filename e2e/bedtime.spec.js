'use strict';

const { test, expect } = require('@playwright/test');

async function tapCard(page) {
  await page.locator('#screen-card .half--challenge').click();
}

/* Tap until the whale shows: one tap reveals the kids' half, the next moves on. */
async function sayAll(page) {
  for (let i = 0; i < 40 && await page.locator('#screen-done').isHidden(); i += 1) await tapCard(page);
  await expect(page.locator('#screen-done')).toBeVisible();
}

test('offline after the first visit: run a session, add, write, remove, undo, reach the whale; reload keeps the set', async ({ page, context }) => {
  // protects=a phone with no signal still runs bedtime and remembers changes; fails_when=the shell is not cached, a change is lost on reload, or undo does not restore; no_claim=iOS Safari service worker behavior (Chromium mobile emulation stands in), sound output
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#start-count')).toHaveText('3 affirmations tonight');

  await page.locator('#begin').click();
  await expect(page.locator('#challenge')).toHaveText('I can do');

  await page.locator('#add-more').click();
  await page.locator('#suggestion-add').click();
  await expect(page.locator('#adder-status')).toContainText("Added, and it's next");
  await page.locator('#writer-challenge').fill('When I feel left out,');
  await page.locator('#writer-response').fill('I know my family loves me.');
  await page.locator('#writer-submit').click();
  await expect(page.locator('#adder-status')).toContainText('Added to the rotation');
  await page.locator('#close-adder').click();

  await page.locator('#remove-current').click();
  await expect(page.locator('#toast-text')).toContainText('Took out "I can do hard things."');
  await page.locator('#toast-undo').click();
  await expect(page.locator('#toast-text')).toHaveText('Put it back.');

  await sayAll(page);
  await expect(page.locator('#done-count')).toHaveText('5 affirmations said');

  await page.reload();
  await expect(page.locator('#start-count')).toHaveText('5 affirmations tonight');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bedtime-words-v1')));
  expect(saved.own.map((item) => item.response)).toEqual(['I know my family loves me.']);
  expect(saved.rotation).toHaveLength(5);
});

test('blocked storage: the page renders, a session runs, and says it will not remember', async ({ page }) => {
  // protects=private browsing still works for the night; fails_when=the page crashes or hides the warning; no_claim=each browser's real private-mode behavior (a throwing getter stands in)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto('/');
  await expect(page.locator('#start-note')).toHaveText("This browser won't remember your set.");
  await page.locator('#begin').click();
  await sayAll(page);
  await expect(page.locator('#done-count')).toHaveText('3 affirmations said');
});

test('simpler words: one tap switches that affirmation only, and it stays switched after a reload', async ({ page }) => {
  // protects=a family can make one hard affirmation easier without a global setting; fails_when=the block is missing on a built-in card, changes one that has no simpler version, changes the wrong card, or forgets after reload; no_claim=sound, animation timing
  await page.goto('/');
  await page.locator('#begin').click();
  await expect(page.locator('#challenge')).toHaveText('I can do');
  await page.locator('#wording').click();
  await expect(page.locator('#toast-text')).toHaveText('This one is already as simple as it gets.');
  await expect(page.locator('#challenge')).toHaveText('I can do');
  await tapCard(page); await tapCard(page); await tapCard(page); await tapCard(page);
  await expect(page.locator('#challenge')).toHaveText('I am capable of anything');
  await page.locator('#wording').click();
  await expect(page.locator('#challenge')).toHaveText('I can');
  await expect(page.locator('#wording')).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.locator('#begin').click();
  await expect(page.locator('#challenge')).toHaveText('I can do');
  await tapCard(page); await tapCard(page); await tapCard(page); await tapCard(page);
  await expect(page.locator('#challenge')).toHaveText('I can');
  await tapCard(page);
  await expect(page.locator('#response')).toHaveText('do it.');
  await expect(page.locator('#wording')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#wording').click();
  await expect(page.locator('#wording')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#challenge')).toHaveText('I am capable of anything');
  await expect(page.locator('#response')).toHaveText('I put my mind to.');
});
