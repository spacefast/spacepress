import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("the playground opens the reading list by default", async ({ page }) => {
  await page.goto("./playground");
  await expect(page.locator("#compile-status")).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("reading-list");
});

test("the playground recompiles edited sources and replaces invalid output with diagnostics", async ({ page }) => {
  // The default example is the reading list; this test reads the blog's output.
  await page.goto("./playground?example=blog");
  const status = page.locator("#compile-status");
  const source = page.getByRole("textbox", { name: "Source code", exact: true });
  const generated = page.getByRole("textbox", { name: "Generated code", exact: true });
  const generatedFile = page.getByRole("combobox", { name: "Generated file", exact: true });
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("blog");
  await expect(generated).toHaveValue(/function action__approveComment/);
  const tokenColors = (view: string) => page.locator(`.code-editor[data-highlighted] ${view} .line > span`)
    .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size);
  await expect(page.locator("#generated-view diffs-container")).toBeVisible();
  await expect.poll(() => tokenColors("#source-view")).toBeGreaterThan(3);
  await source.press("End");
  await source.pressSequentially(" // typed");
  await expect(page.locator(".code-editor[data-highlighted] #source-view")).toHaveText(await source.inputValue());
  await expect(status).toHaveAttribute("data-state", "ok");
  await generatedFile.selectOption("first/app/schema.php");
  await expect(generated).toHaveValue(/'postType' => 'first_posts'/);
  await expect(generated).toHaveValue(/'sync' => \['dir' => 'content\/posts'/);

  await page.getByRole("button", { name: "Post writes", exact: true }).click();
  await expect(generatedFile).toHaveValue("runtime/First/Wp/WpPostStore.php");
  await expect(generated).toHaveValue(/wp_insert_post\(wp_slash\(\$post\), true\)/);
  await expect(page.locator("#file-description")).toContainText("Shared WordPress runtime");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(generated).toHaveValue(/wp_insert_user\(/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("pantry");
  await generatedFile.selectOption("first/app/functions.php");
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  const original = await source.inputValue();
  await source.fill(original.replace("name can't be empty", "Give this item a name"));
  await expect(generated).toHaveValue(/Give this item a name/);
  await generatedFile.selectOption("first/app/schema.php");
  await expect(generated).toHaveValue(/<\?php[\s\S]*'collections' =>/);

  await page.getByRole("combobox", { name: "Source file", exact: true }).selectOption("first/lib/fields.ts");
  await source.fill((await source.inputValue()).replace("LOW_STOCK = 1", "LOW_STOCK = 7"));
  await expect(generated).toHaveValue(/'lowStockAt' => [^\n]*'value' => 7/);

  await source.fill("export const =");
  await expect(status).toHaveAttribute("data-state", "diagnostics");
  await expect(page.getByRole("alert")).toContainText("first/lib/fields.ts");
  await expect(generated).toHaveValue("");
  await expect(page.getByRole("button", { name: "Download file" })).toBeDisabled();

  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(original);
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("blog");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/export const posts/);
  await generatedFile.selectOption("first/app/schema.php");
  await expect(generated).toHaveValue(/'posts' =>/);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("schema.php");
  expect(await readFile(await download.path(), "utf8")).toBe(await generated.inputValue());

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("full-site");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/export const notes = collection/);
  await expect(generated).toHaveValue(/'postType' => 'first_notes'/);
  await expect(page.locator("#example-description")).toContainText("Pages written in TSX");
});
