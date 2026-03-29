import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@ozybase.local';
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

async function getDatasetSummary(page) {
    const collectionsRes = await apiRequest(page, '/api/collections');
    expect(collectionsRes.ok).toBe(true);

    const statsRes = await runSQL(page, `
        SELECT relname, COALESCE(n_live_tup, 0)::bigint AS estimated_rows
        FROM pg_stat_user_tables
        ORDER BY estimated_rows DESC, relname ASC
    `);
    expect(statsRes.ok).toBe(true);

    const collections = Array.isArray(collectionsRes.body) ? collectionsRes.body : [];
    const tableStats = Array.isArray(statsRes.body?.rows)
        ? statsRes.body.rows.map((row) => ({
            table: String(row[0]),
            estimatedRows: Number(row[1] || 0),
        }))
        : [];

    return {
        tableCount: collections.length,
        tables: collections.map((item) => String(item.name)),
        tableStats,
    };
}

async function cleanupArtifacts(page, { functionName, tableName, bucketName }) {
    await apiRequest(page, `/api/functions/${functionName}`, { method: 'DELETE' });
    await apiRequest(page, `/api/collections/${tableName}`, { method: 'DELETE' });
    await runSQL(page, `
        DELETE FROM _v_storage_objects
        WHERE bucket_id IN (SELECT id FROM _v_buckets WHERE name = '${bucketName}')
        RETURNING id
    `);
    await runSQL(page, `
        DELETE FROM _v_buckets
        WHERE name = '${bucketName}'
        RETURNING id
    `);
}

test('production QA smoke: overlays + storage + tables + edge functions', async ({ page }) => {
    test.setTimeout(300000);

    const qaSuffix = Date.now().toString().slice(-8);
    const tableName = `qa_ui_${qaSuffix}`;
    const bucketName = `qa_bucket_${qaSuffix}`;
    const functionName = `qa_edge_${qaSuffix}`;
    const nativeDialogs = [];
    const consoleErrors = [];
    const pageErrors = [];
    const apiFailures = [];

    page.on('dialog', async (dialog) => {
        nativeDialogs.push(dialog.message());
        await dialog.dismiss();
    });
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    page.on('pageerror', (error) => {
        pageErrors.push(error.message);
    });
    page.on('response', (response) => {
        if (!response.url().includes('/api/')) {
            return;
        }
        const pathname = new URL(response.url()).pathname;
        if (response.status() >= 400 && pathname !== '/api/health' && pathname !== '/api/project/health') {
            apiFailures.push(`${response.status()} ${pathname}`);
        }
    });

    await login(page);

    const before = await getDatasetSummary(page);

    try {
        const createTableRes = await apiRequest(page, '/api/collections', {
            method: 'POST',
            body: JSON.stringify({
                name: tableName,
                display_name: tableName,
                schema: [
                    { name: 'title', type: 'text', required: false, unique: false, is_primary: false, references: null },
                    { name: 'amount', type: 'int8', required: false, unique: false, is_primary: false, references: null },
                ],
                rls_enabled: false,
                rls_rule: '',
                rls_policies: {},
                realtime_enabled: false,
            }),
        });
        expect(createTableRes.ok).toBe(true);

        await page.reload({ waitUntil: 'networkidle' });

        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByText('TABLE EDITOR').first()).toBeVisible({ timeout: 20000 });
        await expect(page.getByRole('button', { name: new RegExp(tableName, 'i') }).first()).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();

        await page.getByRole('button', { name: /Insert/i }).click();
        await page.getByRole('button', { name: /Insert Row/i }).click();
        await page.getByPlaceholder('Enter title...').fill(`row-${qaSuffix}`);
        await page.getByPlaceholder('Enter amount...').fill('7');
        await page.getByRole('button', { name: /^Insert Row$/i }).last().click();
        await expect(page.getByText(`row-${qaSuffix}`)).toBeVisible({ timeout: 20000 });

        const rowsRes = await apiRequest(page, `/api/collections/${tableName}/records?limit=10`);
        expect(rowsRes.ok).toBe(true);
        expect(Array.isArray(rowsRes.body?.data)).toBe(true);
        expect(rowsRes.body.data.length).toBeGreaterThanOrEqual(1);

        await page.getByRole('button', { name: 'Storage' }).click();
        await expect(page.getByText('Object Storage Engine')).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Create bucket' }).click();
        const bucketModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByPlaceholder('e.g. customer-assets') });
        await bucketModal.getByPlaceholder('e.g. customer-assets').fill(bucketName);
        await bucketModal.getByRole('button', { name: 'Create Bucket', exact: true }).click();
        const bucketButton = page.getByRole('button', { name: new RegExp(bucketName, 'i') });
        await expect(bucketButton).toBeVisible({ timeout: 15000 });
        await bucketButton.click();
        await page.locator('input[type="file"]').setInputFiles({
            name: `qa-${qaSuffix}.txt`,
            mimeType: 'text/plain',
            buffer: Buffer.from(`qa-${qaSuffix}`, 'utf8'),
        });

        await expect.poll(async () => {
            const filesRes = await apiRequest(page, `/api/files?bucket=${bucketName}`);
            if (!filesRes.ok || !Array.isArray(filesRes.body)) {
                return 0;
            }
            return filesRes.body.length;
        }, { timeout: 20000 }).toBeGreaterThanOrEqual(1);

        await page.getByRole('button', { name: 'Edge Functions' }).click();
        await expect(page.getByText('Edge Functions').first()).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: /New Function/i }).click();
        await page.getByPlaceholder('e.g. process-payments').fill(functionName);
        await page.locator('textarea').fill(`return { ok: true, marker: "${qaSuffix}" };`);
        await page.getByRole('button', { name: /Deploy to Edge/i }).click();
        const functionRow = page.locator('tbody tr').filter({ has: page.getByText(functionName, { exact: true }) }).first();
        await expect(functionRow).toBeVisible({ timeout: 20000 });
        await functionRow.getByRole('button', { name: `Invoke ${functionName}` }).click();
        const invokeModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByText('Invocation Result') }).last();
        await expect(invokeModal).toBeVisible({ timeout: 15000 });
        await expect(invokeModal.locator('pre')).toContainText(`"marker": "${qaSuffix}"`);

        const after = await getDatasetSummary(page);
        const tableRowRes = await runSQL(page, `SELECT COUNT(*)::bigint FROM ${tableName}`);
        expect(tableRowRes.ok).toBe(true);

        const qaSummary = {
            beforeTableCount: before.tableCount,
            afterTableCount: after.tableCount,
            createdTable: tableName,
            createdBucket: bucketName,
            createdFunction: functionName,
            createdTableRowCount: Number(tableRowRes.body?.rows?.[0]?.[0] || 0),
            topTablesByEstimatedRows: after.tableStats.slice(0, 8),
            nativeDialogs,
            consoleErrors,
            pageErrors,
            apiFailures,
        };

        console.log(`QA_SUMMARY ${JSON.stringify(qaSummary)}`);

        expect(nativeDialogs).toEqual([]);
        expect(consoleErrors).not.toContain(expect.stringMatching(/MonacoEnvironment|getWorkerUrl|Could not create web worker/i));
        expect(pageErrors).toEqual([]);
        expect(apiFailures).toEqual([]);
    } finally {
        await cleanupArtifacts(page, { functionName, tableName, bucketName });
    }
});
