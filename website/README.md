# Harbor Player website

Standalone Astro site. Run these commands **inside `website/`** with Node.js 24:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:4321/harbor-player/` (English) or append `ru/`.

```sh
npm run check
npm run build
npm test
npm run preview
```

Browser tests use installed Chrome locally. On Linux CI they use Playwright Chromium (`npx playwright install --with-deps chromium`). The website does not need the root application's dependencies, server or music folders.

## Review artifacts

Open [the preview gallery](mockups/index.html) directly in a browser. It shows the simplified vertical layout in EN/RU at desktop and mobile sizes; 768px snapshots are also saved. The HTML exports work without a development server. Regenerate with `npm run build` then `npm run mockups` (installed Chrome required).

There is no visible language switch. Russian remains available directly at `/harbor-player/ru/`.

- [Brief and decisions](docs/brief.md)
- [Design and CSS provenance](docs/design.md)
- [Editorial copy](docs/content.md)
- [Asset sources](docs/assets.md)
- [Implementation status and deployment](docs/plan.md)

## Download configuration

Edit `src/config/release.ts` after verifying published release assets. Set version, channel (`stable` or `unsigned-beta`), installer URL, optional portable URL and release notes URL. Unreleased or incomplete configuration cannot create download links. No browser request is made to GitHub's API.

The first-screen description is an editorial draft in `src/content/copy.ts`, also used for metadata. Change both language entries when the owner supplies final copy.

## Publication

The workflow `.github/workflows/website.yml` checks and builds **only this project**, runs browser tests, then deploys the `dist` artifact on main. PRs only validate. In GitHub Settings → Pages select **GitHub Actions** as the build source before the first deployment. The configured address is `https://grouzdev.github.io/harbor-player/`.

Only `dist/` is public. The documentation, source files, capture script, gallery and mockup images are excluded from the deployment. Font licenses are shipped under `public/licenses/`.
