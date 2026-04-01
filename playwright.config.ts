import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 390, height: 844 },
    // Reuse session cookies so we don't have to log in each test
    storageState: './tests/.auth/session.json',
  },
  projects: [
    // Setup project: creates auth state
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
      use: { storageState: undefined },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'node dist/index.js',
    port: 3000,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
