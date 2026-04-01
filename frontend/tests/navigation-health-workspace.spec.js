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

test('navigation reset, geo review flow, and workspace lifecycle stay autonomous', async ({ page }) => {
  test.setTimeout(300000);

  const qaSuffix = Date.now().toString().slice(-8);
  const workspaceName = `QA Project ${qaSuffix}`;
  const autoGeoIP = `179.6.171.${Number(qaSuffix.slice(-2)) % 250}`;
  const manualGeoIP = `179.6.172.${Number(qaSuffix.slice(-2)) % 250}`;
  const qaGeoCountry = `QA-${qaSuffix}`;
  let createdWorkspaceId = null;
  let originalGeoPolicy = null;

  await login(page);
  const originalPolicies = await apiRequest(page, '/api/project/security/policies');
  if (originalPolicies.ok && originalPolicies.body?.geo_fencing) {
    originalGeoPolicy = originalPolicies.body.geo_fencing;
  }

  try {
    const scrolledTop = await page.getByTestId('module-shell').evaluate((node) => {
      const scrollTarget = Array.from(node.querySelectorAll('.custom-scrollbar')).find(
        (element) => element.scrollHeight > element.clientHeight + 24,
      );
      if (!scrollTarget) {
        return -1;
      }
      scrollTarget.scrollTop = 700;
      return scrollTarget.scrollTop;
    });
    expect(scrolledTop).not.toBe(-1);
    expect(scrolledTop).toBeGreaterThan(100);

    await page.getByRole('button', { name: 'SQL Editor', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /Run Query/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Direct SQL access')).toHaveCount(0);
    await expect(page.getByText('Quick Brief')).toHaveCount(0);
    const hasResidualScroll = await page.getByTestId('module-shell').evaluate((node) =>
      Array.from(node.querySelectorAll('.custom-scrollbar')).some((element) => element.scrollTop > 0),
    );
    expect(hasResidualScroll).toBe(false);

    await page.getByTestId('workspace-switcher-toggle').click();
    await page.getByRole('button', { name: 'All Projects' }).click();
    await page.getByRole('button', { name: /New Project/i }).click();
    const createModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByPlaceholder('Enter project name...') });
    await createModal.getByPlaceholder('Enter project name...').fill(workspaceName);
    await createModal.getByRole('button', { name: /^Create$/i }).click();

    await expect(page.getByText('Project Settings')).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`input[value="${workspaceName}"]`)).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ozy_workspace_id')), { timeout: 15000 })
      .not.toBeNull();
    createdWorkspaceId = await page.evaluate(() => localStorage.getItem('ozy_workspace_id'));

    const duplicateGeoSQL = `
      INSERT INTO _v_security_alerts (type, severity, message, metadata)
      VALUES
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${autoGeoIP}","country":"Peru","city":"Lima"}'::jsonb),
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${autoGeoIP}","country":"Peru","city":"Lima"}'::jsonb)
    `;
    const seedAlerts = await runSQL(page, duplicateGeoSQL);
    expect(seedAlerts.ok).toBe(true);

    await page.waitForTimeout(12000);
    await page.getByLabel('Open notifications').click();
    const autoGeoCard = page.locator('div').filter({ hasText: 'Geographic Access Breach' }).filter({ hasText: autoGeoIP }).first();
    await expect(autoGeoCard).toBeVisible({ timeout: 15000 });
    await expect(autoGeoCard.getByText('2 events')).toBeVisible({ timeout: 10000 });
    await autoGeoCard.getByRole('button', { name: /Open Geo-Fencing/i }).click();

    await expect(page.getByRole('heading', { name: 'Geo-Fencing', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder(/Enter country name/i).fill(qaGeoCountry);
    await page.getByRole('button', { name: /^Add$/i }).click();
    await expect(page.getByText('Policy updated successfully')).toBeVisible({ timeout: 15000 });
    await page.getByLabel('Open notifications').click();
    await expect(page.locator('div').filter({ hasText: autoGeoIP })).toHaveCount(0, { timeout: 15000 });
    await page.getByLabel('Open notifications').click();

    const manualGeoSQL = `
      INSERT INTO _v_security_alerts (type, severity, message, metadata)
      VALUES
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${manualGeoIP}","country":"Peru","city":"Lima"}'::jsonb),
        ('geo_breach', 'critical', 'Geo breach detected', '{"ip":"${manualGeoIP}","country":"Peru","city":"Lima"}'::jsonb)
    `;
    const seedManualAlerts = await runSQL(page, manualGeoSQL);
    expect(seedManualAlerts.ok).toBe(true);
    await page.waitForTimeout(12000);
    await page.getByLabel('Open notifications').click();
    const manualGeoCard = page.locator('div').filter({ hasText: 'Geographic Access Breach' }).filter({ hasText: manualGeoIP }).first();
    await expect(manualGeoCard).toBeVisible({ timeout: 15000 });
    await expect(manualGeoCard.getByText('2 events')).toBeVisible({ timeout: 10000 });
    const markReviewedButton = manualGeoCard.getByRole('button', { name: /Mark reviewed/i });
    await expect(markReviewedButton).toBeVisible({ timeout: 15000 });
    await markReviewedButton.click({ force: true, timeout: 15000 });
    await expect(page.locator('div').filter({ hasText: manualGeoIP })).toHaveCount(0, { timeout: 15000 });

    await page.getByTestId('workspace-switcher-toggle').click();
    await page.getByRole('button', { name: 'Project Settings' }).click();
    await expect(page.getByRole('banner').getByText('Project Settings')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Danger Zone', exact: true }).click();
    await expect(page.getByText('Termination Protocol')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /^Delete Project$/i }).first().click();
    const deleteModal = page.locator('.ozy-dialog-panel').filter({ has: page.getByText('Project "' + workspaceName + '"') });
    await deleteModal.getByRole('button', { name: /^Delete Project$/i }).click();

    await expect(page.getByText('Projects').first()).toBeVisible({ timeout: 15000 });
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('ozy_workspace_id')), { timeout: 15000 })
      .not.toBe(createdWorkspaceId);
  } finally {
    if (originalGeoPolicy && !page.isClosed()) {
      await apiRequest(page, '/api/project/security/policies', {
        method: 'POST',
        body: JSON.stringify({ type: 'geo_fencing', config: originalGeoPolicy }),
      });
    }
    if (createdWorkspaceId && !page.isClosed()) {
      await apiRequest(page, `/api/workspaces/${createdWorkspaceId}`, { method: 'DELETE' });
    }
    if (!page.isClosed()) {
      await runSQL(page, `DELETE FROM _v_security_alerts WHERE type = 'geo_breach' AND metadata->>'ip' IN ('${autoGeoIP}', '${manualGeoIP}')`);
    }
  }
});
