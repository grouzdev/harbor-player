// Export production HTML with bundled assets into a private, file://-friendly
// comparison. The production build never reads this directory.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const cssCache = new Map();
async function inline(html) {
  for (const match of html.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)) {
    let css = cssCache.get(match[1]);
    if (!css) {
      css = await readFile(new URL(`dist/${match[1].replace('/harbor-player/', '')}`, root), 'utf8');
      css = css.replace(/\/harbor-player\/_astro\/(fira-[^/]+)\.[\w-]+\.woff2/g, '../src/styles/fonts/$1.woff2');
      css = css.replace(/\/harbor-player\/_astro\/lounge\.[\w-]+\.webp/g, '../public/images/lounge.webp');
      cssCache.set(match[1], css);
    }
    html = html.replace(match[0], `<style>${css}</style>`);
  }
  return html.replaceAll('/harbor-player/images/', '../public/images/');
}
await mkdir(new URL('mockups/', root), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const locale of ['en', 'ru']) {
    const source = await inline(await readFile(new URL(`dist/${locale === 'ru' ? 'ru/' : ''}index.html`, root), 'utf8'));
    for (const variant of ['a']) {
      const html = source.replace('<body>', `<body class="mockup-${variant}">`)
        .replaceAll('href="/harbor-player/"', `href="${variant}-en.html"`)
        .replaceAll('href="/harbor-player/ru/"', `href="${variant}-ru.html"`);
      const url = new URL(`mockups/${variant}-${locale}.html`, root);
      await writeFile(url, html);
      for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1000], ['mobile', 360, 900]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        await page.goto(url.href);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: fileURLToPath(new URL(`mockups/${variant}-${locale}-${name}.png`, root)), fullPage: true });
        await page.close();
      }
    }
  }
} finally { await browser.close(); }
await writeFile(new URL('mockups/index.html', root), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Harbor — сокращённый лендинг</title><style>body{background:#0d0e0e;color:#dce0e2;font:18px sans-serif;margin:32px}a{color:#b8bd82}section{display:flex;flex-wrap:wrap;gap:24px}article{flex:1;min-width:260px}img{width:100%;height:auto}</style><h1>Harbor Player</h1><p>Сокращённая вертикальная композиция. <a href="a-en.html">EN</a> / <a href="a-ru.html">RU</a></p><section><article><h2>Desktop · EN</h2><img src="a-en-desktop.png" alt="Английская версия, 1440px"></article><article><h2>Desktop · RU</h2><img src="a-ru-desktop.png" alt="Русская версия, 1440px"></article></section><section><article><h2>Mobile · EN</h2><img src="a-en-mobile.png" alt="Английская версия, 360px"></article><article><h2>Mobile · RU</h2><img src="a-ru-mobile.png" alt="Русская версия, 360px"></article></section></html>`);
