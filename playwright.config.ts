import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev:server',
      env: { HOST: '127.0.0.1', PORT: '3001', DATABASE_PATH: 'data/e2e-draft-room.sqlite' },
      port: 3001,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev:client -- --host 127.0.0.1',
      port: 5173,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
