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
  await generatedFile.selectOption("tp/app/schema.php");
  await expect(generated).toHaveValue(/'postType' => 'tp_posts'/);
  await expect(generated).toHaveValue(/'sync' => \['dir' => 'content\/posts'/);

  await page.getByRole("button", { name: "Post writes", exact: true }).click();
  await expect(generatedFile).toHaveValue("runtime/TypedPress/Wp/WpPostStore.php");
  await expect(generated).toHaveValue(/wp_insert_post\(wp_slash\(\$post\), true\)/);
  await expect(page.locator("#file-description")).toContainText("Shared WordPress runtime");
  await page.getByRole("button", { name: "Users", exact: true }).click();
  await expect(generated).toHaveValue(/wp_insert_user\(/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("pantry");
  await generatedFile.selectOption("tp/app/functions.php");
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  const original = await source.inputValue();
  await source.fill(original.replace("name can't be empty", "Give this item a name"));
  await expect(generated).toHaveValue(/Give this item a name/);
  await generatedFile.selectOption("tp/app/schema.php");
  await expect(generated).toHaveValue(/<\?php[\s\S]*'collections' =>/);

  await page.getByRole("combobox", { name: "Source file", exact: true }).selectOption("tp/lib/fields.ts");
  await source.fill((await source.inputValue()).replace("LOW_STOCK = 1", "LOW_STOCK = 7"));
  await expect(generated).toHaveValue(/'lowStockAt' => [^\n]*'value' => 7/);

  await source.fill("export const =");
  await expect(status).toHaveAttribute("data-state", "diagnostics");
  await expect(page.getByRole("alert")).toContainText("tp/lib/fields.ts");
  await expect(generated).toHaveValue("");
  await expect(page.getByRole("button", { name: "Download file" })).toBeDisabled();

  await page.getByRole("button", { name: "Reset example" }).click();
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(original);
  await expect(generated).toHaveValue(/function items__beforeCreate/);

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("blog");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/export const posts/);
  await generatedFile.selectOption("tp/app/schema.php");
  await expect(generated).toHaveValue(/'posts' =>/);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download file" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("schema.php");
  expect(await readFile(await download.path(), "utf8")).toBe(await generated.inputValue());

  await page.getByRole("combobox", { name: "Example", exact: true }).selectOption("full-site");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(source).toHaveValue(/export const notes = collection/);
  await expect(generated).toHaveValue(/'postType' => 'tp_notes'/);
  await expect(page.locator("#example-description")).toContainText("Pages written in TSX");
});

/** The blueprint a Playground URL carries in its fragment. */
const blueprintOf = (src: string) => JSON.parse(decodeURIComponent(new URL(src).hash.slice(1))) as {
  landingPage: string;
  steps: { step: string; code?: string; pluginData?: { resource: string; url?: string; name?: string; files?: Record<string, unknown> } }[];
};

test("Run in WordPress runs the config in the editor", async ({ page }) => {
  // Playground itself isn't loaded: the frame gets an empty page, and the test reads its address.
  await page.route("https://playground.wordpress.net/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("./playground?example=pantry");
  const status = page.locator("#compile-status");
  const source = page.getByRole("textbox", { name: "Source code", exact: true });
  const frame = page.locator("#wordpress-frame");
  const run = page.getByRole("button", { name: "Run in WordPress" });
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });

  // As committed: the app plugin's schema has no `note`, and the example's sample data loads.
  await run.click();
  await expect(frame).toBeVisible();
  const committed = blueprintOf((await frame.getAttribute("src"))!);
  const app = (print: typeof committed) => print.steps.find((step) => step.pluginData?.name === "typedpress-app-pantry")!.pluginData!;
  expect(JSON.stringify(app(committed).files)).not.toContain("'note'");
  expect(committed.steps.some((step) => step.step === "runPHP")).toBe(true);

  // Edited: a new text field on items reaches the app plugin's schema and a new migration.
  await source.fill((await source.inputValue()).replace("  opened: boolean().default(false),", "  opened: boolean().default(false),\n  note: text().optional(),"));
  await expect(status).toHaveAttribute("data-state", "ok");
  const before = (await frame.getAttribute("src"))!;
  await run.click();
  await expect(frame).not.toHaveAttribute("src", before);
  const edited = blueprintOf((await frame.getAttribute("src"))!);
  const plugin = app(edited);
  expect(plugin.resource).toBe("literal:directory");
  const appFiles = plugin.files as { tp: { app: { "schema.php": string; migrations: Record<string, string> } } };
  expect(appFiles.tp.app["schema.php"]).toContain("'note'");
  expect(Object.keys(appFiles.tp.app.migrations)).toEqual(["0001_init.sql", "0002_update.sql", "0003_update.sql", "0004_update.sql", "0005_update.sql"]);
  expect(appFiles.tp.app.migrations["0005_update.sql"]).toMatch(/note/);
  // The schema changed, so the seed written for the committed schema stays out.
  expect(edited.steps.some((step) => step.step === "runPHP")).toBe(false);
  // TypedPress's shared plugins come from this site; the order is the activation order.
  const installs = edited.steps.filter((step) => step.step === "installPlugin").map((step) => step.pluginData!.url ?? step.pluginData!.name);
  expect(installs.slice(-4)).toEqual([expect.stringMatching(/\/files\/plugins\/typedpress-runtime\.zip$/), expect.stringMatching(/\/files\/plugins\/typedpress-identity\.zip$/), "typedpress-app-pantry", expect.stringMatching(/\/files\/plugins\/typedpress-admin\.zip$/)]);
  await expect(page.locator("#wordpress-note")).toContainText("sample data isn't loaded");
});

test("Run in WordPress says so when an edited config needs a plugin this WordPress doesn't install", async ({ page }) => {
  await page.route("https://playground.wordpress.net/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("./playground?example=pantry");
  const status = page.locator("#compile-status");
  const source = page.getByRole("textbox", { name: "Source code", exact: true });
  await expect(status).toHaveAttribute("data-state", "ok", { timeout: 30_000 });
  await expect(page.getByRole("combobox", { name: "Example", exact: true })).toHaveValue("pantry");
  expect(await source.inputValue()).toContain("export default defineConfig({});");
  // Pantry's lock has no hello-dolly, so the published WordPress can't install it.
  await source.fill((await source.inputValue()).replace("export default defineConfig({});", 'export default defineConfig({ plugins: { "hello-dolly": "1.7.2" } });'));
  await expect(status).toHaveAttribute("data-state", "ok");
  await page.getByRole("button", { name: "Run in WordPress" }).click();
  await expect(page.locator("#wordpress-note")).toContainText("hello-dolly 1.7.2");
  await expect(page.locator("#wordpress-note")).toContainText("can't run in WordPress here");
  await expect(page.locator("#wordpress-frame")).toBeHidden();
  expect(await page.locator("#wordpress-frame").getAttribute("src")).toBeNull();
});
