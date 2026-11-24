// Usage: node export-site.mjs <static site url>
// Reads a `typedpress export --site` output (tests/fixtures/app-export-site) in Chromium: the home page
// lists the hosted site's published notes, a note page's client component runs the hosted site's
// public action (its Ability) across origins and shows the stored count, and the sign-in link goes to the hosted
// site. Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const browser = await chromium.launch({ executablePath: chromiumPath() });
const out = { errors: [], actions: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("response", (r) => {
    if (r.status() >= 400) out.errors.push(`${r.status()} ${r.url()}`);
    if (r.url().includes("/wp-abilities/v1/abilities/")) out.actions.push([r.request().method(), new URL(r.url()).origin, r.status()]);
  });
  const site = process.argv[2];
  await page.goto(`${site}/`, { waitUntil: "networkidle" });
  out.home = await page.$$eval("ul.notes a", (as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
  out.signIn = await page.getAttribute("text=Sign in", "href");
  await page.click("text=Hello");
  await page.waitForSelector("article.note h1");
  out.note = [new URL(page.url()).pathname, await page.textContent("article.note h1"), await page.textContent(".cheer")];
  await page.click(".cheer");
  await page.waitForFunction(() => document.querySelector(".cheer").textContent === "1 cheers", null, { timeout: 15000 });
  await page.click(".cheer");
  await page.waitForFunction(() => document.querySelector(".cheer").textContent === "2 cheers", null, { timeout: 15000 });
  out.cheered = await page.textContent(".cheer");
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(out));
