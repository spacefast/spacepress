import { test, expect } from "@playwright/test";

test("the front page compiles the pantry example in the browser", async ({ page }) => {
  await page.goto("./");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(status).toContainText("0001_init.sql");
  await expect(status).toContainText("types.ts");
});
