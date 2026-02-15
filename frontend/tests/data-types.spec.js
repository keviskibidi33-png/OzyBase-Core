import { test, expect } from '@playwright/test';

// Configuration - Token generated with 'super-secret-key-change-it'
// Payload: {"user_id":"00000000-0000-0000-0000-000000000001","role":"admin","exp":1893456000,"iat":1707584400}
const AUTH_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDAwMDAwMDAtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAxIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxODkzNDU2MDAwLCJpYXQiOjE3MDc1ODQ0MDB9.vIfbLQ_HsfZeIHZbStSea5iVjh7ZkDzhNadFpCZ0zwU';
const USER_DATA = { email: 'system@ozybase.local', role: 'admin' };

test.beforeEach(async ({ page }) => {
    // 1. Inject Authentication before navigation
    await page.addInitScript(({ token, user }) => {
        window.localStorage.setItem('ozy_token', token);
        window.localStorage.setItem('ozy_user', JSON.stringify(user));
    }, { token: AUTH_TOKEN, user: USER_DATA });

    // 2. Navigate
    await page.goto('/', { waitUntil: 'load' });

    // 3. Sequential Sync (Loading states)
    await page.getByText('Loading OzyBase...').waitFor({ state: 'detached', timeout: 30000 }).catch(() => { });
    await page.getByText('Loading Module...', { exact: true }).waitFor({ state: 'detached', timeout: 90000 }).catch(() => { });

    // 4. Final Dashboard check
    await expect(page.getByRole('button', { name: 'Project Status' })).toBeVisible({ timeout: 60000 });
});

test('should create a table with all data types', async ({ page }) => {
    await page.getByRole('button', { name: 'Table Editor' }).click({ force: true });
    await expect(page.getByRole('heading', { name: /User Tables/ })).toBeVisible({ timeout: 60000 });

    // Click the "New table" button in the sidebar
    const newTableBtn = page.getByRole('button', { name: 'New table' });
    await newTableBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newTableBtn.click({ force: true });

    // Wait for the Create Table Modal to appear (slide-in from right)
    await expect(page.getByText('Create a new table under')).toBeVisible({ timeout: 30000 });

    const tableName = `test_types_${Date.now()}`;
    await page.getByPlaceholder('vlaber_table').fill(tableName);

    const dataTypes = ['text', 'int4', 'bool', 'jsonb', 'uuid', 'date'];
    let i = 0;
    for (const type of dataTypes) {
        await page.getByRole('button', { name: 'Add column' }).click();

        // Initial rows = 3 (id, user_id, created_at)
        // New row index = 3 + i
        const rowIndex = 3 + i;
        const row = page.locator('.grid.grid-cols-12.items-center').nth(rowIndex);

        await expect(row).toBeVisible({ timeout: 5000 });
        await row.locator('input[type="text"]').first().fill(`col_${type}`);
        await row.locator('select').selectOption(type);
        i++;
    }

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(tableName)).toBeVisible({ timeout: 60000 });

    const tableItem = page.locator('button').filter({ hasText: tableName, exact: true });
    await tableItem.hover();
    await tableItem.locator('svg.lucide-trash2').click({ force: true });
    await page.getByRole('button', { name: 'Burn Table' }).click();
    
    // Use specific locator to avoid matching the success toast
    await expect(page.getByRole('button', { name: tableName })).not.toBeVisible({ timeout: 30000 });
});

test('should open project status dropdown', async ({ page }) => {
    const statusBtn = page.getByRole('button', { name: 'Project Status' });
    await statusBtn.click({ force: true });

    await expect(page.getByText('Infrastructure')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Security Gate')).toBeVisible({ timeout: 30000 });
});

test('should verify CSV import availability in Create Table modal', async ({ page }) => {
    await page.getByRole('button', { name: 'Table Editor' }).click({ force: true });

    // Wait for the sidebar/explorer to load
    await expect(page.getByRole('heading', { name: /User Tables/ })).toBeVisible({ timeout: 60000 });

    // Click the "New table" button
    const newTableBtn = page.getByRole('button', { name: 'New table' });
    await newTableBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newTableBtn.click({ force: true });

    // Wait for the Create Table Modal to appear
    await expect(page.getByText('Create a new table under')).toBeVisible({ timeout: 30000 });

    // Now check for the CSV import option
    await expect(page.locator('label').filter({ hasText: /Import data from CSV/ })).toBeVisible({ timeout: 30000 });
});
