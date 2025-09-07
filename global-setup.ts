// global-setup.ts
import { chromium, FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export default async function globalSetup(_config: FullConfig) {
  const storage = process.env.PW_STORAGE_STATE || 'test-results/storage/state.json';
  const abs = path.resolve(storage);
  fs.mkdirSync(path.dirname(abs), { recursive: true });

  if (!fs.existsSync(abs)) {
    const browser = await chromium.launch({ headless: false, channel: 'chrome' });
    const context = await browser.newContext({
      locale: process.env.PW_LOCALE || 'en-US',
      timezoneId: process.env.PW_TZ || 'America/New_York',
      userAgent:
        process.env.PW_USER_AGENT ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();
    await page.goto('https://stripe.com');
    await page.waitForTimeout(1500);
    await context.storageState({ path: abs });
    await browser.close();
  }
}
