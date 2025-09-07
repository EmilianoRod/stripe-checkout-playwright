import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',

  // CI hygiene
  forbidOnly: CI,
  workers: CI ? 1 : undefined,
  retries: CI ? 0 : 0,

  // Where artifacts go (Jenkins archives this)
  outputDir: 'test-results',

  // Reporters
  reporter: [
    ['line'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  // Global timeouts (env overrides for CI)
  timeout: process.env.PW_TIMEOUT_MS ? Number(process.env.PW_TIMEOUT_MS) : 30_000,
  expect: {
    timeout: process.env.PW_EXPECT_TIMEOUT_MS ? Number(process.env.PW_EXPECT_TIMEOUT_MS) : 10_000,
  },

  use: {
    // Always headless on CI unless PWDEBUG=1
    headless: process.env.PWDEBUG === '1' ? false : true,

    baseURL: process.env.BASE_URL || undefined,

    // More generous navigation, unlimited actions unless overridden
    navigationTimeout: process.env.PW_NAV_TIMEOUT_MS ? Number(process.env.PW_NAV_TIMEOUT_MS) : 60_000,
    actionTimeout: process.env.PW_ACTION_TIMEOUT_MS ? Number(process.env.PW_ACTION_TIMEOUT_MS) : 0,

    // Keep artifacts for debugging failures
    trace: CI ? 'retain-on-failure' : 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    // Stable in Docker/rooted CI
    launchOptions: {
      // Do NOT set channel on CI; Chromium bundled by Playwright is used.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
      ],
    },
  },

  projects: [
    // Primary target used by Jenkins (--project=chromium)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Extra browsers only for local runs (not CI)
    ...(!CI
      ? [
          {
            name: 'Google Chrome',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' },
          },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
