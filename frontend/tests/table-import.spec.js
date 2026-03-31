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

test('typed table import accepts CSV-style string values without 500s', async ({ page }) => {
    test.setTimeout(240000);

    const suffix = Date.now().toString().slice(-8);
    const tableName = `qa_import_${suffix}`;
    let authHeaders = {};

    try {
        await login(page);
        authHeaders = await getAuthHeaders(page);

        const createTableRes = await runSQL(page, authHeaders, `
            CREATE TABLE ${tableName} (
                id bigserial PRIMARY KEY,
                name text,
                age integer,
                is_active boolean,
                joined_on date,
                notes text
            )
        `);
        expect(createTableRes.ok).toBe(true);

        const importRes = await apiRequest(page, authHeaders, `/api/tables/${tableName}/import`, {
            method: 'POST',
            body: JSON.stringify([
                {
                    name: ' Alice ',
                    age: '42',
                    is_active: 'true',
                    joined_on: '2026-03-31',
                    notes: '  hello  ',
                },
                {
                    name: 'Bob',
                    age: '7',
                    is_active: 'false',
                    joined_on: '2026-03-30',
                    notes: '   ',
                },
            ]),
        });

        expect(importRes.status).toBe(200);
        expect(importRes.body?.message).toContain('Imported 2 records');

        const rowsRes = await apiRequest(page, authHeaders, `/api/collections/${tableName}/records?order=age.asc&limit=10`);
        expect(rowsRes.ok).toBe(true);
        expect(Array.isArray(rowsRes.body?.data)).toBe(true);
        expect(rowsRes.body.data).toHaveLength(2);

        const [youngest, oldest] = rowsRes.body.data;
        expect(youngest.name).toBe('Bob');
        expect(youngest.age).toBe(7);
        expect(youngest.is_active).toBe(false);
        expect(String(youngest.joined_on)).toContain('2026-03-30');
        expect(youngest.notes).toBeNull();

        expect(oldest.name).toBe('Alice');
        expect(oldest.age).toBe(42);
        expect(oldest.is_active).toBe(true);
        expect(String(oldest.joined_on)).toContain('2026-03-31');
        expect(oldest.notes).toBe('hello');
    } finally {
        if (authHeaders.Authorization) {
            await runSQL(page, authHeaders, `DROP TABLE IF EXISTS ${tableName}`).catch(() => {});
        }
    }
});
