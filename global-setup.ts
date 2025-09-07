// global-setup.ts
import { chromium, FullConfig, BrowserContext } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export default async function globalSetup(_config: FullConfig) {
  const storage = process.env.PW_STORAGE_STATE || 'test-results/storage/state.json';
  const abs = path.resolve(storage);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  // Re-seed when missing or explicitly requested
  const FORCE = ['1', 'true', 'yes'].includes(String(process.env.PW_RESEED_STATE || '').toLowerCase());
  if (fs.existsSync(abs) && !FORCE) return;

  const HEADLESS =
    process.env.PW_HEADLESS !== undefined
      ? ['1', 'true', 'yes'].includes(String(process.env.PW_HEADLESS).toLowerCase())
      : false;

  const LOCALE   = process.env.PW_LOCALE || 'en-US';
  const TIMEZONE = process.env.PW_TZ     || 'America/New_York';
  const USER_AGENT =
    process.env.PW_USER_AGENT ||
    // Stable desktop Chrome UA; matches the Playwright config’s general profile
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/140.0.0.0 Safari/537.36';
  const ACCEPT_LANGUAGE = process.env.PW_ACCEPT_LANGUAGE || `${LOCALE},en;q=0.9`;

  const browser = await chromium.launch({ headless: HEADLESS, channel: 'chrome' });

  // Keep this context minimal and realistic; we only want benign cookies & prefs.
  const context = await browser.newContext({
    locale: LOCALE,
    timezoneId: TIMEZONE,
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': ACCEPT_LANGUAGE,
    },
  });

  const page = await context.newPage();

  // --- Light-touch warmup across Stripe origins ---
  // 1) Main site
  await page.goto('https://stripe.com/', { waitUntil: 'domcontentloaded' });
  await humanish(page);

  // 2) Stripe JS origin (often sets benign cookies / cache)
  await page.goto('https://js.stripe.com/v3/', { waitUntil: 'load' }).catch(() => {});
  await humanish(page);

  // 3) m.stripe.network preview (used by Checkout for message bus/preview)
  await page.goto('https://m.stripe.network/inner-preview.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await humanish(page);

  // 4) Checkout domain shell (no real session, just origin warm-up)
  await page.goto('https://checkout.stripe.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await humanish(page);

  // Persist whatever benign cookies/localStorage we picked up
  await context.storageState({ path: abs });
  await browser.close();
}

/** Small gestures to avoid “zero-interaction robot” vibes; safe in headless or headed. */
async function humanish(ctx: BrowserContext | any) {
  const page = 'newPage' in ctx ? await ctx.newPage() : ctx;
  try {
    await page.mouse.move(200 + rand(150), 180 + rand(140));
    await page.mouse.wheel(0, 300 + rand(200));
    await page.waitForTimeout(300 + rand(350));
  } catch {
    // ignore
  } finally {
    if ('close' in page && typeof page.close === 'function') {
      try { await page.close(); } catch {}
    }
  }
}

function rand(n: number) {
  return Math.floor(Math.random() * n);
}
