import { test, expect } from '@playwright/test';
for (const locale of ['en', 'ru']) {
  for (const width of [360, 768, 1440]) {
    test(`${locale} at ${width}px works without JavaScript`, async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 1000 } });
      const page = await context.newPage();
      const failures: string[] = [];
      page.on('response', response => { if (response.status() >= 400) failures.push(response.url()); });
      await page.goto(`http://127.0.0.1:4322/harbor-player/${locale === 'ru' ? 'ru/' : ''}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('h1')).toContainText(locale === 'ru' ? 'Коллекционируй' : 'Collect');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
      await expect(page.locator('.feature-card')).toHaveCount(3);
      await expect(page.locator('.roadmap-stage')).toHaveCount(4);
      await expect(page.locator('.features-section h2')).toContainText(locale === 'ru' ? 'Возможности' : 'Features');
      await expect(page.locator('.roadmap-section h2')).toContainText(locale === 'ru' ? 'Дорожная карта' : 'Roadmap');
      expect(failures).toEqual([]);
      await context.close();
    });
  }
}
test('metadata, keyboard navigation, downloads and screenshot link', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://grouzdev.github.io/harbor-player/');
  await expect(page.locator('link[hreflang="ru"]')).toHaveAttribute('href', 'https://grouzdev.github.io/harbor-player/ru/');
  await page.keyboard.press('Tab');
  await expect(page.locator('.skip-link')).toBeFocused();
  await expect(page.locator('.skip-link')).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.hero .pending')).toContainText('coming soon');
  await expect(page.locator('a[href$=".exe"]')).toHaveCount(0);
  await page.locator('.screen-frame').click();
  await expect(page).toHaveURL(/\/images\/player.webp$/);
});
