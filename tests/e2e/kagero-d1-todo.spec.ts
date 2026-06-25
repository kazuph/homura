import { expect, test } from '@playwright/test';

const baseURL = process.env.KAGERO_BASE_URL || 'http://127.0.0.1:8789';

test('Kagero TODO uses hidden Inertia runtime for forms, partial reload, and history', async ({ page }) => {
  const title = `kagero-e2e-${Date.now()}`;
  const inertiaRequests: Array<{ url: string; partial: string | null }> = [];

  page.on('request', (request) => {
    const headers = request.headers();
    if (headers['x-inertia'] === 'true') {
      inertiaRequests.push({
        url: request.url(),
        partial: headers['x-inertia-partial-data'] ?? null,
      });
    }
  });

  await page.goto(baseURL);
  await expect(page.getByRole('heading', { name: 'Ruby-way Inertia experience on Workers' })).toBeVisible();
  const initialDocumentNavigations = await page.evaluate(() => performance.getEntriesByType('navigation').length);

  await page.addStyleTag({ content: 'body::after { content: ""; display: block; height: 1200px; }' });
  await page.evaluate(() => window.scrollTo(0, 480));
  await page.evaluate(async () => {
    await window.Kagero.visit(window.location.href, { replace: true, preserveScroll: true });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByRole('alert')).toHaveText('タイトルは必須です');
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(initialDocumentNavigations);

  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByText(title)).toBeVisible();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(initialDocumentNavigations);
  expect(inertiaRequests.some((request) => request.url.endsWith('/todos'))).toBeTruthy();

  await page.getByRole('button', { name: 'Refresh stats' }).click();
  await expect.poll(() => inertiaRequests.some((request) => request.partial === 'stats')).toBeTruthy();

  const row = page.locator('.todo-item').filter({ hasText: title });
  await row.getByRole('button', { name: '完了' }).click();
  await expect(row.getByText('Done')).toBeVisible();
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(initialDocumentNavigations);

  await row.getByRole('button', { name: '削除' }).click();
  await expect(page.getByText(title)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(initialDocumentNavigations);

  await page.goBack();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.locator('.todo-item').filter({ hasText: title }).getByText('Done')).toBeVisible();
});
