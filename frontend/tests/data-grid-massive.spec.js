import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@ozybase.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';

async function ensureSystemInitialized(page) {
    const statusResponse = await page.request.get('/api/system/status');
    expect(statusResponse.ok()).toBe(true);

    const statusBody = await statusResponse.json();
    if (statusBody?.initialized) {
        return;
    }

    const setupResponse = await page.request.post('/api/system/setup', {
        data: {
            email: ADMIN_EMAIL,
            password: ADMIN_PASSWORD,
            mode: 'clean',
        },
    });
    expect(setupResponse.ok()).toBe(true);
}

async function login(page) {
    await ensureSystemInitialized(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('system@ozybase.local').fill(ADMIN_EMAIL);
    await page.getByPlaceholder('Enter your 32-char password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Establish Link/i }).click();
    await expect(page.getByRole('button', { name: 'Project Status' })).toBeVisible({ timeout: 30000 });
}

async function getAuthHeaders(page) {
    return page.evaluate(() => {
        const headers = {};
        const token = localStorage.getItem('ozy_token');
        const workspaceId = localStorage.getItem('ozy_workspace_id');

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (workspaceId) {
            headers['X-Workspace-Id'] = workspaceId;
        }

        return headers;
    });
}

async function apiRequest(page, authHeaders, url, options = {}) {
    const headers = {
        ...(options.headers || {}),
        ...authHeaders,
    };
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    const requestOptions = {
        method: options.method,
        headers,
    };
    if (options.body) {
        requestOptions.data =
            typeof options.body === 'string' && headers['Content-Type'] === 'application/json'
                ? JSON.parse(options.body)
                : options.body;
    }

    const response = await page.request.fetch(url, requestOptions);
    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = text;
    }

    return {
        ok: response.ok(),
        status: response.status(),
        body,
    };
}

async function runSQL(page, authHeaders, query) {
    return apiRequest(page, authHeaders, '/api/sql', {
        method: 'POST',
        body: JSON.stringify({ query }),
    });
}

test('massive table workflows stay usable in table editor and sql editor', async ({ page }) => {
    test.setTimeout(300000);

    const suffix = Date.now().toString().slice(-8);
    const tableName = `qa_massive_${suffix}`;
    const rowCount = 1200;
    let authHeaders = {};

    try {
        await login(page);
        authHeaders = await getAuthHeaders(page);

        const createTableRes = await runSQL(page, authHeaders, `
            CREATE TABLE ${tableName} (
                id bigserial PRIMARY KEY,
                title text NOT NULL,
                amount integer NOT NULL,
                status text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )
        `);
        expect(createTableRes.ok).toBe(true);

        const insertRowsRes = await runSQL(page, authHeaders, `
            INSERT INTO ${tableName} (title, amount, status)
            SELECT
                'item-' || gs::text,
                gs,
                CASE WHEN gs % 2 = 0 THEN 'active' ELSE 'queued' END
            FROM generate_series(1, ${rowCount}) AS gs
        `);
        expect(insertRowsRes.ok).toBe(true);

        await page.reload({ waitUntil: 'networkidle' });

        await page.getByRole('button', { name: 'Table Editor' }).click();
        await expect(page.getByText('TABLE EDITOR').first()).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: new RegExp(tableName, 'i') }).first().click();

        await expect(page.getByText(`${rowCount} rows`)).toBeVisible({ timeout: 20000 });
        await expect(page.getByText('page 1 / 12')).toBeVisible({ timeout: 20000 });

        await page.getByRole('button', { name: 'Compact' }).click();
        await expect(page.getByRole('button', { name: 'Compact' })).toHaveClass(/text-primary/);

        const pageJump = page.locator('label').filter({ hasText: /^Page$/i }).locator('input');
        await pageJump.fill('10');
        await pageJump.press('Enter');
        await expect(page.getByText('page 10 / 12')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('901-1000')).toBeVisible({ timeout: 10000 });

        const searchInput = page.getByPlaceholder('Search records...');
        await searchInput.fill('item-1199');
        await expect(page.getByText('search: item-1199')).toBeVisible({ timeout: 10000 });
        await expect(page.getByText('item-1199')).toBeVisible({ timeout: 15000 });

        await page.getByRole('button', { name: 'reset view' }).click();
        await expect(page.getByText('search: item-1199')).not.toBeVisible({ timeout: 15000 });
        await expect(searchInput).toHaveValue('');
        await page.getByRole('button', { name: 'Dismiss', exact: true }).click();

        await page.getByRole('button', { name: /^SQL$/i }).click();
        await expect(page.getByText(`Context: ${tableName}`)).toBeVisible({ timeout: 15000 });

        const editorInput = page.getByRole('textbox', { name: 'Editor content' });
        await expect(editorInput).toBeVisible({ timeout: 15000 });
        await editorInput.click({ force: true });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.insertText(`SELECT * FROM ${tableName} ORDER BY id ASC;`);
        await page.getByRole('button', { name: /Run Query/i }).click();

        await expect(page.getByText('PREVIEW CAP: 1000')).toBeVisible({ timeout: 20000 });
        await expect(page.getByText(/Preview capped at 1000 rows/i)).toBeVisible({ timeout: 20000 });

        const previewFilter = page.getByPlaceholder('Filter preview rows...');
        await previewFilter.fill('item-999');
        await expect(page.getByText('1/1000 preview rows')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('item-999')).toBeVisible({ timeout: 15000 });
    } finally {
        if (authHeaders.Authorization) {
            await runSQL(page, authHeaders, `DROP TABLE IF EXISTS ${tableName}`).catch(() => {});
        }
    }
});
