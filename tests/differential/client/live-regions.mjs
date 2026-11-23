// Usage: node live-regions.mjs <site url>   (served with SP_SERVE_MU=live-regions-mu.php)
// `<Live>` regions in Chromium (tests/app_router.rs `live_regions_update_in_the_browser`): the page's
// one first request to the subscription endpoint, an unchanged answer that touches nothing, another
// visitor's write showing on the next poll without a reload, and a client component's state and an
// input's text surviving that update. Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const executablePath = chromiumPath();
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
const out = { errors: [] };
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") out.errors.push(m.text()); });
  const live = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/wp-json/spacepress/v1/_live")) live.push({ at: Date.now(), body: JSON.parse(r.postData() ?? "{}") });
  });
  const answers = [];
  page.on("response", async (r) => {
    if (r.url().endsWith("/wp-json/spacepress/v1/_live")) answers.push((await r.json().catch(() => ({}))).data?.results?.map((x) => (x.pending ? "pending" : x.changed ? "changed" : x.error ? "error" : "unchanged")));
  });
  // Count the page GET and its first subscription read together, before either request starts.
  const rendersBeforeGet = Number(await (await fetch(`${url}/__sp_test/renders`)).text());
  await page.goto(`${url}/board`, { waitUntil: "networkidle" });
  // The first request: one, carrying the region, answered unchanged. Waited for, not slept on.
  if (answers.length === 0) await page.waitForResponse((r) => r.url().endsWith("/wp-json/spacepress/v1/_live"), { timeout: 15000 });
  await page.waitForFunction(() => true); // the response handler above has run
  // The first request is the subscription's own first ask, not a poll: it goes out as the page's
  // modules run, well inside the shortest poll gap (2 s) after the document is ready.
  const ready = await page.evaluate(() => performance.timeOrigin + performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd);
  out.first = { requests: live.length, regions: live[0]?.body.queries?.map((q) => q.args?.region) ?? null, answer: answers[0] ?? null, beforePoll: live.length > 0 && live[0].at - ready < 2000 };
  // A fresh page with nothing changed is answered by counter: no render ran for that first request.
  const rendersAfterFresh = Number(await (await fetch(`${url}/__sp_test/renders`)).text());
  out.first.rendered = rendersAfterFresh - rendersBeforeGet;

  // State a visitor made: a click on the client component and text typed into the input.
  await page.click(".counter");
  await page.waitForFunction(() => document.querySelector(".counter").textContent === "clicked 1");
  await page.fill(".draft", "half a sentence");
  const counterNode = await page.$(".counter");
  await counterNode.evaluate((el) => { el.dataset.mark = "same node"; });

  // Another visitor signs: the region shows it with no reload, by the next poll.
  const write = await fetch(`${url}/wp-json/spacepress/v1/signatures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Grace" }) });
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
  out.answers = [...answers];
  await page.close();

  // A cached copy taken before the data changed (as an edge would serve it): the first request brings
  // the region current, with no poll needed.
  const cached = await (await fetch(`${url}/board`)).text();
  await fetch(`${url}/wp-json/spacepress/v1/signatures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Ada" }) });
  const stale = await browser.newPage();
  await stale.route(`${url}/board`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: cached }));
  const staleRequests = [];
  stale.on("request", (r) => { if (r.url().endsWith("/wp-json/spacepress/v1/_live")) staleRequests.push(Date.now()); });
  const staleAt = Date.now();
  await stale.goto(`${url}/board`, { waitUntil: "domcontentloaded" });
  out.stale = { cachedHasAda: cached.includes(">Ada<") };
  await stale.waitForFunction(() => [...document.querySelectorAll(".signature")].some((li) => li.textContent === "Ada"), null, { timeout: 15000 });
  out.stale = { ...out.stale, requests: staleRequests.length, ms: Date.now() - staleAt };

  // A tab opened in the background: nothing until it is shown, then one request for every region,
  // and a region a write made stale since the render updates then.
  const background = await browser.newPage();
  await background.addInitScript(() => {
    let state = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
    window.__show = () => {
      state = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    };
  });
  const hiddenRequests = [];
  background.on("request", (r) => { if (r.url().endsWith("/wp-json/spacepress/v1/_live")) hiddenRequests.push(JSON.parse(r.postData() ?? "{}").queries?.length ?? 0); });
  await background.goto(`${url}/board`, { waitUntil: "networkidle" });
  const whileHidden = hiddenRequests.length;
  await fetch(`${url}/wp-json/spacepress/v1/signatures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Back" }) });
  await background.evaluate(() => window.__show());
  await background.waitForFunction(() => [...document.querySelectorAll(".signature")].some((li) => li.textContent === "Back"), null, { timeout: 15000 });
  out.background = { whileHidden, afterShown: hiddenRequests.length - whileHidden, regions: hiddenRequests[whileHidden] ?? null };

  // A prerendered page (speculation rules, `document.prerendering`): nothing until it is activated,
  // then one request for its regions.
  const prerendered = await browser.newPage();
  await prerendered.addInitScript(() => {
    let pre = true;
    Object.defineProperty(document, "prerendering", { configurable: true, get: () => pre });
    window.__activate = () => {
      pre = false;
      document.dispatchEvent(new Event("prerenderingchange"));
    };
  });
  const preRequests = [];
  prerendered.on("request", (r) => { if (r.url().endsWith("/wp-json/spacepress/v1/_live")) preRequests.push(JSON.parse(r.postData() ?? "{}").queries?.length ?? 0); });
  await prerendered.goto(`${url}/board`, { waitUntil: "networkidle" });
  const beforeActivation = preRequests.length;
  await prerendered.evaluate(() => window.__activate());
  await prerendered.waitForResponse((r) => r.url().endsWith("/wp-json/spacepress/v1/_live"), { timeout: 15000 });
  out.prerendered = { beforeActivation, afterActivation: preRequests.length - beforeActivation, regions: preRequests[beforeActivation] ?? null };
  await prerendered.close();

  // A page restored from the back/forward cache: its DOM is the old HTML with the old seed. It asks
  // once on `pageshow` (`persisted`), and a region whose data changed meanwhile updates.
  const restored = await browser.newPage();
  const restoredRequests = [];
  restored.on("request", (r) => { if (r.url().endsWith("/wp-json/spacepress/v1/_live")) restoredRequests.push(Date.now()); });
  await restored.goto(`${url}/board`, { waitUntil: "networkidle" });
  if (restoredRequests.length === 0) await restored.waitForResponse((r) => r.url().endsWith("/wp-json/spacepress/v1/_live"), { timeout: 15000 });
  const beforeRestore = restoredRequests.length;
  await fetch(`${url}/wp-json/spacepress/v1/signatures`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Restored" }) });
  await restored.evaluate(() => window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
  await restored.waitForFunction(() => [...document.querySelectorAll(".signature")].some((li) => li.textContent === "Restored"), null, { timeout: 15000 });
  out.restored = { asked: restoredRequests.length - beforeRestore };
  await restored.close();

  // Signing in: on a SpacePress page that is WordPress's own login, a full navigation, after which the
  // region is the signed-in visitor's (a draft only editors read), and its first ask is answered
  // unchanged for that visitor, not for the signed-out one whose page came before.
  out.draft = (await fetch(`${url}/__sp_test/draft`, { method: "POST" })).status;
  const visitor = await browser.newPage();
  const signedAnswers = [];
  visitor.on("response", async (r) => {
    if (r.url().endsWith("/wp-json/spacepress/v1/_live")) signedAnswers.push((await r.json().catch(() => ({}))).data?.results?.map((x) => (x.changed ? "changed" : x.error ? "error" : "unchanged")));
  });
  await visitor.goto(`${url}/`, { waitUntil: "networkidle" });
  const outView = await visitor.$$eval("[data-sp-live='notes'] li.note", (li) => li.map((x) => x.textContent));
  await visitor.goto(`${url}/wp-login.php?redirect_to=${encodeURIComponent(`${url}/`)}`);
  await visitor.fill("#user_login", "admin");
  await visitor.fill("#user_pass", "spacepress-test-admin");
  await Promise.all([visitor.waitForNavigation(), visitor.click("#wp-submit")]);
  if (new URL(visitor.url()).pathname !== "/") await visitor.goto(`${url}/`);
  const answered = signedAnswers.length;
  await visitor.waitForResponse((r) => r.url().endsWith("/wp-json/spacepress/v1/_live"), { timeout: 15000 }).catch(() => {});
  out.signIn = {
    out: outView.includes("Secret draft"),
    in: (await visitor.$$eval("[data-sp-live='notes'] li.note", (li) => li.map((x) => x.textContent))).includes("Secret draft"),
    firstAnswerIn: signedAnswers[answered] ?? null,
  };
  await visitor.close();

  // `<Live>` around `<Comments>`, with a realtime transport live (a fake one the page registers
  // before any module runs, as a host's would be): a comment approved on the server shows at once
  // on a notice naming `wp:comments`, well before the 60-second safety poll a live transport leaves.
  const live2 = await browser.newPage();
  live2.on("pageerror", (e) => out.errors.push(String(e)));
  await live2.addInitScript(() => {
    window.__notices = [];
    const r = (window.__spRealtime ??= { waiters: new Set() });
    r.transport = {
      connect(deliver, status) {
        window.__deliver = deliver;
        queueMicrotask(() => status("live"));
        return () => {};
      },
    };
  });
  const requests2 = [];
  live2.on("request", (r) => { if (r.url().endsWith("/wp-json/spacepress/v1/_live")) requests2.push(Date.now()); });
  out.note = (await fetch(`${url}/__sp_test/note`, { method: "POST" })).status;
  await live2.goto(`${url}/notes/one`, { waitUntil: "networkidle" });
  if (requests2.length === 0) await live2.waitForResponse((r) => r.url().endsWith("/wp-json/spacepress/v1/_live"), { timeout: 15000 });
  const before = await live2.$$eval(".spacepress-comment-body", (b) => b.map((x) => x.textContent.trim()));
  const approve = await fetch(`${url}/__sp_test/approve`, { method: "POST" });
  out.approve = approve.status;
  const sentBefore = requests2.length;
  const noticeAt = Date.now();
  await live2.evaluate(() => window.__deliver({ id: "t", at: new Date().toISOString(), changes: [{ collection: "wp:comments", ops: ["update"], ids: null }] }));
  await live2.waitForFunction(() => [...document.querySelectorAll(".spacepress-comment-body")].some((b) => b.textContent.includes("Approved live")), null, { timeout: 15000 })
    .catch((e) => { throw new Error(`${e.message}\n${JSON.stringify({ before, errors: out.errors })}`); });
  out.transport = { before, after: await live2.$$eval(".spacepress-comment-body", (b) => b.map((x) => x.textContent.trim())), asked: requests2.length - sentBefore, ms: Date.now() - noticeAt };
  process.stdout.write(JSON.stringify(out));
} finally {
  await browser.close();
}
