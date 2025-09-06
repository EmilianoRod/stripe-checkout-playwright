import { Frame, Page, expect, test } from '@playwright/test';

// Give CI more time
test.setTimeout(parseInt(process.env.PW_TIMEOUT_MS || '120000', 10));
const SUCCESS_MARK = 'PW_BRIDGE::SUCCESS_URL ';

// Helper: if we landed on a success/return URL, announce it and exit happy
async function maybeAnnounceSuccess(page: import('@playwright/test').Page): Promise<boolean> {
  const u = page.url();
  if (/success|thank|return|redirect_status=succeeded|checkout_session_id/.test(u)) {
    console.log(SUCCESS_MARK + u);
    return true;
  }
  return false;
}



const CHECKOUT_URL = process.env.CHECKOUT_URL ?? 'https://example.com/stripe-checkout';
const TEST_EMAIL = process.env.CHECKOUT_EMAIL ?? 'qa+stripe@example.com';

// Use 4242 for the no-3DS path; swap to a 3DS card when you want to exercise the challenge flow:
// const CARD = '4000002760003184'; // 3DS2 — always requires authentication
const CARD = '4242424242424242';
const EXP = '0134';
const CVC = '123';
const ZIP = '90210';

test('Stripe hosted checkout – enter card and pay', async ({ page }) => {
        test.skip(!CHECKOUT_URL, 'Provide CHECKOUT_URL env var');

        await page.goto(CHECKOUT_URL, { waitUntil: 'load' });

        // If the checkout immediately redirected (e.g., $0 price), treat it as success
        if (await maybeAnnounceSuccess(page)) return;

        // If checkout closed and a new page opened, switch to it and re-check
        const ctx = page.context();
        const maybeNew = await ctx.waitForEvent('page', { timeout: 1500 }).catch(() => null);
        if (maybeNew) {
          await maybeNew.waitForLoadState('domcontentloaded');
          if (await maybeAnnounceSuccess(maybeNew)) return;
        }

        // 0) Email (required in Stripe Checkout)
        const email = page.getByRole('textbox', { name: /email/i });
        await expect(email).toBeVisible({ timeout: 10000 });
        await email.fill(TEST_EMAIL);
        await email.press('Enter'); // optional, speeds up Payment Element render

        // 1) Wait for iframes to exist at all
        await expect(async () => {
                expect(await page.locator('iframe').count()).toBeGreaterThan(0);
        }).toPass({ timeout: 15000 });

        // 2) If a "Pay with card" tab exists, open it (no-op otherwise)
        const cardTab = page.locator(
                '[data-testid="card-tab"], [role="tab"][data-testid*="card"], button[aria-controls*="card"], button[aria-label*="card"]'
        );
        if (await cardTab.count()) {
                try { await cardTab.first().click(); } catch { /* ignore */ }
                await page.waitForTimeout(300);
        }

        // 3) Prefer SPLIT iframes (most robust path)
        const numberFrameLoc = page.locator('iframe[title="Secure card number input"]').first();
        const hasNumberFrame = (await numberFrameLoc.count()) > 0;

        if (hasNumberFrame) {
                const numberFrame = page.frameLocator('iframe[title="Secure card number input"]').first();
                const expFrame = page.frameLocator('iframe[title="Secure expiration date input"]').first();
                const cvcFrame = page.frameLocator('iframe[title="Secure CVC input"]').first();
                const zipFrame = page.frameLocator('iframe[title="Secure postal code input"]').first();

                // Optional outside-the-iframe fields
                const name = page.getByRole('textbox', { name: /cardholder name|name on card/i });
                if (await name.isVisible()) await name.fill('Test User');

                const country = page.getByRole('combobox', { name: /country|region/i });
                if (await country.isVisible()) {
                        const opt = country.locator('option', { hasText: 'United States' }).first();
                        if (await opt.count()) {
                                const val = await opt.getAttribute('value');
                                if (val) await country.selectOption(val).catch(() => { });
                        }
                }

                // Card number
                const numInput = numberFrame.locator('input[name="cardnumber"], input[autocomplete="cc-number"], .InputElement').first();
                await expect(numInput).toBeVisible({ timeout: 15000 });
                await numInput.click();
                await numInput.fill(CARD);

                // Expiry
                const expInput = expFrame.locator('input[autocomplete="cc-exp"], input[name="exp-date"], .InputElement').first();
                await expect(expInput).toBeVisible();
                await expInput.fill(EXP);

                // CVC
                const cvcInput = cvcFrame.locator('input[autocomplete="cc-csc"], input[name="cvc"], .InputElement').first();
                await expect(cvcInput).toBeVisible();
                await cvcInput.fill(CVC);

                // ZIP (if present)
                const zipInput = zipFrame.locator('input[autocomplete*="postal"], input[name*="postal"], .InputElement');
                if (await zipInput.count()) await zipInput.first().fill(ZIP);

        } else {
                await openCardTabIfPresent(page);

                // 4) UNIFIED Payment Element (single iframe)
                const payFrame = await findStripePaymentFrame(page);
                expect(payFrame, 'Could not locate Stripe Payment Element iframe').not.toBeNull();

                // Optional outside-the-iframe fields
                const name = page.getByRole('textbox', { name: /cardholder name|name on card/i });
                if (await name.isVisible()) await name.fill('Test User');

                const country = page.getByRole('combobox', { name: /country|region/i });
                if (await country.isVisible()) {
                        const opt = country.locator('option', { hasText: 'United States' }).first();
                        if (await opt.count()) {
                                const val = await opt.getAttribute('value');
                                if (val) await country.selectOption(val).catch(() => { });
                        }
                }

                // Card number
                const numInput = payFrame!
                        .locator('[data-elements-stable-field-name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], .InputElement')
                        .first();
                await expect(numInput).toBeVisible({ timeout: 15000 });
                await numInput.click();
                await numInput.fill(CARD);

                // Expiry
                const expiryInput = payFrame!
                        .locator('[data-elements-stable-field-name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], .InputElement')
                        .first();
                await expiryInput.focus();
                await expiryInput.fill(EXP);

                // CVC
                const cvcInput = payFrame!
                        .locator('[data-elements-stable-field-name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], .InputElement')
                        .first();
                await cvcInput.focus();
                await cvcInput.fill(CVC);

                // ZIP (only if present)
                const zip = payFrame!
                        .locator('[data-elements-stable-field-name="postalCode"], input[autocomplete*="postal"], input[name*="postal"], .InputElement');
                if (await zip.count()) {
                        const zipInput = zip.first();
                        await zipInput.focus();
                        await zipInput.fill(ZIP);
                }
        }

        // 5) Pay
        const payBtn = page.locator('button[type="submit"], button:has-text("Pay")');
        await expect(payBtn).toBeEnabled({ timeout: 10000 });
        await payBtn.click();

        // 6) 3DS (if triggered) — gated (no frame entry unless it exists)
        await handle3DSChallenge(page);

        // 7) Finish either way (success page or post-payment state)
        const leftCheckout = await page
                .waitForURL(
                        url =>
                                /success|thank|return|receipt/i.test(url.toString()) ||
                                !/checkout\.stripe\.com/i.test(url.toString()),
                        { timeout: 20000 }
                )
                .then(() => true)
                .catch(() => false);

        expect(leftCheckout, 'Did not reach a success/return URL from Stripe Checkout').toBeTruthy();

        // Hand back the final URL to the Java bridge
        console.log(`PW_BRIDGE::SUCCESS_URL ${page.url()}`);

        // ---------- helpers (nested) ----------
        async function openCardTabIfPresent(page: Page) {
                const cardTab = page.locator(
                        '[data-testid="card-tab"], [role="tab"][data-testid*="card"], ' +
                        'button[aria-controls*="card"], button[aria-label*="card" i], ' +
                        'button:has-text("Pay with card"), button:has-text("Card")'
                );
                if (await cardTab.count()) {
                        try { await cardTab.first().click(); } catch { /* ignore */ }
                        await page.waitForTimeout(300); // let Stripe re-render
                }
        }

        /** Find the correct Stripe inner Payment Element frame (skips express/hcaptcha/controller). */
        async function findStripePaymentFrame(page: Page): Promise<Frame | null> {
                // up to ~3 seconds total (10 * 300ms)
                for (let attempt = 0; attempt < 10; attempt++) {
                        await openCardTabIfPresent(page);
                        for (const f of page.frames()) {
                                try {
                                        const url = (f.url() || '').toLowerCase();
                                        if (url.includes('express-checkout') || url.includes('hcaptcha') || url.includes('controller')) continue;

                                        const hasCard = await f.evaluate(() =>
                                                !!document.querySelector(
                                                        '[data-elements-stable-field-name="cardNumber"],' +
                                                        'input[autocomplete="cc-number"], input[name="cardnumber"], .InputElement'
                                                )
                                        );
                                        if (hasCard) return f;
                                } catch { /* ignore cross-origin */ }
                        }
                        await page.waitForTimeout(300);
                }
                return null;
        }

        /** Handle Stripe 3DS challenge if it appears; noop if it doesn’t. */
        async function handle3DSChallenge(page: Page): Promise<void> {
                const CHALLENGE_IFRAME_SELECTOR = [
                        'iframe[title*="challenge" i]',
                        'iframe[src*="3ds" i]',
                        'iframe[src*="acs" i]',
                        'iframe[name^="__privateStripeFrame"]',
                        'iframe[title*="authentication" i]',
                ].join(',');

                // Wait up to 6s for a 3DS challenge to show (many flows won’t show one)
                const challengeEl = await page.waitForSelector(CHALLENGE_IFRAME_SELECTOR, { timeout: 6000 }).catch(() => null);
                if (!challengeEl) return;

                const frame = await challengeEl.contentFrame();
                if (!frame) return;

                // Try a few common button labels
                const approveButton = frame.getByRole('button', {
                        name: /complete authentication|authorize|approve|complete|submit/i,
                }).first();

                const fallbackClickable = frame.locator(
                        [
                                'button:has-text("Complete")',
                                'button:has-text("Authorize")',
                                'button:has-text("Approve")',
                                'input[type="submit"]',
                                'a:has-text("Complete")',
                        ].join(', ')
                ).first();

                if (await approveButton.isVisible().catch(() => false)) {
                        await approveButton.click();
                } else if (await fallbackClickable.isVisible().catch(() => false)) {
                        await fallbackClickable.click();
                } else {
                        const anyContinue = frame.locator('text=/continue|next|ok/i').first();
                        if (await anyContinue.isVisible().catch(() => false)) {
                                await anyContinue.click();
                        }
                }

                // Give it a moment to return control
                await page.waitForLoadState('networkidle').catch(() => { });
        }
});
