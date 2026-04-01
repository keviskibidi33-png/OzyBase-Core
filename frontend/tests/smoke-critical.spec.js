import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'system@ozybase.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';

test('critical UI smoke: login + modules + authenticated project endpoints', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  await expect(page.getByPlaceholder('system@ozybase.local')).toBeVisible({ timeout: 15000 });
  await page.getByPlaceholder('system@ozybase.local').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('Enter your 32-char password').fill(ADMIN_PASSWORD);

  await page.getByRole('button', { name: /Establish Link/i }).click();
  await expect(page.getByText('MODULE ACTIVITY')).toBeVisible({ timeout: 20000 });

  await page.getByRole('button', { name: 'SQL Editor' }).click();
  await expect(page.getByRole('button', { name: /Run Query/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Table Editor' }).click();
  await expect(page.getByRole('button', { name: /Saved Views/i })).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Authentication' }).click();
  await page.getByRole('button', { name: 'Security Hub' }).click();
  await expect(page.getByText('Global Security')).toBeVisible({ timeout: 15000 });

  const projectKeysStatus = await page.evaluate(async () => {
    const token = localStorage.getItem('ozy_token');
    const res = await fetch('/api/project/keys', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return res.status;
  });

  expect(projectKeysStatus).toBe(200);
});
