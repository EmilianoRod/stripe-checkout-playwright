import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',

  // Safety in CI
  forbidOnly: CI,
  retries: CI ? 0 : 0,                 // keep fast iterations; raise if you want auto-retry
  workers: CI ? 1 : undefined,

  // Where Playwright will put traces/screenshots/videos (Jenkins archives this)
  outputDir: 'test-results',

  // Reporters: keep console line + HTML (don’t try to open it in CI)
  reporter: [
    ['line'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  // Global timeouts
  // PW_TIMEOUT_MS (milliseconds) can override from env (Jenkins sets it easily)
  timeout: process.env.PW_TIMEOUT_MS ? Number(process.env.PW_TIMEOUT_MS) : 30_000,

  use: {
    // Default to headless in CI; if you export PWDEBUG=1, it’ll run headed
    headless: CI && process.env.PWDEBUG !== '1',

    // Useful in Docker / root environments
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },

    // Optional, if your tests use it
    baseURL: process.env.BASE_URL || undefined,

    // Artifacts
    trace: CI ? 'on' : 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Projects
  projects: [
    // Primary target for CI and your bridge
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Only expose Google Chrome locally (channel requires Chrome installed
    // and can be problematic on CI / older PW)
    ...(!CI
      ? [{
          name: 'Google Chrome',
          use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        }]
      : []),

    // Keep these if you run them locally; your Jenkins job passes --project=chromium anyway
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
