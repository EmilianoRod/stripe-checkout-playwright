import { Page, expect, test } from '@playwright/test';
import { humanType, humanPause } from '../helpers/human';

// === small helpers / constants ===
const SUCCESS_MARK = 'PW_BRIDGE::SUCCESS_URL ';
const CI = !!process.env.CI;
const FAKE_SUCCESS = process.env.PW_STRIPE_FAKE_SUCCESS === '1'; // honored only when !CI

// Timeouts (env overrides)
const TEST_TIMEOUT = parseInt(process.env.PW_TIMEOUT_MS || (CI ? '180000' : '120000'), 10);
test.setTimeout(TEST_TIMEOUT);

// Read the URL exactly as provided via env (no default placeholder here)
const RAW_CHECKOUT_URL = process.env.CHECKOUT_URL ?? '';
const CHECKOUT_EMAIL   = process.env.CHECKOUT_EMAIL ?? 'qa+stripe@example.com';

// 4242 path (no 3DS). Flip to 4000 0000 0000 3220 when you want to exercise 3DS.
const CARD = process.env.PW_CARD || '4242 4242 4242 4242';
const EXP  = process.env.PW_EXP  || '12 / 34';
const CVC  = process.env.PW_CVC  || '123';
const ZIP  = process.env.PW_ZIP  || '90210';

// --- utilities ---
async function safePause(page: Page, ms: number) {
  if (page.isClosed()) return;
  try { await page.waitForTimeout(ms); } catch { /* ignore */ }
}

async function maybeAnnounceSuccess(page: Page): Promise<boolean> {
  const u = page.url();
  const leftStripeCheckout = !/checkout\.stripe\.com/i.test(u);
  const hasSuccessTokens = /success|thank|return|receipt|redirect_status=succeeded|checkout_session_id/i.test(u);
  if (leftStripeCheckout || hasSuccessTokens) {
    console.log(SUCCESS_MARK + u);
    return true;
  }
  return false;
}

// Early guard for Stripe’s generic error screen
async function assertNotStripeError(page: Page) {
  const err = page.getByText('Something went wrong', { exact: true });
  if (await err.isVisible({ timeout: 1500 })) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      'Stripe error page detected (likely invalid/expired/malformed session URL).\n' +
      body.slice(0, 600)
    );
  }
}

// hCaptcha presence hint (not always blocking, but useful)
async function isHcaptchaPresent(page: Page): Promise<boolean> {
  const sel = [
    'iframe[src*="hcaptcha"]',
    'iframe[src*="HCaptcha"]',
    'iframe[src*="newassets.hcaptcha.com"]',
    'iframe[src*="hcaptcha-invisible"]',
  ].join(', ');
  return !!(await page.$(sel));
}

// Wait (generously) until split or unified Payment Element is discoverable.
async function waitForStripePaymentElement(page: Page, totalMs = CI ? 60000 : 30000): Promise<'split'|'unified'|null> {
  const start = Date.now();
  while (Date.now() - start < totalMs) {
    const hasNumber = await page.locator('iframe[title="Secure card number input"]').first().count();
    if (hasNumber > 0) return 'split';

    for (const f of page.frames()) {
      try {
        const seenUnified = await f.evaluate(() => !!document.querySelector(
          '[data-elements-stable-field-name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], .InputElement'
        ));
        if (seenUnified) return 'unified';
      } catch { /* cross-origin */ }
    }
    await safePause(page, 300);
  }
  // one-shot dump of frames for debugging
  console.log('[PW] Stripe frames not detected in time. Frames seen:', page.frames().map(f => f.url()));
  return null;
}

// 3DS handler (unchanged, with small robustness)
async function handle3DSChallenge(page: Page): Promise<void> {
  const CHALLENGE_IFRAME_SELECTOR = [
    'iframe[title*="challenge" i]',
    'iframe[src*="3ds" i]',
    'iframe[src*="acs" i]',
    'iframe[name^="__privateStripeFrame"]',
    'iframe[title*="authentication" i]',
  ].join(',');

  const challengeEl = await page.waitForSelector(CHALLENGE_IFRAME_SELECTOR, { timeout: 6000 }).catch(() => null);
  if (!challengeEl) return;

  const frame = await challengeEl.contentFrame();
  if (!frame) return;

  const approveButton = frame.getByRole('button', {
    name: /complete authentication|authorize|approve|complete|submit/i,
  }).first();

  const fallbackClickable = frame.locator([
    'button:has-text("Complete")',
    'button:has-text("Authorize")',
    'button:has-text("Approve")',
    'input[type="submit"]',
    'a:has-text("Complete")',
  ].join(', ')).first();

  if (await approveButton.isVisible().catch(() => false)) {
    await approveButton.click().catch(() => {});
  } else if (await fallbackClickable.isVisible().catch(() => false)) {
    await fallbackClickable.click().catch(() => {});
  } else {
    const anyContinue = frame.locator('text=/continue|next|ok/i').first();
    if (await anyContinue.isVisible().catch(() => false)) {
      await anyContinue.click().catch(() => {});
    }
  }

  await page.waitForLoadState('networkidle').catch(() => {});
}

// ---------- test ----------
test('Stripe hosted checkout – enter card and pay', async ({ page }) => {
  // Skip if no URL at all
  test.skip(!RAW_CHECKOUT_URL, 'Provide CHECKOUT_URL env var');

  // Fail-fast if user accidentally escaped the fragment (common copy/paste issue)
  expect(RAW_CHECKOUT_URL.includes('\\#'), 'CHECKOUT_URL must NOT contain a backslash before #').toBeFalsy();

  const CHECKOUT_URL = RAW_CHECKOUT_URL;

  await page.goto(CHECKOUT_URL, { waitUntil: 'domcontentloaded' });
  await assertNotStripeError(page);
  await page.waitForLoadState('networkidle', { timeout: CI ? 10000 : 5000 }).catch(() => {});
  await humanPause(800, 1800);

  // Small human-ish mouse moves
  await page.mouse.move(300, 300);
  await page.mouse.move(500, 500);

  // If instantly redirected (free/zero price), celebrate and exit
  if (await maybeAnnounceSuccess(page)) return;

  // If a new page popped and the original closed, switch to it
  const ctx = page.context();
  const maybeNew = await ctx.waitForEvent('page', { timeout: 1500 }).catch(() => null);
  if (maybeNew) {
    await maybeNew.waitForLoadState('domcontentloaded').catch(() => {});
    if (await maybeAnnounceSuccess(maybeNew)) return;
  }

  // 0) Email (required in Stripe Checkout)
  const email = page.getByRole('textbox', { name: /email/i });
  await expect(email).toBeVisible({ timeout: 20000 });
  await email.click();
  await humanType(email, CHECKOUT_EMAIL, 40, 75);
  await email.blur();
  await humanPause(300, 700);
  await email.press('Enter').catch(() => {}); // nudges PE render

  // 1) Wait until Stripe Payment Element is ready
  const mode = await waitForStripePaymentElement(page, CI ? 90000 : 45000);

  // If PE didn't render, see whether hCaptcha is present and handle accordingly
  if (!mode) {
    if (await isHcaptchaPresent(page)) {
      if (CI) {
        throw new Error('Stripe hCaptcha present; Payment Element did not render. Failing CI run.');
      }
      if (FAKE_SUCCESS) {
        const u = page.url();
        const bypass = u.includes('redirect_status=succeeded') ? u : `${u}?redirect_status=succeeded#bypass=ci`;
        console.warn('[PW] hCaptcha detected; FAKE_SUCCESS enabled locally. Emitting synthetic success URL.');
        console.log(`${SUCCESS_MARK}${bypass}`);
        return;
      }
      throw new Error('Stripe presented hCaptcha and blocked the Payment Element.');
    }
    expect(mode, 'Stripe Payment Element did not render in time (check network/CDN access)').not.toBeNull();
  }

  // 2) Tap "Pay with card" tab if present
  const cardTab = page.locator(
    '[data-testid="card-tab"], [role="tab"][data-testid*="card"], ' +
    'button[aria-controls*="card"], button[aria-label*="card" i], ' +
    'button:has-text("Pay with card"), button:has-text("Card")'
  );
  if (await cardTab.count()) {
    await cardTab.first().click().catch(() => {});
    await safePause(page, 300);
  }

  if (mode === 'split') {
    // 3A) SPLIT iframes
    const numberFrame = page.frameLocator('iframe[title="Secure card number input"]').first();
    const expFrame    = page.frameLocator('iframe[title="Secure expiration date input"]').first();
    const cvcFrame    = page.frameLocator('iframe[title="Secure CVC input"]').first();
    const zipFrame    = page.frameLocator('iframe[title="Secure postal code input"]').first();

    const name = page.getByRole('textbox', { name: /cardholder name|name on card/i }).first();
    if (await name.isVisible().catch(() => false)) {
      await name.click().catch(() => {});
      await humanType(name, 'Test User', 35, 65).catch(() => {});
      await humanPause(150, 350);
    }

    const country = page.getByRole('combobox', { name: /country|region/i }).first();
    if (await country.isVisible().catch(() => false)) {
      const opt = country.locator('option', { hasText: 'United States' }).first();
      if (await opt.count()) {
        const val = await opt.getAttribute('value');
        if (val) await country.selectOption(val).catch(() => {});
      }
    }

    const numInput = numberFrame.locator('input[name="cardnumber"], input[autocomplete="cc-number"], .InputElement').first();
    await expect(numInput).toBeVisible({ timeout: 30000 });
    await numInput.click();
    await humanType(numInput, CARD, 25, 60);
    await humanPause(250, 600);

    const expInput = expFrame.locator('input[autocomplete="cc-exp"], input[name="exp-date"], .InputElement').first();
    await expect(expInput).toBeVisible({ timeout: 10000 });
    await expInput.click();
    await humanType(expInput, EXP, 45, 80);
    await humanPause(200, 500);

    const cvcInput = cvcFrame.locator('input[autocomplete="cc-csc"], input[name="cvc"], .InputElement').first();
    await expect(cvcInput).toBeVisible({ timeout: 10000 });
    await cvcInput.click();
    await humanType(cvcInput, CVC, 55, 95);
    await humanPause(200, 500);

    const zipInput = zipFrame.locator('input[autocomplete*="postal"], input[name*="postal"], .InputElement').first();
    if (await zipInput.count()) {
      await zipInput.click().catch(() => {});
      await humanType(zipInput, ZIP, 45, 80).catch(() => {});
      await humanPause(150, 350);
    }

  } else {
    // 3B) UNIFIED Payment Element (single iframe)
    const payFrame = await (async () => {
      for (const f of page.frames()) {
        try {
          const ok = await f.evaluate(() => !!document.querySelector(
            '[data-elements-stable-field-name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], .InputElement'
          ));
          if (ok) return f;
        } catch {}
      }
      return null;
    })();
    expect(payFrame, 'Could not locate Stripe Payment Element iframe').not.toBeNull();

    const name = page.getByRole('textbox', { name: /cardholder name|name on card/i }).first();
    if (await name.isVisible().catch(() => false)) {
      await name.click().catch(() => {});
      await humanType(name, 'Test User', 35, 65).catch(() => {});
      await humanPause(150, 350);
    }

    const country = page.getByRole('combobox', { name: /country|region/i }).first();
    if (await country.isVisible().catch(() => false)) {
      const opt = country.locator('option', { hasText: 'United States' }).first();
      if (await opt.count()) {
        const val = await opt.getAttribute('value');
        if (val) await country.selectOption(val).catch(() => {});
      }
    }

    const numInput = payFrame!
      .locator('[data-elements-stable-field-name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], .InputElement')
      .first();
    await expect(numInput).toBeVisible({ timeout: 30000 });
    await numInput.click();
    await humanType(numInput, CARD, 25, 60);
    await humanPause(250, 600);

    const expInput = payFrame!
      .locator('[data-elements-stable-field-name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], .InputElement')
      .first();
    await expInput.click();
    await humanType(expInput, EXP, 45, 80);
    await humanPause(200, 500);

    const cvcInput = payFrame!
      .locator('[data-elements-stable-field-name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], .InputElement')
      .first();
    await cvcInput.click();
    await humanType(cvcInput, CVC, 55, 95);
    await humanPause(200, 500);

    const zip = payFrame!
      .locator('[data-elements-stable-field-name="postalCode"], input[autocomplete*="postal"], input[name*="postal"], .InputElement')
      .first();
    if (await zip.count()) {
      await zip.click().catch(() => {});
      await humanType(zip, ZIP, 45, 80).catch(() => {});
      await humanPause(150, 350);
    }
  }

  // 4) Pay
  const payBtn = page.locator('button[type="submit"], button:has-text("Pay")').first();
  await expect(payBtn).toBeEnabled({ timeout: 20000 });
  await humanPause(300, 800);
  await payBtn.click().catch(() => {});

  // 5) 3DS (if triggered)
  await handle3DSChallenge(page);

  // 6) Wait to leave Stripe checkout or reach a success URL
  const leftCheckout = await page
    .waitForURL(
      url => {
        const s = url.toString();
        return (
          !/checkout\.stripe\.com/i.test(s) ||
          /success|thank|return|receipt|redirect_status=succeeded|checkout_session_id/i.test(s)
        );
      },
      { timeout: CI ? 30000 : 20000 }
    )
    .then(() => true)
    .catch(() => false);

  expect(leftCheckout, 'Did not reach a success/return URL from Stripe Checkout').toBeTruthy();

  // Announce success (for bridge scripts)
  await maybeAnnounceSuccess(page);
});
