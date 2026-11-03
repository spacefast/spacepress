import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("the front page compiles the pantry example in the browser", async ({ page }) => {
  await page.goto("./");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(status).toContainText("0001_init.sql");
  await expect(status).toContainText("types.ts");
});

test("the playground recompiles edited sources and replaces invalid output with diagnostics", async ({ page }) => {
  await page.goto("./playground");
  const status = page.locator("#compile-status");
  const source = page.getByRole("textbox", { name: "Source code", exact: true });
  const generated = page.getByRole("textbox", { name: "Generated code", exact: true });
  const generatedFile = page.getByRole("combobox", { name: "Generated file", exact: true });
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("kitchen-sink");
  await expect(generated).toHaveValue(/function action__publishPage/);
  const tokenColors = (view: string) => page.locator(`.code-editor[data-highlighted] ${view} .line > span`)
    .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size);
  await expect.poll(() => tokenColors("#generated-view")).toBeGreaterThan(3);
  await expect.poll(() => tokenColors("#source-view")).toBeGreaterThan(3);
  await source.press("End");
  await source.pressSequentially(" // typed");
  await expect(page.locator(".code-editor[data-highlighted] #source-view")).toHaveText(await source.inputValue());
  await expect(status).toHaveAttribute("data-state", "ok");
  await generatedFile.selectOption("zero/app/schema.php");
  await expect(generated).toHaveValue(/'postType' => 'zero_pages'/);
  await expect(generated).toHaveValue(/'admin' => true/);

  await page.getByRole("button", { name: "Post writes", exact: true }).click();
  await expect(generatedFile).toHaveValue("runtime/Zero/Wp/WpPostStore.php");
  await expect(generated).toHaveValue(/wp_insert_post\(wp_slash\(\$post\), true\)/);
  await expect(page.locator("#file-description")).toContainText("Shared WordPress runtime");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(generated).toHaveValue(/wp_insert_user\(/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("pantry");
  await generatedFile.selectOption("zero/app/functions.php");
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  const original = await source.inputValue();
  await source.fill(original.replace("name can't be empty", "Give this item a name"));
  await expect(generated).toHaveValue(/Give this item a name/);
  await generatedFile.selectOption("zero/app/schema.php");
  await expect(generated).toHaveValue(/<\?php[\s\S]*'collections' =>/);

  await page.getByRole("combobox", { name: "Source file", exact: true }).selectOption("lib/fields.ts");
  await source.fill((await source.inputValue()).replace("LOW_STOCK = 1", "LOW_STOCK = 7"));
  await expect(generated).toHaveValue(/'lowStockAt' => [^\n]*'value' => 7/);

  await source.fill("export const =");
  await expect(status).toHaveAttribute("data-state", "diagnostics");
  await expect(page.getByRole("alert")).toContainText("lib/fields.ts");
  await expect(generated).toHaveValue("");
  await expect(page.getByRole("button", { name: "Download file" })).toBeDisabled();

  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(original);
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("blog");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/export const posts/);
  await generatedFile.selectOption("zero/app/schema.php");
  await expect(generated).toHaveValue(/'posts' =>/);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("schema.php");
  expect(await readFile(await download.path(), "utf8")).toBe(await generated.inputValue());

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("recipes");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/seoFields\(\)/);
  await expect(generated).toHaveValue(/'postType' => 'zero_articles'/);
  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("wp-plugins");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/"classic-editor": "1.6.7"/);
  await expect(generated).toHaveValue(/'postType' => 'zero_notes'/);
});
