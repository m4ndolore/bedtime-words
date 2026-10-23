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
  await expect(page.locator('#adder-share')).toBeHidden();
  await expect(page.locator('#adder-chips')).not.toContainText('From other families');
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

test('from other families: heart and add a shared one, then share our own through the robot check', async ({ page }) => {
  // protects=the community loop in the app (browse, heart once, add offline-safe copy, share with contact and Turnstile token); fails_when=the chip is missing, a second heart counts, the added copy is lost on reload, or the share request lacks the token or text; no_claim=the real Worker and Turnstile (both mocked here; the Worker is covered by tests/worker.test.mjs)
  const sent = { hearts: 0, submissions: [] };
  await page.route('**/api/community', (route) => route.fulfill({ json: {
    siteKey: 'test-key',
    affirmations: [{ id: 'sub-1', category: 'Kindness', challenge: 'I share', response: 'what I have.', hearts: 4 }],
  } }));
  await page.route('**/api/hearts', (route) => { sent.hearts += 1; return route.fulfill({ json: { hearts: 5 } }); });
  await page.route('**/api/submissions', (route) => {
    sent.submissions.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { id: 'new-1' } });
  });
  await page.route('https://challenges.cloudflare.com/**', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.turnstile = { render(el, o) { el.textContent = "robot check ok"; setTimeout(() => o.callback("pass"), 50); return 1; }, reset() {} };',
  }));

  await page.goto('/');
  await page.locator('#begin').click();
  await page.locator('#add-more').click();
  await page.getByRole('button', { name: 'From other families' }).click();
  await expect(page.locator('#suggestion-challenge')).toHaveText('I share');
  await expect(page.locator('#suggestion-meta')).toHaveText('Kindness · from another family');
  await page.locator('#suggestion-heart').click();
  await expect(page.locator('#suggestion-hearts')).toHaveText('5');
  await expect(page.locator('#suggestion-heart')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#suggestion-heart').click();
  expect(sent.hearts).toBe(1);
  await page.locator('#suggestion-add').click();
  await expect(page.locator('#adder-status')).toContainText("Added, and it's next");

  await page.locator('#writer-challenge').fill('When I feel left out,');
  await page.locator('#writer-response').fill('I know my family loves me.');
  await page.locator('#writer-submit').click();
  await page.locator('#adder-share').click();
  await expect(page.locator('#share-challenge')).toHaveText('When I feel left out,');
  await page.locator('#share-contact').fill('Pat');
  await expect(page.locator('#share-check')).toHaveText('robot check ok');
  await page.locator('#share-submit').click();
  await expect(page.locator('#share-status')).toHaveText('Sent. A grown-up reads every one before other families see it.');
  expect(sent.submissions).toEqual([{
    challenge: 'When I feel left out,', response: 'I know my family loves me.', category: 'Our Own', contact: 'Pat', turnstileToken: 'pass',
  }]);

  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bedtime-words-v1')));
  expect(saved.own.map((item) => [item.challenge, item.community || null, item.shared || false])).toEqual([
    ['I share', 'sub-1', false], ['When I feel left out,', null, true],
  ]);
  expect(saved.hearted).toEqual(['sub-1']);
});
