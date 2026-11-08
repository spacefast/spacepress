import assert from "node:assert/strict";
import { test } from "node:test";
import { harness } from "../env.ts";

const page = async (path: string) => {
  const response = await fetch(`${harness.url}${path}`, { redirect: "manual" });
  return { status: response.status, html: await response.text() };
};

test("converted 0.8 static pages are served by WordPress from the hosted compile", async () => {
  const home = await page("/");
  assert.equal(home.status, 200);
  assert.match(home.html, /<section class="[^"]*hero[^"]*">/);
  assert.match(home.html, /<h1[^>]*>Legacy Site<\/h1>/);
  // The 0.8 client Layout wraps every page.
  assert.match(home.html, /<main class="[^"]*site[^"]*">/);
  assert.match(home.html, /<a href="\/pricing">Pricing<\/a>/);

  // A page that maps over an imported data module renders every item at capture.
  const pricing = await page("/pricing");
  assert.equal(pricing.status, 200);
  assert.match(pricing.html, /<p class="[^"]*tagline[^"]*">Simple, honest pricing\.<\/p>/);
  for (const plan of ["Free", "Pro"]) assert.match(pricing.html, new RegExp(`<h2[^>]*>${plan}</h2>`));

  // pages/docs/index.tsx answers at /docs, as in 0.8.
  const docs = await page("/docs");
  assert.equal(docs.status, 200);
  assert.match(docs.html, /<h1[^>]*>Docs<\/h1>/);

  assert.equal((await page("/no-such-page")).status, 404);
});
