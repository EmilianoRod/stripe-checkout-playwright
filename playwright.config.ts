// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const CI = !!process.env.CI;

// Headed by default (human-looking). Set PW_HEADLESS=1 to force headless.
const HEADLESS =
  process.env.PW_HEADLESS !== undefined
    ? ['1', 'true', 'yes'].includes(String(process.env.PW_HEADLESS).toLowerCase())
    : false;

// Optional human-like pacing (e.g., PW_SLOWMO=25)
const SLOWMO = process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : (CI ? 10 : 0);

// Persisted storage — use env if provided, else default inside repo
const STORAGE_STATE = process.env.PW_STORAGE_STATE || 'test-results/storage/state.json';

// --- Timeouts (env can override) ---
const TEST_TIMEOUT   = Number(process.env.PW_TIMEOUT_MS        ?? 60_000);
const EXPECT_TIMEOUT = Number(process.env.PW_EXPECT_TIMEOUT_MS ?? 5_000);
const NAV_TIMEOUT    = Number(process.env.PW_NAV_TIMEOUT_MS    ?? 15_000);
const ACTION_TIMEOUT = Number(process.env.PW_ACTION_TIMEOUT_MS ?? 10_000);

// Locale / timezone (look like a US desktop shopper unless overridden)
const TIMEZONE = process.env.PW_TZ     || 'America/New_York';
const LOCALE   = process.env.PW_LOCALE || 'en-US';

// Realistic UA for stable Chrome 140 (override with PW_UA if you want)
const USER_AGENT =
  process.env.PW_UA ||
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

// Languages header (Stripe looks at this + locale)
const ACCEPT_LANGUAGE = process.env.PW_ACCEPT_LANGUAGE || `${LOCALE},en;q=0.9`;

// Optional: force a stable viewport & DPR (avoid ultra-small headless defaults)
const VIEWPORT = { width: 1366, height: 900 } as const;

export default defineConfig({
  // Seed cookies/localStorage across runs (only if you have this file)
  globalSetup: require.resolve('./global-setup'),

  testDir: './tests',
  forbidOnly: CI,
  workers: CI ? 1 : undefined,
  retries: CI ? 0 : 0, // retries can look botty; keep 0 for Stripe

  outputDir: 'test-results',
  reporter: [
    ['line'],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  // Suite-level timeout + expect timeout
  timeout: TEST_TIMEOUT,
  expect: { timeout: EXPECT_TIMEOUT },

  use: {
    // --- Real-user optics / anti-bot hygiene ---
    headless: HEADLESS,
    channel: 'chrome',
    locale: LOCALE,
    timezoneId: TIMEZONE,
    colorScheme: 'light',
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    userAgent: USER_AGENT,

    // Persist context between runs (cookies, etc.)
    storageState: STORAGE_STATE,

    // Network/navigation
    baseURL: process.env.BASE_URL || undefined,
    extraHTTPHeaders: {
      'Accept-Language': ACCEPT_LANGUAGE,
    },

    // Timeouts
    navigationTimeout: NAV_TIMEOUT,
    actionTimeout: ACTION_TIMEOUT,

    // Artifacts
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',

    launchOptions: {
      slowMo: SLOWMO || undefined,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  },

  projects: [
    // Map Jenkins’ `--project=chromium` to real Chrome
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },

    // Optional local cross-browser checks (disabled on CI)
    ...(!CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit',  use: { ...devices['Desktop Safari']  } },
        ]
      : []),

    // 🔒 Stripe Checkout project (persistent profile, headed, 1 worker)
    {
      name: 'stripe-ci',
      fullyParallel: false,
      workers: 1,
      use: {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1366, height: 768 },
        locale: LOCALE,
        timezoneId: TIMEZONE,
        colorScheme: 'light',
        userAgent: USER_AGENT,
        userDataDir: '.pw-profile/stripe',
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
      },
    },
  ],
});
