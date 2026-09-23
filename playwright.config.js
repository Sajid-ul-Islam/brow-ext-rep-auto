import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.(js|mjs)/,
  timeout: 30000,
  retries: 0,
  workers: 1, // Single worker for extension tests
  use: {
    headless: true,
  },
});
