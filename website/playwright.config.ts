import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:4322/harbor-player/', headless: true, ...(process.env.CI ? {} : { channel: 'chrome' }) },
  webServer: { command: 'npm run preview -- --port 4322', url: 'http://127.0.0.1:4322/harbor-player/', reuseExistingServer: !process.env.CI },
});
