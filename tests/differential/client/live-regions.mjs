// Usage: node live-regions.mjs <site url>
// `<Live>` regions in Chromium (tests/app_router.rs `live_regions_update_in_the_browser`): the page's
// one first request to the subscription endpoint, an unchanged answer that touches nothing, another
// visitor's write showing on the next poll without a reload, and a client component's state and an
// input's text surviving that update. Prints JSON.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const cache = join(homedir(), ".cache/ms-playwright");
const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
const executablePath = process.env.FIRST_CHROMIUM ?? join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell");
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
const out = { errors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") out.errors.push(m.text()); });
  const live = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/__first/api/v1/_live")) live.push({ at: Date.now(), body: JSON.parse(r.postData() ?? "{}") });
  });
  const answers = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/__first/api/v1/_live")) answers.push((await r.json().catch(() => ({}))).data?.results?.map((x) => (x.pending ? "pending" : x.changed ? "changed" : x.error ? "error" : "unchanged")));
  });
  const loaded = Date.now();
  await page.goto(`${url}/board`, { waitUntil: "networkidle" });
  // The first request: one, carrying the region, answered unchanged. Waited for, not slept on.
  if (answers.length === 0) await page.waitForResponse((r) => r.url().endsWith("/__first/api/v1/_live"), { timeout: 15000 });
  await page.waitForFunction(() => true); // the response handler above has run
  out.first = { requests: live.length, regions: live[0]?.body.queries?.map((q) => q.args?.region) ?? null, answer: answers[0] ?? null, beforePoll: live.length > 0 && live[0].at - loaded < 2000 };

  // State a visitor made: a click on the client component and text typed into the input.
  await page.click(".counter");
  await page.waitForFunction(() => document.querySelector(".counter").textContent === "clicked 1");
  await page.fill(".draft", "half a sentence");
  const counterNode = await page.$(".counter");
  await counterNode.evaluate((el) => { el.dataset.mark = "same node"; });

  // Another visitor signs: the region shows it with no reload, by the next poll.
  const write = await fetch(`${url}/__first/api/v1/signatures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Grace" }) });
  out.write = write.status;
  await page.waitForFunction(() => [...document.querySelectorAll(".signature")].some((li) => li.textContent === "Grace"), null, { timeout: 45000 })
    .catch((e) => { throw new Error(`${e.message}\n${JSON.stringify({ answers, errors: out.errors })}`); });
  out.after = {
    signatures: await page.$$eval(".signature", (li) => li.map((x) => x.textContent)),
    counter: await page.textContent(".counter"),
    sameCounterNode: await page.$eval(".counter", (el) => el.dataset.mark ?? null),
    draft: await page.inputValue(".draft"),
    reloaded: await page.evaluate(() => performance.getEntriesByType("navigation").length),
  };
  out.answers = answers;
  process.stdout.write(JSON.stringify(out));
} finally {
  await browser.close();
}
