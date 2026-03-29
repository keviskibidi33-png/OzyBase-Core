import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@ozybase.local";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "OzyBase123!";

async function login(page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("system@ozybase.local").fill(ADMIN_EMAIL);
  await page
    .getByPlaceholder("Enter your 32-char password")
    .fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /Establish Link/i }).click();
  await expect(page.getByText("MODULE ACTIVITY")).toBeVisible({
    timeout: 20000,
  });
}

async function apiKeyRequest(page, key, url, options = {}) {
  return page.evaluate(
    async ({ key, url, options }) => {
      const headers = new Headers(options.headers || {});
      headers.set("apikey", key);
      if (options.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
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
    },
    { key, url, options },
  );
}

test("essential keys UI: reveal, rotate and validate MCP with service_role", async ({
  page,
}) => {
  test.setTimeout(240000);

  await login(page);

  await page.getByAltText("OzyBase").hover();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByText("Project Metadata")).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole("button", { name: "API Keys" }).click();
  await expect(page.getByText("Essential key vault")).toBeVisible({
    timeout: 15000,
  });

  await expect(page.getByTestId("essential-key-card-anon")).toBeVisible();
  await expect(
    page.getByTestId("essential-key-card-service_role"),
  ).toBeVisible();

  await page.getByTestId("verify-admin-button").click();
  await page.getByTestId("verify-admin-password").fill(ADMIN_PASSWORD);
  await page.getByTestId("verify-admin-submit").click();
  await expect(page.getByText("Admin verification confirmed.")).toBeVisible({
    timeout: 10000,
  });

  await page.getByTestId("essential-key-reveal-anon").click();
  await expect(page.getByTestId("essential-key-secret-anon")).not.toContainText(
    "Locked.",
    { timeout: 10000 },
  );
  const originalAnonKey = (
    await page.getByTestId("essential-key-secret-anon").textContent()
  )?.trim();
  expect(originalAnonKey).toBeTruthy();

  await page.getByTestId("essential-key-reveal-service_role").click();
  await expect(
    page.getByTestId("essential-key-secret-service_role"),
  ).not.toContainText("Locked.", { timeout: 10000 });
  const originalServiceRoleKey = (
    await page.getByTestId("essential-key-secret-service_role").textContent()
  )?.trim();
  expect(originalServiceRoleKey).toBeTruthy();

  const initialTools = await apiKeyRequest(
    page,
    originalServiceRoleKey,
    "/api/project/mcp/tools",
  );
  expect(initialTools.status).toBe(200);
  expect(initialTools.body?.count).toBeGreaterThan(0);

  const initialInvoke = await apiKeyRequest(
    page,
    originalServiceRoleKey,
    "/api/project/mcp/invoke",
    {
      method: "POST",
      body: JSON.stringify({ tool: "system.health", arguments: {} }),
    },
  );
  expect(initialInvoke.status).toBe(200);
  expect(initialInvoke.body?.tool).toBe("system.health");

  await page.getByTestId("essential-key-rotate-anon").click();
  await page.getByRole("button", { name: "Rotate Now" }).click();
  await expect(
    page.getByText(
      "Rotation complete. The previous key stopped working immediately.",
    ),
  ).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        (
          await page.getByTestId("essential-key-secret-anon").textContent()
        )?.trim(),
      { timeout: 15000 },
    )
    .not.toBe(originalAnonKey);
  const rotatedAnonKey = (
    await page.getByTestId("essential-key-secret-anon").textContent()
  )?.trim();
  expect(rotatedAnonKey).toBeTruthy();

  await page.getByTestId("essential-key-rotate-service_role").click();
  await page.getByRole("button", { name: "Rotate Now" }).click();
  await expect(
    page.getByText(
      "Rotation complete. The previous key stopped working immediately.",
    ),
  ).toBeVisible({ timeout: 15000 });
  await expect
    .poll(
      async () =>
        (
          await page
            .getByTestId("essential-key-secret-service_role")
            .textContent()
        )?.trim(),
      { timeout: 15000 },
    )
    .not.toBe(originalServiceRoleKey);
  const rotatedServiceRoleKey = (
    await page.getByTestId("essential-key-secret-service_role").textContent()
  )?.trim();
  expect(rotatedServiceRoleKey).toBeTruthy();

  const oldKeyTools = await apiKeyRequest(
    page,
    originalServiceRoleKey,
    "/api/project/mcp/tools",
  );
  expect(oldKeyTools.status).toBe(401);

  const newKeyTools = await apiKeyRequest(
    page,
    rotatedServiceRoleKey,
    "/api/project/mcp/tools",
  );
  expect(newKeyTools.status).toBe(200);
  expect(newKeyTools.body?.count).toBeGreaterThan(0);

  const newKeyInvoke = await apiKeyRequest(
    page,
    rotatedServiceRoleKey,
    "/api/project/mcp/invoke",
    {
      method: "POST",
      body: JSON.stringify({ tool: "collections.list", arguments: {} }),
    },
  );
  expect(newKeyInvoke.status).toBe(200);
  expect(Array.isArray(newKeyInvoke.body?.result?.items)).toBe(true);
});
