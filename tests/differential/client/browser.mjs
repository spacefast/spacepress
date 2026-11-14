// Usage: node browser.mjs <url>
// Loads a page with compiled client components in Chromium (playwright-core, pinned by
// tests/differential/client/package.json). It checks that hydration changes nothing in the server HTML (a MutationObserver
// registered before any module runs), that the Interactivity runtime logs no warnings (SCRIPT_DEBUG
// serves its development build), that clicks run the compiled stores, and that a CSS module's
// classes style the element, and that
// reactive lists and conditionals re-render from their templates. Prints JSON.
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright-core");
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
  page.on("response", async (r) => { if (r.url().includes("/actions/")) responses.push([r.status(), await r.text().catch(() => "")]); });
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
  await page.click("text=add");
  await page.click("text=add");
  // The effect (`data-wp-watch`) runs after the state change that triggers it, not with it.
  await page.waitForFunction(() => document.querySelector("i").textContent === String(Number(document.querySelector("output").textContent) * 10), null, { timeout: 15000 });
  const output = await page.textContent("output");
  const items = await page.textContent("u");
  const seen = await page.textContent("i");
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
  process.stdout.write(JSON.stringify({ before, after, hydration, output, items, seen, toggleBefore, toggleAfter, shelfSteps, kept, warnings, responses }));
} finally {
  await browser.close();
}
