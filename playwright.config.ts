// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// Headed by default (looks more like a real user). Set PW_HEADLESS=1 to force headless.
const HEADLESS =
  process.env.PW_HEADLESS !== undefined
    ? ['1', 'true', 'yes'].includes(String(process.env.PW_HEADLESS).toLowerCase())
    : false;

// Optional human-like pacing (e.g., PW_SLOWMO=25)
const SLOWMO = process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : 0;

// Persisted storage — use env if provided, else default inside repo
const STORAGE_STATE = process.env.PW_STORAGE_STATE || 'test-results/storage/state.json';
git add
// Timeouts (env overrides)
const TEST_TIMEOUT   = process.env.PW_TIMEOUT_MS        ? Number(process.env.PW_TIMEOUT_MS)        : 180_000;
const EXPECT_TIMEOUT = process.env.PW_EXPECT_TIMEOUT_MS ? Number(process.env.PW_EXPECT_TIMEOUT_MS) : 10_000;
const NAV_TIMEOUT    = process.env.PW_NAV_TIMEOUT_MS    ? Number(process.env.PW_NAV_TIMEOUT_MS)    : 60_000;
const ACTION_TIMEOUT = process.env.PW_ACTION_TIMEOUT_MS ? Number(process.env.PW_ACTION_TIMEOUT_MS) : 0;

// Locale / timezone
const TIMEZONE = process.env.PW_TZ     || 'America/New_York';
const LOCALE   = process.env.PW_LOCALE || 'en-US';

export default defineConfig({
  // Seed cookies/localStorage across runs
  globalSetup: require.resolve('./global-setup'),

  testDir: './tests',
  forbidOnly: CI,
  workers: CI ? 1 : undefined,
  retries: CI ? 0 : 0,

  outputDir: 'test-results',
  reporter: [
    ['line'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  timeout: TEST_TIMEOUT,
  expect: { timeout: EXPECT_TIMEOUT },

  use: {
    headless: HEADLESS,
    baseURL: process.env.BASE_URL || undefined,
    locale: LOCALE,
    timezoneId: TIMEZONE,

    // Persist context between runs (cookies, etc.)
    storageState: STORAGE_STATE,

    // Sensible desktop viewport
    viewport: { width: 1366, height: 800 },
    deviceScaleFactor: 1,

    navigationTimeout: NAV_TIMEOUT,
    actionTimeout: ACTION_TIMEOUT,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    launchOptions: {
      slowMo: SLOWMO || undefined,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // do NOT add --disable-gpu (hurts realism)
      ],
    },
  },

  projects: [
    {
      // Keep Jenkins happy: it still runs `--project=chromium`,
      // but this project uses **real Google Chrome**.
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome', // << run the consumer Chrome build
      },
    },

    // Extra local projects (not used on CI)
    ...(!CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
        ]
      : []),
  ],
});
