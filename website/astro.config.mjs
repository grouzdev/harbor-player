import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://grouzdev.github.io',
  base: '/harbor-player',
  trailingSlash: 'always',
  output: 'static',
  devToolbar: { enabled: false },
});
