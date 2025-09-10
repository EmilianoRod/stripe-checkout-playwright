import { Page } from '@playwright/test';

export async function assertNotStripeError(page: Page) {
  const err = page.getByText('Something went wrong', { exact: true });
  if (await err.isVisible({ timeout: 1500 })) {
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Stripe error page detected (likely invalid/expired/malformed session URL).\n` +
      body.slice(0, 600)
    );
  }
}
