# Asset inventory and provenance

| Website asset | Source / treatment |
| --- | --- |
| `public/images/icon.png` | Copy of root `public/icon-192.png`; actual app icon. |
| `public/images/lounge.webp` | Root `assets/bg_lounge.jpg`, resized to 1920px and encoded as WebP quality 80. |
| `public/images/player.webp` | Fresh 1920×1080 browser screenshot of the running app at localhost:5173, browsing Brit-Pop. WebP quality 90. |
| `public/images/player-small.webp` | Same screenshot at 960×540, WebP quality 85. |
| `public/images/social.jpg` | Same screenshot contained within 1200×630, JPEG quality 85. |
| `src/styles/fonts/*` | Copies from app `src/client/assets/fonts/`; Fira Sans Condensed. |
| `public/licenses/*` | Font OFL notices copied from the same source. |
| Noise and metal CSS | Exact source declarations recorded in design.md and CSS comments. |


The screenshot shows the real application's Russian UI on both site locales, identified in the accessible image description. It contains album art already displayed in the owner's collection, just as the supplied app reference does. It does not invent app controls or include local absolute paths. The original capture is an ignored working artifact, not a second public image.

Optional screenshot refresh: run `node website/scripts/capture-player.mjs` from repository root while the app is available on port 5173. This maintainer script uses the root Playwright installation and browses the Brit-Pop genre; it does not change tags/files or start playback. Normal website builds never invoke it. After recapture, encode the two WebP sizes and the JPEG preview as above, then rebuild mockups.

Mockup HTML references the website's checked-in font and image files; it does not require `dist/`. No AI-generated raster resources were required.
