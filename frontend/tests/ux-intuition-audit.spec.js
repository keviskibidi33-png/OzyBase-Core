import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "system@ozybase.local";
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

test("ux audit: core surfaces explain themselves clearly", async ({ page }) => {
  test.setTimeout(240000);

  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);

  await page.getByRole("button", { name: "Home" }).hover();
  await expect(page.getByText("Select Project")).toBeVisible();

  await page.getByRole("button", { name: /^Settings$/ }).click();
  await expect(page.getByText("General Settings")).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByText(
      /Review safe project metadata and readiness signals before exposing this instance to real traffic/i,
    ),
  ).toBeVisible();
  await expect(page.getByText("Project ID").first()).toBeVisible();

  await page.getByText("Select Project").click();
  await expect(page.getByText("Project Settings")).toBeVisible();
  await expect(page.getByText("All Projects")).toBeVisible();
  await page.getByText("All Projects").click();
  await expect(page.getByText("Create isolated project spaces for apps, teams, and environments")).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Table Editor" }).click();
  await expect(page.getByRole("button", { name: /Saved Views/i })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Current Table")).toHaveCount(0);
  await expect(page.getByText("Visible Columns")).toHaveCount(0);
  await page.getByRole("button", { name: /Saved Views/i }).click();
  await expect(page.getByText("Save This Layout")).toBeVisible();
  await page.getByRole("button", { name: /Saved Views/i }).click({ force: true });
  await page.getByRole("button", { name: /^Insert$/ }).click();
  await expect(page.getByText("Add Column")).toBeVisible();
  await page.getByRole("button", { name: /^Insert$/ }).click({ force: true });

  await page.getByRole("button", { name: "SQL Editor" }).click();
  await expect(page.getByRole("button", { name: /Run Query/i })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("Direct SQL access")).toHaveCount(0);
  await expect(page.getByText("Quick Brief")).toHaveCount(0);
  await page.getByRole("button", { name: /Run Query/i }).click();
  await expect(page.getByText("Query Results")).toBeVisible({
    timeout: 15000,
  });

  await page.getByRole("button", { name: "Storage" }).click();
  await expect(
    page.getByText(
      /Choose a bucket, upload files, and control access with public visibility plus optional RLS/i,
    ),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: /Upload file/i })).toBeVisible();

  await page.getByRole("button", { name: "Authentication" }).click();
  await expect(page.getByRole("button", { name: "Permissions" })).toBeVisible({
    timeout: 15000,
  });

  expect(pageErrors, `Unexpected browser page errors: ${pageErrors.join("\n")}`).toEqual([]);
});
