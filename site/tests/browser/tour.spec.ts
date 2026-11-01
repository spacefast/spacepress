import { test, expect } from "@playwright/test";

test("the tour index links to a page per example", async ({ page }) => {
  await page.goto("./tour");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The tour");
  await expect(page.getByRole("link", { name: /^The pantry/ })).toHaveAttribute("href", /\/tour\/pantry$/);
  await expect(page.getByRole("link", { name: /^The blog/ })).toHaveAttribute("href", /\/tour\/blog$/);
});

test("a stop shows the config excerpt beside the compiled output", async ({ page }) => {
  await page.goto("./tour/pantry#a-hook");
  const stop = page.locator("#a-hook");
  await expect(stop.locator(".in pre").first()).toContainText("beforeCreate(data)");
  await expect(stop.locator(".out pre").first()).toContainText("function items__beforeCreate");
});
