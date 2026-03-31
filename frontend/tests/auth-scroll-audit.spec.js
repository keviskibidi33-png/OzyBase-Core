import { test, expect } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@ozybase.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'OzyBase123!';

async function login(page) {
    await page.goto('/');
    await page.getByPlaceholder('system@ozybase.local').fill(ADMIN_EMAIL);
    await page.getByPlaceholder('Enter your 32-char password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: /Establish Link/i }).click();
    await expect(page.getByRole('button', { name: 'Authentication' })).toBeVisible({ timeout: 20000 });
}

async function openAuthSubmodule(page, name) {
    await page.getByRole('button', { name: 'Authentication' }).click();
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.locator('[data-module-scroll-root]')).toBeVisible({ timeout: 15000 });
}

async function auditScroll(page, label) {
    const result = await page.evaluate(() => {
        const root = document.querySelector('[data-module-scroll-root]');
        if (!(root instanceof HTMLElement)) {
            return { exists: false };
        }

        const style = window.getComputedStyle(root);
        const before = root.scrollTop;
        const clientHeight = root.clientHeight;
        const scrollHeight = root.scrollHeight;
        const needsScroll = scrollHeight > clientHeight + 4;

        if (needsScroll) {
            root.scrollTop = Math.min(160, scrollHeight);
        }

        const after = root.scrollTop;
        root.scrollTop = before;

        return {
            exists: true,
            overflowY: style.overflowY,
            clientHeight,
            scrollHeight,
            needsScroll,
            scrollMoves: after > before,
        };
    });

    expect(result.exists, `${label} should expose a module scroll root`).toBe(true);

    if (result.needsScroll) {
        expect(result.scrollMoves, `${label} needs vertical scroll but the scroll root did not move`).toBe(true);
    }

    return result;
}

test('auth module scroll audit', async ({ page }) => {
    test.setTimeout(180000);

    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page);

    const results = {};

    await openAuthSubmodule(page, 'Providers');
    results.providers = await auditScroll(page, 'Providers');

    await openAuthSubmodule(page, 'Permissions');
    results.permissions = await auditScroll(page, 'Permissions');

    await openAuthSubmodule(page, '2FA Settings');
    results.twoFactorStatus = await auditScroll(page, '2FA status');
    const enable2FAButton = page.getByRole('button', { name: /Enable Two-Factor Authentication/i });
    if (await enable2FAButton.isVisible().catch(() => false)) {
        await enable2FAButton.click();
        await expect(page.getByText('Save Backup Codes')).toBeVisible({ timeout: 15000 });
        results.twoFactorSetup = await auditScroll(page, '2FA setup');
    }

    await openAuthSubmodule(page, 'Security Hub');
    results.securityHub = await auditScroll(page, 'Security Hub');

    await openAuthSubmodule(page, 'Geo-Fencing');
    results.geoFencing = await auditScroll(page, 'Geo-Fencing');

    await openAuthSubmodule(page, 'Alert Notifications');
    results.alertNotifications = await auditScroll(page, 'Alert Notifications');

    await openAuthSubmodule(page, 'Integrations & SIEM');
    results.integrations = await auditScroll(page, 'Integrations & SIEM');
    const newIntegrationButton = page.getByRole('button', { name: /New Integration/i });
    if (await newIntegrationButton.isVisible().catch(() => false)) {
        await newIntegrationButton.click();
        await expect(page.getByText('Configure New Integration')).toBeVisible({ timeout: 15000 });
        results.integrationsExpanded = await auditScroll(page, 'Integrations & SIEM expanded');
    }

    await openAuthSubmodule(page, 'Email Templates');
    results.emailTemplates = await auditScroll(page, 'Email Templates');

    await openAuthSubmodule(page, 'Auth Settings');
    results.authSettings = await auditScroll(page, 'Auth Settings');

    console.log(JSON.stringify(results, null, 2));
});
