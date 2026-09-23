// Optional maintainer tool. Requires the root app's Playwright dependency and a
// running local application. Reads the UI; never clicks playback/file controls.
import { chromium } from '../../node_modules/playwright-core/index.mjs';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // Browse only: select a well-tagged part of the existing collection.
  await page.getByText('Brit-Pop', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.waitForTimeout(1500);
  await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
  await page.screenshot({ path: new URL('../.cache/player.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
} finally { await browser.close(); }
