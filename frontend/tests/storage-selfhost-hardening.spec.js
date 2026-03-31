import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@ozybase.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';
const MULTIPART_FILE_SIZE_MB = 66;

async function login(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByPlaceholder('system@ozybase.local').fill(ADMIN_EMAIL);
  await page.getByPlaceholder('Enter your 32-char password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /Establish Link/i }).click();
  await expect(page.getByText('MODULE ACTIVITY')).toBeVisible({ timeout: 20000 });
}

async function apiRequest(page, url, options = {}) {
  return page.evaluate(async ({ url, options }) => {
    const token = localStorage.getItem('ozy_token');
    const workspaceId = localStorage.getItem('ozy_workspace_id');
    const headers = new Headers(options.headers || {});

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (workspaceId) {
      headers.set('X-Workspace-Id', workspaceId);
    }
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, { ...options, headers });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body };
  }, { url, options });
}

async function runSQL(page, query) {
  return apiRequest(page, '/api/sql', {
    method: 'POST',
    body: JSON.stringify({ query }),
  });
}

test('storage self-host hardening: multipart upload + lifecycle sweep via UI', async ({ page }, testInfo) => {
  test.setTimeout(300000);

  const suffix = Date.now().toString().slice(-8);
  const bucketName = `qa_storage_${suffix}`;
  const fileName = `multipart-${suffix}.bin`;
  const filePath = testInfo.outputPath(fileName);
  const fileBytes = MULTIPART_FILE_SIZE_MB * 1024 * 1024;

  await fs.writeFile(filePath, Buffer.alloc(fileBytes, 65));
  await login(page);

  try {
    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create bucket' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Create bucket' }).click();

    const bucketModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByPlaceholder('e.g. customer-assets') });
    await bucketModal.getByPlaceholder('e.g. customer-assets').fill(bucketName);
    await bucketModal.locator('input[type="number"]').nth(0).fill('80');
    await bucketModal.locator('input[type="number"]').nth(1).fill('90');
    await bucketModal.locator('input[type="number"]').nth(2).fill('1');
    await bucketModal.getByRole('button', { name: /^Create bucket$/i }).click();

    const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') });
    await expect(bucketButton).toBeVisible({ timeout: 20000 });
    await bucketButton.click();

    await page.locator('input[type="file"]').setInputFiles(filePath);

    await expect.poll(async () => {
      const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
      if (!filesRes.ok || !Array.isArray(filesRes.body)) {
        return 0;
      }
      return filesRes.body.length;
    }, { timeout: 120000, intervals: [1000, 2000, 4000] }).toBeGreaterThanOrEqual(1);

    const bucketRes = await apiRequest(page, `/api/files/buckets/${bucketName}`);
    expect(bucketRes.ok).toBe(true);
    expect(bucketRes.body?.max_file_size_bytes).toBe(80 * 1024 * 1024);
    expect(bucketRes.body?.max_total_size_bytes).toBe(90 * 1024 * 1024);
    expect(bucketRes.body?.lifecycle_delete_after_days).toBe(1);

    const backdateRes = await runSQL(page, `
      UPDATE _v_storage_objects
      SET created_at = NOW() - INTERVAL '2 days'
      WHERE bucket_id IN (SELECT id FROM _v_buckets WHERE name = '${bucketName}')
        AND name = '${fileName}'
      RETURNING id
    `);
    expect(backdateRes.ok).toBe(true);

    await page.getByRole('button', { name: /Run sweep/i }).click();

    await expect.poll(async () => {
      const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
      if (!filesRes.ok || !Array.isArray(filesRes.body)) {
        return -1;
      }
      return filesRes.body.length;
    }, { timeout: 30000, intervals: [1000, 2000, 4000] }).toBe(0);
  } finally {
    await apiRequest(page, `/api/files/buckets/${bucketName}`, { method: 'DELETE' });
    await fs.unlink(filePath).catch(() => {});
  }
});
