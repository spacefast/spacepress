// Usage: node forms-submit.mjs <site url>
// The JavaScript submit of `<form action={name}>` in Chromium (tests/app_router.rs
// `forms_submit_in_place_in_the_browser`), on tests/fixtures/forms. A submit swaps the page in place
// (a window marker and the document's navigation entry survive), the result or the error shows, the
// page is fetched once with its flash, and the URL bar ends on the page without `?_flash`. The form is
// busy while the post is in flight and a second submit then sends nothing. The pressed button's name
// and value are sent, also from a button outside the form (`form="id"`). A failure after the post
// was sent shows an error and posts nothing again. A `<Live>` update or a `<Link>` click during a
// submit wins over neither. Only a router module that can't load falls back to the browser's post.
// Prints JSON.
import { createRequire } from "node:module";
import { chromiumPath } from "./chromium.mjs";

const { chromium } = createRequire(import.meta.url)("playwright-core");

const [url] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: chromiumPath() });
const out = { errors: [] };
const path = (href) => { const u = new URL(href); return u.pathname + u.search; };
// The form's busy state and its buttons' disabled states.
const busy = (page, form) => page.$eval(form, (f) => ({ busy: f.getAttribute("aria-busy"), disabled: [...f.querySelectorAll("button")].map((b) => b.disabled) }));

// A page whose errors are collected. A failed load this test causes itself (an aborted request or a
// 500 it answers) is the browser's console noise, not an error of the page.
async function open(href) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => out.errors.push(String(e)));
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !m.text().startsWith("Failed to load resource")) out.errors.push(m.text());
  });
  const posts = [];
  const pages = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/wp-json/spacepress/v1/actions/")) posts.push(path(r.url()));
    if (r.resourceType() === "document" || r.url().includes("_flash=")) pages.push(`${r.method()} ${path(r.url())}`);
  });
  await page.goto(href, { waitUntil: "networkidle" });
  return { page, posts, pages };
}

// Holds the posts to `pattern` until `release()`: the page is seen while they are in flight.
async function hold(page, pattern) {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(pattern, async (route) => { await held; await route.continue().catch(() => {}); });
  return async () => { release(); await page.unroute(pattern); };
}

try {
  const { page, posts, pages } = await open(`${url}/?ref=nav`);
  out.directive = await page.$eval("form.subscribe", (f) => [f.getAttribute("data-wp-interactive"), f.getAttribute("data-wp-on--submit")]);
  // A tall page scrolled down to the form (the padding is outside the router region, so the swap
  // leaves it): the swap doesn't jump to the top.
  await page.evaluate(() => { window.spMarker = "same document"; document.body.style.padding = "2000px 0"; window.scrollTo(0, 1900); });
  const historyBefore = await page.evaluate(() => history.length);

  // A submit that succeeds, held in flight: the form is busy, and a second submit sends nothing.
  let release = await hold(page, "**/wp-json/spacepress/v1/actions/subscribe");
  await page.fill("form.subscribe [name=email]", "ada@example.test");
  await page.fill("form.subscribe [name=seats]", "3");
  await page.check("form.subscribe [name=weekly]");
  await page.fill("form.subscribe [name=note]", "Typed note");
  pages.length = 0;
  posts.length = 0;
  await page.click("form.subscribe button");
  await page.waitForFunction(() => document.querySelector("form.subscribe")?.getAttribute("aria-busy") === "true");
  out.pending = await busy(page, "form.subscribe");
  await page.evaluate(() => document.querySelector("form.subscribe").requestSubmit());
  const scrolled = await page.evaluate(() => window.scrollY);
  await release();
  await page.waitForSelector(".done", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("form.subscribe").hasAttribute("aria-busy"));
  out.success = {
    done: await page.textContent(".done"),
    posts: [...posts],
    marker: await page.evaluate(() => window.spMarker ?? null),
    navigations: await page.evaluate(() => performance.getEntriesByType("navigation").length),
    url: path(page.url()),
    historyAdded: (await page.evaluate(() => history.length)) - historyBefore,
    requests: [...pages],
    afterPending: await busy(page, "form.subscribe"),
    // Where it was, give or take the paragraph the result added above the form.
    scrollKept: scrolled >= 1900 && Math.abs((await page.evaluate(() => window.scrollY)) - scrolled) < 100,
    focus: await page.evaluate(() => document.activeElement?.tagName),
    // The form starts over after a success, as a page load leaves it.
    reset: await page.$eval("form.subscribe", (f) => ({ state: f.getAttribute("data-sp-form-state"), email: f.elements.email.value, note: f.elements.note.value, weekly: f.elements.weekly.checked })),
  };

  // A submit the action refuses (422): the error and the typed values, in place.
  await page.fill("form.subscribe [name=email]", "grace@example.test");
  await page.fill("form.subscribe [name=seats]", "9");
  await page.fill("form.subscribe [name=note]", "Kept note");
  pages.length = 0;
  await page.click("form.subscribe button");
  await page.waitForSelector(".error", { timeout: 15000 });
  out.refused = {
    error: await page.textContent(".error"),
    code: await page.getAttribute(".error", "data-code"),
    done: await page.$(".done").then((el) => el !== null),
    email: await page.inputValue("form.subscribe [name=email]"),
    // A refused form keeps what was typed, and says so.
    kept: await page.$eval("form.subscribe", (f) => [f.getAttribute("data-sp-form-state"), f.elements.note.value]),
    marker: await page.evaluate(() => window.spMarker ?? null),
    url: path(page.url()),
    requests: [...pages],
  };

  // The pressed button's name and value: one inside the form, then one outside it (`form="vote"`),
  // held to see it disabled. A button the page itself disabled stays disabled.
  await page.click(".vote .maybe");
  await page.waitForSelector(".voted", { timeout: 15000 });
  const maybe = await page.textContent(".voted");
  await page.evaluate(() => { document.querySelector(".vote .yes").disabled = true; });
  release = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
  await page.click("button.outside");
  await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
  const outsidePending = await page.$eval("button.outside", (b) => [b.disabled, b.hasAttribute("data-sp-pending")]);
  const yesPending = await page.$eval(".vote .yes", (b) => b.hasAttribute("data-sp-pending"));
  // A button the page disabled isn't marked, so the submit doesn't enable it. (The swap then renders
  // the buttons as the server sent them.)
  await release();
  await page.waitForFunction(() => document.querySelector(".voted")?.textContent === "Voted no", null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("form.vote").hasAttribute("aria-busy"));
  out.buttons = {
    maybe,
    no: await page.textContent(".voted"),
    outsidePending,
    yesPending,
    after: await page.evaluate(() => [".vote .maybe", "button.outside"].map((s) => document.querySelector(s).disabled)),
  };

  // The post reached the server and the answer is a 500: an error in the form, nothing sent again.
  await page.route("**/wp-json/spacepress/v1/actions/subscribe", async (route) => {
    await route.fetch({ maxRedirects: 0 }); // the action runs
    await route.fulfill({ status: 500, contentType: "text/html", body: "<!DOCTYPE html><h1>Server error</h1>" });
  });
  await page.fill("form.subscribe [name=email]", "fail@example.test");
  await page.fill("form.subscribe [name=seats]", "1");
  posts.length = 0;
  await page.click("form.subscribe button");
  await page.waitForSelector("form.subscribe [data-sp-form-error]", { timeout: 15000 });
  await page.waitForTimeout(1000);
  out.failed = {
    posts: [...posts],
    message: await page.$eval("form.subscribe [data-sp-form-error]", (p) => [p.getAttribute("role"), p.textContent.length > 0]),
    afterPending: await busy(page, "form.subscribe"),
    marker: await page.evaluate(() => window.spMarker ?? null),
  };
  await page.unroute("**/wp-json/spacepress/v1/actions/subscribe");

  // No answer at all (the connection drops): the post may have run, so the same, never a repost.
  await page.route("**/wp-json/spacepress/v1/actions/subscribe", (route) => route.abort("failed"));
  posts.length = 0;
  await page.click("form.subscribe button");
  await page.waitForFunction(() => !document.querySelector("form.subscribe").hasAttribute("aria-busy"), null, { timeout: 15000 });
  await page.waitForTimeout(1000);
  out.dropped = {
    posts: [...posts],
    message: await page.$("form.subscribe [data-sp-form-error]").then((el) => el !== null),
    marker: await page.evaluate(() => window.spMarker ?? null),
  };
  await page.unroute("**/wp-json/spacepress/v1/actions/subscribe");

  // A `<Link>` click while a submit is in flight: the page linked to stays, the answer is dropped.
  release = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
  await page.click(".vote .maybe");
  await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
  await page.click("a.other");
  await page.waitForSelector(".other-page", { timeout: 15000 });
  const flashed = page.waitForResponse((r) => r.url().includes("_flash="), { timeout: 15000 });
  await release();
  await flashed;
  await page.waitForTimeout(1000);
  // Both links request prefetch. The region router owns only the same-template destination.
  out.prefetch = await page.locator('a[data-wp-on--mouseenter]').evaluateAll((links) =>
    links.map((link) => [link.textContent, link.classList.contains("no-prefetch")])
  );
  out.link = {
    url: path(page.url()),
    other: await page.$(".other-page").then((el) => el !== null),
    voted: await page.$(".voted").then((el) => el !== null),
    marker: await page.evaluate(() => window.spMarker ?? null),
  };
  await page.close();

  // A `<Link>` to a page slower than the post: the post's answer arrives first, while the URL is
  // still the form's page, and must not cancel the navigation the click started.
  {
    const { page } = await open(`${url}/?ref=nav`);
    await page.evaluate(() => { window.spMarker = "same document"; });
    let releaseLink;
    const linkHeld = new Promise((r) => { releaseLink = r; });
    await page.route("**/other/", async (route) => { await linkHeld; await route.continue().catch(() => {}); });
    const releasePost = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
    await page.click(".vote .maybe");
    await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
    await page.click("a.other");
    const flashed = page.waitForResponse((r) => r.url().includes("_flash="), { timeout: 15000 });
    await releasePost();
    await flashed;
    await page.waitForTimeout(500);
    const beforeLink = { url: path(page.url()), voted: await page.$(".voted").then((el) => el !== null) };
    releaseLink();
    await page.unroute("**/other/");
    await page.waitForSelector(".other-page", { timeout: 15000 });
    out.slowLink = {
      beforeLink,
      url: path(page.url()),
      other: await page.$(".other-page").then((el) => el !== null),
      marker: await page.evaluate(() => window.spMarker ?? null),
    };
    await page.close();
  }

  // Two forms sent at once, the older answer last: the newer page stays, and the older form says
  // its result isn't shown.
  {
    const { page } = await open(`${url}/?ref=nav`);
    const releaseVote = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
    await page.click(".vote .yes");
    await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
    await page.fill("form.subscribe [name=email]", "two@example.test");
    await page.fill("form.subscribe [name=seats]", "2");
    await page.click("form.subscribe button");
    await page.waitForSelector(".done", { timeout: 15000 });
    await releaseVote();
    await page.waitForFunction(() => !document.querySelector("form.vote").hasAttribute("aria-busy"), null, { timeout: 15000 });
    out.overtaken = {
      done: await page.textContent(".done"),
      voted: await page.$(".voted").then((el) => el !== null),
      message: await page.$eval("form.vote", (f) => f.querySelectorAll("[data-sp-form-error]").length),
    };
    await page.close();
  }

  // A browser whose FormData ignores the submitter (before Chrome 112, Safari 16.4, Firefox 111):
  // the pressed button's value is still sent.
  {
    const page = await browser.newPage();
    page.on("pageerror", (e) => out.errors.push(String(e)));
    await page.addInitScript(() => {
      const Native = window.FormData;
      window.FormData = class extends Native { constructor(form) { super(form); } };
    });
    await page.goto(`${url}/?ref=nav`, { waitUntil: "networkidle" });
    const bodies = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/actions/vote")) bodies.push(r.postData()); });
    await page.click(".vote .maybe");
    await page.waitForSelector(".voted", { timeout: 15000 });
    out.oldFormData = { voted: await page.textContent(".voted"), choices: bodies.map((b) => new URLSearchParams(b).getAll("choice")) };
    await page.close();
  }

  // `<Live>` and a form on one page: the region's update arrives while the post is in flight, and
  // waits for it; the page the post comes back to has both.
  {
    const { page } = await open(`${url}/live`);
    const live = [];
    page.on("response", async (r) => {
      if (r.url().endsWith("/wp-json/spacepress/v1/_live")) live.push((await r.json().catch(() => ({}))).data?.results?.map((x) => (x.changed ? "changed" : "unchanged")));
    });
    const release = await hold(page, "**/wp-json/spacepress/v1/actions/sign");
    await page.fill("form.sign [name=name]", "Mine");
    await page.click("form.sign button");
    await page.waitForFunction(() => document.querySelector("form.sign")?.getAttribute("aria-busy") === "true");
    // Another visitor's entry, and the region asked again at once (as a tab shown again asks).
    const write = await fetch(`${url}/wp-json/spacepress/v1/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Theirs" }) });
    const changed = page.waitForResponse(async (r) => r.url().endsWith("/wp-json/spacepress/v1/_live") && (await r.json().catch(() => ({}))).data?.results?.some((x) => x.changed), { timeout: 20000 });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await changed;
    await page.waitForTimeout(500);
    const whileHeld = await page.$$eval(".entry", (li) => li.map((x) => x.textContent));
    const heldBusy = await page.$eval("form.sign", (f) => f.getAttribute("aria-busy"));
    await release();
    await page.waitForSelector(".signed", { timeout: 15000 });
    await page.waitForTimeout(1000);
    out.live = {
      write: write.status,
      whileHeld,
      heldBusy,
      signed: await page.textContent(".signed"),
      entries: await page.$$eval(".entry", (li) => li.map((x) => x.textContent)),
      afterPending: await busy(page, "form.sign"),
    };

    // A region answer newer than the page a submit comes back to: that page is rendered by the
    // server first (held before it reaches the browser), then another visitor writes and the region's
    // answer arrives while the submit is still in flight. Once the submit's page is on, the region
    // still shows the newer entry.
    {
      // The page's own fetch of the post, held once its answer (the rendered page) is in hand.
      await page.evaluate(() => {
        const real = window.fetch;
        window.__held = new Promise((r) => { window.__releaseSubmit = r; });
        window.fetch = async (input, init) => {
          const response = await real(input, init);
          if (init?.method === "POST" && String(input).includes("/actions/sign")) {
            window.__rendered = true;
            await window.__held;
            window.fetch = real;
          }
          return response;
        };
      });
      await page.fill("form.sign [name=name]", "Before");
      await page.click("form.sign button");
      await page.waitForFunction(() => window.__rendered === true, null, { timeout: 15000 });
      await fetch(`${url}/wp-json/spacepress/v1/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Newer" }) });
      const changed = page.waitForResponse(async (r) => r.url().endsWith("/wp-json/spacepress/v1/_live") && (await r.json().catch(() => ({}))).data?.results?.some((x) => x.changed), { timeout: 20000 });
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await changed;
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__releaseSubmit());
      await page.waitForFunction(() => document.querySelector(".signed")?.textContent === "Signed Before", null, { timeout: 15000 });
      await page.waitForFunction(() => [...document.querySelectorAll(".entry")].some((li) => li.textContent === "Newer"), null, { timeout: 20000 }).catch(() => {});
      out.newerRegion = await page.$$eval(".entry", (li) => { const t = li.map((x) => x.textContent); return { before: t.includes("Before"), newer: t.includes("Newer") }; });
    }

    // The `sign` post runs, then a 500: one entry, one post, an error in the form.
    const posts = [];
    page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/actions/sign")) posts.push(1); });
    await page.route("**/wp-json/spacepress/v1/actions/sign", async (route) => {
      await route.fetch({ maxRedirects: 0 });
      await route.fulfill({ status: 500, contentType: "text/html", body: "<!DOCTYPE html><h1>Server error</h1>" });
    });
    await page.fill("form.sign [name=name]", "Once");
    await page.click("form.sign button");
    await page.waitForSelector("form.sign [data-sp-form-error]", { timeout: 15000 });
    await page.waitForTimeout(1000);
    const rows = (await (await fetch(`${url}/wp-json/spacepress/v1/entries`)).json()).data ?? [];
    out.ranOnce = { posts: posts.length, rows: rows.filter((r) => r.name === "Once").length };
    // A region update while the error shows: the message stays one, in the form, not copied into
    // the page the update builds. The next submit clears it.
    await page.unroute("**/wp-json/spacepress/v1/actions/sign");
    await fetch(`${url}/wp-json/spacepress/v1/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Later" }) });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.waitForFunction(() => [...document.querySelectorAll(".entry")].some((li) => li.textContent === "Later"), null, { timeout: 20000 });
    const boxesAfterLive = await page.$$eval("[data-sp-form-error]", (b) => b.length);
    await page.fill("form.sign [name=name]", "Again");
    await page.click("form.sign button");
    await page.waitForFunction(() => document.querySelector(".signed")?.textContent === "Signed Again", null, { timeout: 15000 });
    out.errorBox = { afterLive: boxesAfterLive, afterSubmit: await page.$$eval("[data-sp-form-error]", (b) => b.length) };
    await page.close();
  }

  // The server renders the button disabled on the page the post comes back to: it stays disabled
  // (the submit's own marker doesn't outlive the swap and enable it again). The page's status
  // message is announced.
  {
    const { page } = await open(`${url}/poll/`);
    await page.click("form.close button");
    await page.waitForSelector(".closed", { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector("form.close").hasAttribute("aria-busy"));
    await page.waitForFunction(() => document.getElementById("sp-form-announcer")?.textContent !== "", null, { timeout: 5000 });
    out.serverDisabled = await page.$eval("form.close button", (b) => ({ disabled: b.disabled, marked: b.hasAttribute("data-sp-pending") }));
    out.announced = await page.$eval("#sp-form-announcer", (r) => [r.getAttribute("aria-live"), r.textContent, r.closest("[data-wp-router-region]") === null]);
    await page.close();
  }

  // An action that runs and comes back to a page that is a 404 now (its entry was deleted): that
  // page is shown in place, not an error.
  {
    const made = await (await fetch(`${url}/wp-json/spacepress/v1/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Doomed" }) })).json();
    const { page } = await open(`${url}/entries/${made.data.id}`);
    await page.evaluate(() => { window.spMarker = "same document"; });
    await page.click("form.remove button");
    await page.waitForSelector(".missing", { timeout: 15000 });
    out.gone = {
      missing: await page.textContent(".missing"),
      error: await page.$("[data-sp-form-error]").then((el) => el !== null),
      marker: await page.evaluate(() => window.spMarker ?? null),
      url: path(page.url()),
    };
    await page.close();
  }

  // A submit whose answer renders in another block template (`<body data-sp-template>`): its page
  // loads in full, as a <Link> to it would, never a region swapped into other chrome.
  {
    const { page } = await open(`${url}/bare`);
    await page.evaluate(() => {
      window.spMarker = "same document";
      document.querySelector("form.bare-vote [name=_sp_return]").value = "/";
    });
    const from = await page.evaluate(() => document.body.dataset.spTemplate);
    await page.click("form.bare-vote button");
    await page.waitForFunction(() => document.body?.dataset.spTemplate === "sp-page" && document.querySelector(".voted"), null, { timeout: 15000 });
    out.otherTemplate = {
      from,
      to: await page.evaluate(() => document.body.dataset.spTemplate),
      voted: await page.textContent(".voted"),
      // One document, not a region swapped into other chrome: the theme's header and the page.
      header: await page.$$eval("header.wp-block-template-part", (h) => h.length),
      regions: await page.$$eval("[data-wp-router-region]", (r) => r.length),
      url: path(page.url()),
    };
    await page.close();
  }

  // A stale answer in another block template arriving after a `<Link>` navigation is dropped, not
  // navigated to (#537).
  {
    const { page } = await open(`${url}/?ref=nav`);
    await page.evaluate(() => {
      window.spMarker = "same document";
      window.spSubmittedVote = document.querySelector("form.vote");
      window.spSubmittedVote.querySelector("[name=_sp_return]").value = "/bare/";
    });
    const releaseVote = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
    await page.click(".vote .yes");
    await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
    await page.click("a.other");
    await page.waitForSelector(".other-page", { timeout: 15000 });
    const flashed = page.waitForResponse((r) => r.url().includes("_flash="), { timeout: 15000 });
    await releaseVote();
    await flashed;
    await page.waitForFunction(() => window.spSubmittedVote?.getAttribute("aria-busy") === null);
    out.otherTemplateStaleLink = {
      url: path(page.url()),
      other: await page.$(".other-page").then((el) => el !== null),
      template: await page.evaluate(() => document.body.dataset.spTemplate),
      marker: await page.evaluate(() => window.spMarker ?? null),
    };
    await page.close();
  }

  // A stale answer in another block template overtaken by a later submit stays on the newer submit's
  // page and marks the older form overtaken (#537).
  {
    const { page } = await open(`${url}/?ref=nav`);
    await page.evaluate(() => {
      window.spMarker = "same document";
      window.spSubmittedVote = document.querySelector("form.vote");
      window.spSubmittedVote.querySelector("[name=_sp_return]").value = "/bare/";
    });
    const releaseVote = await hold(page, "**/wp-json/spacepress/v1/actions/vote");
    await page.click(".vote .yes");
    await page.waitForFunction(() => document.querySelector("form.vote")?.getAttribute("aria-busy") === "true");
    await page.fill("form.subscribe [name=email]", "three@example.test");
    await page.fill("form.subscribe [name=seats]", "1");
    await page.click("form.subscribe button");
    await page.waitForSelector(".done", { timeout: 15000 });
    await releaseVote();
    await page.waitForFunction(() => window.spSubmittedVote?.getAttribute("aria-busy") === null);
    out.otherTemplateOvertaken = {
      url: path(page.url()),
      done: await page.textContent(".done"),
      template: await page.evaluate(() => document.body.dataset.spTemplate),
      marker: await page.evaluate(() => window.spMarker ?? null),
      message: await page.$eval("form.vote", (f) => f.querySelectorAll("[data-sp-form-error]").length),
    };
    await page.close();
  }

  // A form per row filled from what is stored (/rows). A refused submit refills that row, and a
  // `<Live>` update meanwhile keeps the refill and what is typed elsewhere. A success then shows the
  // stored name in the row, not the value it was first rendered with.
  {
    const { page } = await open(`${url}/rows/`);
    const second = "form.row:nth-of-type(2)";
    const firstName = await page.inputValue(`${second} [name=name]`);
    await page.fill(`${second} [name=name]`, "x");
    await page.check(`${second} [name=tags][value=red]`);
    await page.click(`${second} button:not([type])`);
    await page.waitForSelector(".rename-error", { timeout: 15000 });
    await page.fill("form.row:nth-of-type(1) [name=name]", "Typing here");
    const before = await page.textContent(".count");
    await fetch(`${url}/wp-json/spacepress/v1/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Another" }) });
    await page.waitForFunction((b) => document.querySelector(".count")?.textContent !== b, before, { timeout: 15000 });
    const afterLive = await page.$eval(second, (f) => ({ name: f.elements.name.value, red: f.querySelector("[name=tags][value=red]").checked, invalid: f.elements.name.getAttribute("aria-invalid") }));
    const typing = await page.inputValue("form.row:nth-of-type(1) [name=name]");
    await page.fill(`${second} [name=name]`, "Renamed row");
    await page.click(`${second} button:not([type])`);
    await page.waitForSelector(".renamed", { timeout: 15000 });
    out.rows = {
      firstName,
      afterLive,
      typing,
      renamed: await page.textContent(".renamed"),
      after: await page.$eval(second, (f) => ({ state: f.getAttribute("data-sp-form-state"), name: f.elements.name.value, red: f.querySelector("[name=tags][value=red]").checked, size: f.querySelector("[name=size]:checked")?.value })),
    };
    await page.close();
  }

  // The router module can't load: nothing was sent, so the browser posts the form itself, and the
  // page it comes back to shows the result with `?_flash` taken out of the address bar.
  {
    const page = await browser.newPage();
    await page.route("**/interactivity-router/**", (route) => route.abort("failed"));
    await page.goto(`${url}/?ref=nav`, { waitUntil: "networkidle" });
    await page.evaluate(() => { window.spMarker = "same document"; });
    await page.fill("form.subscribe [name=email]", "lin@example.test");
    await page.fill("form.subscribe [name=seats]", "2");
    await Promise.all([page.waitForNavigation({ timeout: 15000 }), page.click("form.subscribe button")]);
    await page.waitForSelector(".done", { timeout: 15000 });
    out.fallback = {
      done: await page.textContent(".done"),
      marker: await page.evaluate(() => window.spMarker ?? null),
      url: path(page.url()),
    };
    await page.close();
  }
} catch (e) {
  out.errors.push(String(e.stack ?? e));
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));
