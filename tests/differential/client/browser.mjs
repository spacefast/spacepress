// Usage: node browser.mjs <url>
// Loads a page with compiled client components in Chromium (playwright-core, pinned by
// tests/differential/client/package.json). It checks that hydration changes nothing in the server HTML (a MutationObserver
// registered before any module runs), that the Interactivity runtime logs no warnings (SCRIPT_DEBUG
// serves its development build), that clicks run the compiled stores, and that a CSS module's
// classes style the element, and that
// reactive lists and conditionals re-render from their templates. Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");
const executablePath = chromiumPath();
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath });
try {
  const page = await browser.newPage();
  const warnings = [];
  // The schema refusal below is a 422 on purpose: it is the answer that check asks for.
  const refusal = (u) => u.includes("/clients/like/run");
  let expectRefusal = false;
  page.on("console", (m) => { if ((m.type() === "warning" || m.type() === "error") && !(expectRefusal && m.text().includes("422"))) warnings.push(m.text()); });
  page.on("pageerror", (e) => warnings.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !(r.status() === 422 && refusal(decodeURIComponent(r.url())))) warnings.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__mutations = [];
    window.__moved = [];
    window.__server = new Set();
    window.__islands = () => [...document.querySelectorAll("[data-wp-interactive^='clients/']")].map((island) => {
      const copy = island.cloneNode(true);
      for (const t of copy.querySelectorAll("template")) t.remove();
      return copy.outerHTML;
    });
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        if (r.target.closest?.("[data-wp-interactive^='clients/']") || r.target.parentElement?.closest?.("[data-wp-interactive^='clients/']")) {
          // The runtime takes each list's or conditional's `<template>` out of the page, and
          // Preact moves the siblings after it back in front: the same nodes, the same HTML.
          // Whether a moved node is the server's own is checked once hydration is done.
          if (r.type === "childList") {
            for (const n of r.removedNodes) if (n.nodeName !== "TEMPLATE") window.__moved.push(n);
            for (const n of r.addedNodes) window.__moved.push(n);
            continue;
          }
          const nodes = (list) => [...list].map((n) => n.nodeType === 3 ? JSON.stringify(n.data) : n.nodeName).join(",");
          // The runtime may set an attribute to the value it already has (`data-wp-bind--class`
          // does): the HTML is unchanged, so that is not a hydration change.
          if (r.type === "attributes" && r.oldValue === r.target.getAttribute(r.attributeName)) continue;
          window.__mutations.push(r.type + ":" + (r.attributeName ?? r.target.nodeName) + (r.type === "attributes" ? `=${JSON.stringify(r.oldValue)}->${JSON.stringify(r.target.getAttribute(r.attributeName))}` : "") + (r.type === "childList" ? ` -[${nodes(r.removedNodes)}] +[${nodes(r.addedNodes)}]` : ""));
        }
      }
    });
    // Parsing is done at "interactive", and module scripts (the Interactivity runtime and the
    // stores) run after that: everything recorded from here on is hydration.
    document.addEventListener("readystatechange", () => {
      if (document.readyState !== "interactive") return;
      // Every node the server sent, so a node the runtime re-creates doesn't pass as moved, and
      // each island's HTML apart from its templates, to compare once hydration is done.
      window.__html = window.__islands();
      for (const island of document.querySelectorAll("[data-wp-interactive^='clients/']")) {
        const walk = document.createTreeWalker(island);
        for (let n = walk.currentNode; n; n = walk.nextNode()) window.__server.add(n);
      }
      observer.observe(document, { subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true });
    });
  });
  const responses = [];
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  // The component's action runs as its WordPress Ability, at core's run route (pretty `/wp-json/…`
  // or `?rest_route=…`, as the site's REST root is).
  const ran = (u) => decodeURIComponent(u).includes("/wp-abilities/v1/abilities/");
  const abilityRuns = [];
  page.on("request", (r) => {
    if (!ran(r.url())) return;
    abilityRuns.push(`${r.method()} ${decodeURIComponent(r.url()).replace(/^.*?(\/wp-abilities\/)/, "$1").replace(/[?&].*$/, "")} ${r.headers()["x-wp-nonce"] ? "nonce" : "no nonce"}`);
  });
  page.on("response", async (r) => { if (ran(r.url()) && r.request().method() === "POST") responses.push([r.status(), await r.text().catch(() => "")]); });
  // One guest before the page renders, so the server's answer has a row in it: as a visitor, at the run route.
  const seeded = await fetch(new URL("wp-json/wp-abilities/v1/abilities/clients/guestbook-create/run", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { name: "Ada" } }) });
  if (seeded.status !== 200) throw new Error(`seed: ${seeded.status} ${await seeded.text()}`);
  await page.goto(url, { waitUntil: "networkidle" });
  // The stores are loaded and hydrated once a click changes the DOM.
  const before = await page.textContent("[data-wp-interactive='clients/LikeButton']");
  const hydration = await page.evaluate(() => [
    ...window.__mutations.filter((m) => !m.startsWith("attributes:data-wp-")),
    ...window.__moved.filter((n) => !window.__server.has(n) || !n.isConnected).map((n) => `replaced:${n.nodeName}`),
    ...window.__islands().filter((html, i) => html !== window.__html[i]).map((html, i) => `html: ${window.__html[i]} -> ${html}`),
  ]);
  await page.click("[data-wp-interactive='clients/LikeButton']");
  await page.waitForFunction(() => document.querySelector("[data-wp-interactive='clients/LikeButton']").textContent.includes("141"), null, { timeout: 15000 })
    .catch((e) => { throw new Error(`${e.message}\nresponses: ${JSON.stringify(responses)}\nwarnings: ${JSON.stringify(warnings)}`); });
  const after = await page.textContent("[data-wp-interactive='clients/LikeButton']");
  // The page's own client, called with input the ability's schema refuses: core's run route answers
  // 422 and the error is the client's own type.
  expectRefusal = true;
  const refused = await page.evaluate(async () => {
    const { createClient, SpacePressError } = await import("@spacepress/client");
    const error = await createClient().actions.like({ postId: "not a number" }).catch((e) => e);
    return { typed: error instanceof SpacePressError, status: error.status, code: error.code };
  });
  expectRefusal = false;
  await page.click("text=add");
  await page.click("text=add");
  // The effect (`data-wp-watch`) runs after the state change that triggers it, not with it.
  await page.waitForFunction(() => document.querySelector("i").textContent === String(Number(document.querySelector("output").textContent) * 10), null, { timeout: 15000 });
  const output = await page.textContent("output");
  const items = await page.textContent("u");
  const seen = await page.textContent("i");
  // `ref={box}` on the <output>: a handler reads the element through the ref.
  await page.click("button.measure");
  await page.waitForFunction(() => document.querySelector("button.measure").textContent !== "unmeasured", null, { timeout: 15000 });
  const ref = await page.textContent("button.measure");
  // A CSS module's renamed class, switched by state, styles the element from the linked stylesheet.
  const toggle = "[data-wp-interactive='clients/Toggle']";
  const look = () => page.$eval(toggle, (el) => [el.className, getComputedStyle(el).color, el.textContent]);
  const toggleBefore = await look();
  await page.click(toggle);
  await page.waitForFunction((s) => document.querySelector(s).textContent === "on", toggle, { timeout: 15000 });
  const toggleAfter = await look();
  // A reactive list and conditionals re-render from their <template>s as state changes; the
  // server-rendered items stay the same nodes until state removes them.
  const shelf = "[data-wp-interactive='clients/Shelf']";
  const read = () => page.$eval(shelf, (el) => ({
    books: [...el.querySelectorAll("li.shelf-book")].map((li) => `${li.dataset.id}:${li.textContent}`),
    open: el.querySelectorAll("p.shelf-open").length,
    count: el.querySelector("strong.shelf-count")?.textContent ?? null,
    empty: el.querySelectorAll("em.shelf-empty").length,
  }));
  const settle = (want) => page.waitForFunction(([s, w]) => {
    const el = document.querySelector(s);
    return [...el.querySelectorAll("li.shelf-book")].map((li) => li.dataset.id).join(",") === w;
  }, [shelf, want], { timeout: 15000 });
  const first = await page.$(`${shelf} li.shelf-book`);
  const shelfSteps = [await read()];
  await page.click(`${shelf} .shelf-add`);
  await settle("1,2,3");
  shelfSteps.push(await read());
  const kept = await first.evaluate((li) => li.isConnected);
  await page.click(`${shelf} .shelf-toggle`);
  await page.waitForFunction((s) => !document.querySelector(`${s} p.shelf-open`), shelf, { timeout: 15000 });
  shelfSteps.push(await read());
  for (const want of ["2,3", "3", ""]) {
    await page.click(`${shelf} .shelf-drop`);
    await settle(want);
  }
  await page.waitForFunction((s) => document.querySelector(`${s} em.shelf-empty`), shelf, { timeout: 15000 });
  shelfSteps.push(await read());
  await page.click(`${shelf} .shelf-toggle`);
  await page.click(`${shelf} .shelf-add`);
  await settle("1");
  await page.waitForFunction((s) => document.querySelector(`${s} p.shelf-open`) && document.querySelector(`${s} strong.shelf-count`), shelf, { timeout: 15000 });
  shelfSteps.push(await read());
  // The app's typed client is served as a browser module (`@spacepress/client`): it loads with no
  // bundler and exports the client every live read uses.
  const client = await page.evaluate(async () => {
    const url = new URL("wp-content/plugins/spacepress-app-clients/sp/app/client/spacepress-client.js", document.baseURI.replace(/[^/]*$/, ""));
    const response = await fetch(url);
    const m = await import(url.href);
    return [response.status, response.headers.get("content-type"), typeof m.createClient, typeof m.createClient({ url: location.origin + "/wp-json" }).actions.like];
  });
  // `useLive`: the server answered the guestbook read in the first render; another visitor's
  // write (straight to the API, no cookies) shows on this page with no reload, by the client's poll.
  const guests = () => page.$$eval("[data-wp-interactive='clients/Guestbook'] li.guest", (li) => li.map((x) => x.textContent));
  const liveBefore = await guests();
  const loadingAttr = await page.getAttribute("[data-wp-interactive='clients/Guestbook']", "data-loading");
  const write = await fetch(new URL("wp-json/wp-abilities/v1/abilities/clients/guestbook-create/run", url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: { name: "Grace" } }) });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-wp-interactive='clients/Guestbook'] li.guest")].some((li) => li.textContent === "Grace"), null, { timeout: 45000 })
    .catch((e) => { throw new Error(`${e.message}\nwarnings: ${JSON.stringify(warnings)}`); });
  const liveAfter = await guests();
  // Signed in, the same page runs the action at its run route with the REST nonce the page prints (core lists abilities
  // to a signed-in user): its run route carries the REST nonce the page printed for the client.
  const signedIn = await browser.newPage();
  const signedRuns = [];
  signedIn.on("pageerror", (e) => warnings.push(String(e)));
  signedIn.on("request", (r) => {
    const u = decodeURIComponent(r.url());
    if (u.includes("/wp-abilities/v1/abilities")) signedRuns.push(`${r.method()} ${u.replace(/^.*?(\/wp-abilities\/)/, "$1").replace(/[?&].*$/, "")} ${r.headers()["x-wp-nonce"] ? "nonce" : "no nonce"}`);
  });
  await signedIn.goto(`${url}wp-login.php?redirect_to=${encodeURIComponent(url)}`);
  // wp-login.php focuses and selects its username field 200 ms after it loads; fill after that.
  await signedIn.waitForTimeout(300);
  await signedIn.fill("#user_login", "admin");
  await signedIn.fill("#user_pass", "spacepress-test-admin");
  await Promise.all([signedIn.waitForNavigation(), signedIn.click("#wp-submit")]);
  if (new URL(signedIn.url()).pathname !== new URL(url).pathname) await signedIn.goto(url, { waitUntil: "networkidle" });
  const signedBefore = await signedIn.textContent("[data-wp-interactive='clients/LikeButton']");
  await signedIn.click("[data-wp-interactive='clients/LikeButton']");
  await signedIn.waitForFunction(() => document.querySelector("[data-wp-interactive='clients/LikeButton']").textContent.includes("141"), null, { timeout: 15000 })
    .catch((e) => { throw new Error(`${e.message}\nsigned in: ${JSON.stringify(signedRuns)}\nwarnings: ${JSON.stringify(warnings)}`); });
  const signed = {
    before: signedBefore,
    after: await signedIn.textContent("[data-wp-interactive='clients/LikeButton']"),
    // The action's run, with the nonce (`me` reads the app API's `/me`).
    runs: signedRuns,
    me: await signedIn.evaluate(async () => (await (await import("@spacepress/client")).createClient().auth.me())?.name ?? null),
  };
  await signedIn.close();
  const liveRequests = requests.filter((r) => decodeURIComponent(r).replace(/[?&].*$/, "").endsWith("/_live") || decodeURIComponent(r).includes("rest_route=/spacepress/v1/_live")).length;
  process.stdout.write(JSON.stringify({ abilityRuns, refused, signed, live: { before: liveBefore, loading: loadingAttr, write: write.status, after: liveAfter, polled: liveRequests > 0 }, client, before, after, hydration, output, items, seen, ref, toggleBefore, toggleAfter, shelfSteps, kept, warnings, responses }));
} finally {
  await browser.close();
}
