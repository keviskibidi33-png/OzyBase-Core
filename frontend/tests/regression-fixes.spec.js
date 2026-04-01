import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'system@ozybase.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';

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

        return {
            ok: response.ok,
            status: response.status,
            body,
        };
    }, { url, options });
}

async function runSQL(page, query) {
    return apiRequest(page, '/api/sql', {
        method: 'POST',
        body: JSON.stringify({ query }),
    });
}

test('regression fixes: csv import, bucket actions, auth menu and MCP discoverability', async ({ page }) => {
    test.setTimeout(300000);

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `qa_import_${qaSuffix}`;
    const bucketName = `qa_bucket_${qaSuffix}`;

    await login(page);

    try {
        const createTableRes = await apiRequest(page, '/api/collections', {
            method: 'POST',
            body: JSON.stringify({
                name: tableName,
                display_name: tableName,
                schema: [
                    { name: 'name', type: 'text', required: false, unique: false, is_primary: false, references: null },
                    { name: 'total', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                    { name: 'active', type: 'bool', required: false, unique: false, is_primary: false, references: null },
                    { name: 'joined_at', type: 'timestamp', required: false, unique: false, is_primary: false, references: null },
                ],
                rls_enabled: false,
                rls_rule: '',
                rls_policies: {},
                realtime_enabled: false,
            }),
        });
        expect(createTableRes.ok).toBe(true);

        const importRes = await apiRequest(page, `/api/tables/${tableName}/import`, {
            method: 'POST',
            body: JSON.stringify([
                { name: 'Alice', total: '15', active: 'true', joined_at: '2026-03-31 18:45:00' },
                { name: 'Bob', total: '22', active: 'false', joined_at: '2026-03-30 11:20:00' },
            ]),
        });
        expect(importRes.ok).toBe(true);

        const importCheck = await runSQL(page, `SELECT name, total, active, joined_at::date::text FROM ${tableName} ORDER BY name ASC`);
        expect(importCheck.ok).toBe(true);
        expect(importCheck.body?.rows?.[0]?.[0]).toBe('Alice');
        expect(String(importCheck.body?.rows?.[0]?.[1])).toBe('15');
        expect(importCheck.body?.rows?.[0]?.[2]).toBe(true);

        await page.getByRole('button', { name: 'Storage', exact: true }).first().click();
        await expect(page.getByRole('button', { name: 'Create bucket' })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Create bucket' }).click();
        const bucketModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByPlaceholder('e.g. customer-assets') });
        await bucketModal.getByPlaceholder('e.g. customer-assets').fill(bucketName);
        await bucketModal.getByRole('button', { name: /^Create bucket$/i }).click();

        await expect(page.getByRole('button', { name: 'Edit', exact: true }).last()).toBeVisible({ timeout: 15000 });
        await expect(page.getByRole('button', { name: 'Delete', exact: true }).last()).toBeVisible({ timeout: 15000 });

        await page.getByPlaceholder('Search objects by name or MIME type...').fill('does-not-exist');
        await expect(page.getByText('No objects match this search')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'Clear search' }).click();
        await expect(page.getByText('No objects match this search')).toHaveCount(0);

        await page.getByRole('button', { name: 'Authentication', exact: true }).first().click();
        await expect(page.getByText('USER ACCOUNTS')).toBeVisible({ timeout: 15000 });
        await page.locator('tbody tr').first().getByRole('button').last().click();
        const userMenu = page.locator('.ozy-floating-panel').filter({ has: page.getByText('View Detail') }).last();
        await expect(userMenu.getByText('View Detail')).toBeVisible({ timeout: 10000 });
        const menuBox = await userMenu.boundingBox();
        expect(menuBox).not.toBeNull();
        expect(menuBox.y + menuBox.height).toBeLessThan(1200);

        await page.locator('header').getByText('A', { exact: true }).click();
        await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
        await expect(page.getByRole('button', { name: 'MCP Gateway', exact: true })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'MCP Gateway', exact: true }).click();
        await expect(page.getByText('Connect VS Code or another MCP client')).toBeVisible({ timeout: 10000 });
        await page.getByRole('button', { name: 'General' }).click();
        await expect(page.getByText('Core Release Channel')).toBeVisible({ timeout: 10000 });

        const updateStatus = await apiRequest(page, '/api/project/update-status');
        expect(updateStatus.ok).toBe(true);
        expect(typeof updateStatus.body?.status).toBe('string');
    } finally {
        if (!page.isClosed()) {
            await apiRequest(page, `/api/files/buckets/${bucketName}`, { method: 'DELETE' });
            await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
        }
    }
});
