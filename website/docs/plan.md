# Simplification status

Implemented: one vertical composition, monochrome slogan, single font family, darker lounge background, plain GitHub/Portable links, four plain feature lines and license-only footer. FAQ, navigation, language switch, decorative elements, captions and duplicate actions are removed. Obsolete component, CSS rules, copy and Fira Mono assets are removed.

English and direct Russian routes, localization metadata, static rendering, release configuration and its state tests remain. The actual app screenshot is unchanged. The current gallery replaces A/B comparison with the simplified page and EN/RU screenshots at 360/768/1440px.

Validation: run npm run check, npm run build, npm test, and npm run mockups. Browser checks cover direct locale URLs with JavaScript disabled, image loading, overflow, four feature lines, metadata, keyboard focus and full-image navigation.

This stage is local only. Publication remains outstanding and is not part of the simplification. The existing GitHub Pages workflow remains available for a later rollout. The description remains an editorial draft.

Validation completed: Astro check and static build passed; 4 release tests and 7 browser scenarios passed. Desktop EN and mobile RU snapshots were visually reviewed.
