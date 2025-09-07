import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;
const HEADLESS =
  process.env.PW_HEADLESS !== undefined
    ? process.env.PW_HEADLESS !== '0'
    : (process.env.PWDEBUG === '1' ? false : true);

export default defineConfig({
  testDir: './tests',
  forbidOnly: CI,
  workers: CI ? 1 : undefined,
  retries: CI ? 0 : 0,

  outputDir: 'test-results',
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  timeout: process.env.PW_TIMEOUT_MS ? Number(process.env.PW_TIMEOUT_MS) : 30_000,
  expect: { timeout: process.env.PW_EXPECT_TIMEOUT_MS ? Number(process.env.PW_EXPECT_TIMEOUT_MS) : 10_000 },

  use: {
    headless: HEADLESS,                       // <-- can be forced off via PW_HEADLESS=0
    baseURL: process.env.BASE_URL || undefined,
    navigationTimeout: Number(process.env.PW_NAV_TIMEOUT_MS || 60_000),
    actionTimeout: Number(process.env.PW_ACTION_TIMEOUT_MS || 0),
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // (no --single-process, no --disable-gpu)
      ],
    },
  },

  projects: [
    // CI target (headless controlled by PW_HEADLESS)
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Local-only extras
    ...(!CI
      ? [
          { name: 'Google Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
