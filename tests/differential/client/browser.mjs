// Usage: node browser.mjs <url>
// Loads a page with compiled client components in Chromium (playwright-core, pinned by
// packages/pages). It checks that hydration changes nothing in the server HTML (a MutationObserver
// registered before any module runs), that the Interactivity runtime logs no warnings (SCRIPT_DEBUG
// serves its development build), and that clicks run the compiled stores. Prints JSON.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(new URL("../../../packages/pages/package.json", import.meta.url))("playwright-core");
const cache = join(homedir(), ".cache/ms-playwright");
const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const executablePath = join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell");
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage();
  const warnings = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(m.text()); });
  page.on("pageerror", (e) => warnings.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400) warnings.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__mutations = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.target.closest?.("[data-wp-interactive^='clients/']") || r.target.parentElement?.closest?.("[data-wp-interactive^='clients/']")) {
          const nodes = (list) => [...list].map((n) => n.nodeType === 3 ? JSON.stringify(n.data) : n.nodeName).join(",");
          window.__mutations.push(r.type + ":" + (r.attributeName ?? r.target.nodeName) + (r.type === "childList" ? ` -[${nodes(r.removedNodes)}] +[${nodes(r.addedNodes)}]` : ""));
        }
      }
    });
    // Parsing is done at "interactive", and module scripts (the Interactivity runtime and the
    // stores) run after that: everything recorded from here on is hydration.
    document.addEventListener("readystatechange", () => {
      if (document.readyState === "interactive") observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
  });
  const responses = [];
  page.on("response", async (r) => { if (r.url().includes("/actions/")) responses.push([r.status(), await r.text().catch(() => "")]); });
  await page.goto(url, { waitUntil: "networkidle" });
  // The stores are loaded and hydrated once a click changes the DOM.
  const before = await page.textContent("[data-wp-interactive='clients/LikeButton']");
  const hydration = await page.evaluate(() => window.__mutations.filter((m) => !m.startsWith("attributes:data-wp-")));
  await page.click("[data-wp-interactive='clients/LikeButton']");
  await page.waitForFunction(() => document.querySelector("[data-wp-interactive='clients/LikeButton']").textContent.includes("141"), null, { timeout: 15000 })
    .catch((e) => { throw new Error(`${e.message}\nresponses: ${JSON.stringify(responses)}\nwarnings: ${JSON.stringify(warnings)}`); });
  const after = await page.textContent("[data-wp-interactive='clients/LikeButton']");
  await page.click("text=add");
  await page.click("text=add");
  const output = await page.textContent("output");
  const items = await page.textContent("u");
  const seen = await page.textContent("i");
  process.stdout.write(JSON.stringify({ before, after, hydration, output, items, seen, warnings, responses }));
} finally {
  await browser.close();
}
