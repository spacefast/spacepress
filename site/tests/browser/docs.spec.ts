import { test, expect } from "@playwright/test";

test("the docs index is the README", async ({ page }) => {
  await page.goto("./docs");
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toHaveText("Zero");
});

test("a README link to a doc opens that doc's page here", async ({ page }) => {
  await page.goto("./docs");
  await page.getByRole("article").getByRole("link", { name: "docs/config-api.md" }).click();
  await expect(page).toHaveURL(/\/docs\/config-api$/);
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toContainText("zero.config.ts API");
});

test("the docs navigation marks the current page", async ({ page }) => {
  await page.goto("./docs/config-api");
  await expect(page.locator("nav.docs-nav a[aria-current=page]")).toContainText("zero.config.ts API");
});
