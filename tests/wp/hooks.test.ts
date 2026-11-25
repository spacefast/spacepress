// The generated client's React hooks in a real browser: a React 19 app (tests/wp/hooks/app.tsx) is
// bundled with the client `spacepress build` wrote, served from this test, and run in Chromium against
// the tests/wp WordPress. `useQuery` shows another visitor's write with no reload and no push
// transport; a refused kind is an error state; `useMutation` shows an optimistic row, replaces it
// with the server's, and rolls it back when the write is refused.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { api, auth, harness, ok, run } from "./env.ts";

const here = join(dirname(fileURLToPath(import.meta.url)), "hooks");
const installed = existsSync(join(here, "node_modules/playwright-core"));
if (!installed && process.env.SP_WP_SKIP_BROWSER !== "1") {
  throw new Error("the hooks browser test requires: npm ci --prefix tests/wp/hooks --ignore-scripts && npx --prefix tests/wp/hooks playwright-core install chromium-headless-shell (or SP_WP_SKIP_BROWSER=1)");
}

let server: Server;
let origin = "";
let browser: any;
let page: any;
const requests: { url: string; body: string }[] = [];
const problems: string[] = [];

before(async () => {
  if (!installed) return;
  const require = createRequire(join(here, "package.json"));
  const bundle = require("esbuild").buildSync({
    entryPoints: [join(here, "app.tsx")], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    define: { "process.env.NODE_ENV": '"development"' }, logLevel: "silent",
  }).outputFiles[0].text;
  // The frontend is another origin than WordPress, as an external React site is.
  server = createServer((req, res) => {
    if (req.url === "/app.js") return void res.writeHead(200, { "content-type": "text/javascript" }).end(bundle);
    res.writeHead(200, { "content-type": "text/html" }).end(
      `<!doctype html><meta charset="utf-8"><div id="root"></div><script>window.__hooks=${JSON.stringify({ api, authorization: auth("subscriber").Authorization, run, pollMs: 200 })}</script><script src="/app.js"></script>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const cache = join(homedir(), ".cache/ms-playwright");
  const shell = readdirSync(cache).filter((n) => n.startsWith("chromium_headless_shell-")).sort().reverse()[0];
  browser = await require("playwright-core").chromium.launch({ executablePath: join(cache, shell, "chrome-headless-shell-linux64/chrome-headless-shell") });
  page = await browser.newPage();
  page.on("console", (m: any) => { if (m.type() === "error" && !/the server responded with a status of 40[13]/.test(m.text())) problems.push(m.text()); });
  page.on("pageerror", (e: Error) => problems.push(String(e)));
  page.on("request", (r: any) => { if (r.url().startsWith(harness.url) && r.method() !== "OPTIONS") requests.push({ url: r.url().slice(harness.url.length), body: r.postData() ?? "" }); });
  await page.goto(origin);
});

after(async () => {
  await browser?.close();
  server?.close();
});

const text = (selector: string) => page.locator(selector).innerText();
const items = async (selector: string) => (await page.locator(`${selector} li`).allInnerTexts()) as string[];
const until = (selector: string, value: string) => page.waitForFunction(([s, v]: string[]) => document.querySelector(s)?.textContent === v, [selector, value], { timeout: 15_000 });
const listed = (selector: string, values: string[]) =>
  page.waitForFunction(([s, v]: [string, string]) => JSON.stringify([...document.querySelectorAll(`${s} li`)].map((li) => li.textContent)) === v, [selector, JSON.stringify(values)], { timeout: 15_000 });

test("useQuery renders the first answer, and every hook of the page shares one request", { skip: !installed }, async () => {
  await until("#state", "ready");
  await until("#count", "0");
  assert.deepEqual(await items("#notes"), []);
  assert.equal(await text("#off"), "off", "a disabled query subscribes to nothing and is not loading");
  const first = requests.find((r) => r.url === "/wp-json/spacepress/v1/_live");
  assert.ok(first, JSON.stringify(requests));
  assert.deepEqual(JSON.parse(first.body).queries.map((q: any) => [q.kind, q.op]), [["guestNotes", "list"], ["guestNotes", "count"], ["signups", "list"], ["bigCounts", "list"]]);
  assert.ok(requests.every((r) => r.url === "/wp-json/spacepress/v1/_live"), "nothing but the subscription endpoint is called");
});

test("a kind the visitor may not read is an error state, not data", { skip: !installed }, async () => {
  await until("#secrets", "error 403 forbidden");
});

test("another visitor's write shows without a reload or a push transport, and both hooks update", { skip: !installed }, async () => {
  await ok("POST", "/guest_notes", { as: "editor", body: { body: `Hooks ${run} theirs` } });
  await listed("#notes", [`Hooks ${run} theirs`]);
  await until("#count", "1");
  await until("#secrets", "error 403 forbidden");
});

test("polls that change nothing do not re-render", { skip: !installed }, async () => {
  const renders = Number(await text("#renders"));
  await new Promise<void>((resolve) => {
    const started = requests.length;
    const timer = setInterval(() => requests.length >= started + 3 && (clearInterval(timer), resolve()), 50);
  });
  assert.equal(Number(await text("#renders")), renders, "three more polls, no render");
});

test("useMutation shows the optimistic row at once, then the server's row", { skip: !installed }, async () => {
  // Hold the write's response so the optimistic frame can be observed.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${harness.url}/wp-json/spacepress/v1/guest_notes`, async (route: any) => {
    if (route.request().method() !== "POST") return route.continue();
    await held;
    await route.continue();
  });
  await page.click("#add");
  await listed("#notes", [`Hooks ${run} theirs`, `Hooks ${run} mine (saving)`]);
  assert.equal(await text("#adding"), "pending");
  assert.equal(await text("#count"), "1", "the server has not been written to yet");
  release();
  await listed("#notes", [`Hooks ${run} theirs`, `Hooks ${run} mine`]);
  await until("#adding", "idle");
  await until("#count", "2");
  await page.unroute(`${harness.url}/wp-json/spacepress/v1/guest_notes`);
});

test("a refused write rolls its optimistic row back and reports the error", { skip: !installed }, async () => {
  await until("#counts-state", "ready");
  assert.deepEqual(await items("#counts"), []);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`${harness.url}/wp-json/spacepress/v1/big_counts`, async (route: any) => {
    if (route.request().method() !== "POST") return route.continue();
    await held;
    await route.continue();
  });
  await page.click("#refuse");
  await listed("#counts", ["-9"]);
  release();
  await until("#refused", "error 403");
  await listed("#counts", []);
  await page.unroute(`${harness.url}/wp-json/spacepress/v1/big_counts`);
});

test("a hidden tab stops asking, and catches up when it is shown again", { skip: !installed }, async () => {
  const setVisibility = (state: string) => page.evaluate((s: string) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await setVisibility("hidden");
  // Two writes land while it is hidden. No request leaves the page after the first of them, so the
  // page still shows what it had. (At a 200 ms interval a visible page would have asked many times.)
  await ok("POST", "/guest_notes", { as: "editor", body: { body: `Hooks ${run} while hidden` } });
  const quiet = requests.length;
  await ok("POST", "/guest_notes", { as: "editor", body: { body: `Hooks ${run} still hidden` } });
  await ok("GET", "/guest_notes?limit=1", { as: "editor" });
  assert.equal(requests.length, quiet, "hidden: nothing asked across three round trips to the server");
  assert.equal((await items("#notes")).length, 2);
  await setVisibility("visible");
  await listed("#notes", [`Hooks ${run} theirs`, `Hooks ${run} mine`, `Hooks ${run} while hidden`, `Hooks ${run} still hidden`]);
});

test("the page logged no error", { skip: !installed }, () => {
  assert.deepEqual(problems, []);
});
