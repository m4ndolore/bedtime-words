/* Renders tools/og.html to public/og.jpg (1200x630), the image shown in link previews. */
'use strict';

const path = require('node:path');
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(`file://${path.join(__dirname, 'og.html')}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(__dirname, '..', 'public', 'og.jpg'), type: 'jpeg', quality: 86 });
  await browser.close();
})();
