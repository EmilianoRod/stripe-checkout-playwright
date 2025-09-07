// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// Headed by default (looks more like a real user).
// Set PW_HEADLESS=1 to force headless in any environment.
const HEADLESS =
  process.env.PW_HEADLESS !== undefined
    ? ['1', 'true', 'yes'].includes(String(process.env.PW_HEADLESS).toLowerCase())
    : false;

// Human-like pacing (optional). e.g. PW_SLOWMO=25
const SLOWMO = process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : undefined;

// Real Chrome channel by default (better consumer fingerprint).
const DEFAULT_CHANNEL = process.env.PW_CHANNEL || 'chrome';

// Persisted storage — default to a stable path if not provided via env
const STORAGE_STATE = process.env.PW_STORAGE_STATE || 'test-results/storage/state.json';

// Timeouts
const TEST_TIMEOUT   = process.env.PW_TIMEOUT_MS ? Number(process.env.PW_TIMEOUT_MS) : 30_000;
const EXPECT_TIMEOUT = process.env.PW_EXPECT_TIMEOUT_MS ? Number(process.env.PW_EXPECT_TIMEOUT_MS) : 10_000;
const NAV_TIMEOUT    = process.env.PW_NAV_TIMEOUT_MS ? Number(process.env.PW_NAV_TIMEOUT_MS) : 60_000;
const ACTION_TIMEOUT = process.env.PW_ACTION_TIMEOUT_MS ? Number(process.env.PW_ACTION_TIMEOUT_MS) : 0;

// Optional custom UA. If not set, Playwright/Chrome will supply a matching one (recommended).
const USER_AGENT = process.env.PW_USER_AGENT || undefined;

// Use an east-coast US timezone to match us-east-2 IP region.
const TIMEZONE = process.env.PW_TZ || 'America/New_York';

// Locale typically used by your tests.
const LOCALE = process.env.PW_LOCALE || 'en-US';

export default defineConfig({
  // 👇 seeds & reuses cookies/localStorage across runs
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
    // Make the context look like a real user device
    headless: HEADLESS,
    baseURL: process.env.BASE_URL || undefined,
    locale: LOCALE,
    timezoneId: TIMEZONE,
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,

    // 👇 persistent storage
    storageState: STORAGE_STATE,

    // Prefer real Chrome build
    channel: DEFAULT_CHANNEL,

    navigationTimeout: NAV_TIMEOUT,
    actionTimeout: ACTION_TIMEOUT,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    launchOptions: {
      ...(SLOWMO !== undefined ? { slowMo: SLOWMO } : {}),
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        // keep GPU enabled in headed mode (don’t add --disable-gpu)
      ],
    },

    ...(USER_AGENT ? { userAgent: USER_AGENT } : {}),
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: DEFAULT_CHANNEL,
      },
    },
    ...(!CI
      ? [
          { name: 'Google Chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
