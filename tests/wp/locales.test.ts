// Localization on WordPress (§7.3): Polylang owns each post's language and its translation group,
// Zero writes them through Polylang's API and keeps synced columns equal across the group. Every
// group/language assertion reads Polylang's own functions through WP-CLI, not Zero's view of them.
// `phrases` (editor: false) proves Zero's own translationGroup column on MySQL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ok, problem, qs, run, wp } from "./env.ts";

/** Polylang's view of a post: [language slug, translations]. */
function polylang(id: number): [string, Record<string, number>] {
  return JSON.parse(wp("eval", `echo wp_json_encode([pll_get_post_language(${id}), pll_get_post_translations(${id})]);`));
}

const titles = (rows: { locale: string; title: string }[]) => rows.map((r) => `${r.locale}:${r.title}`);

test("Polylang treats localized post types as translatable and has every configured language", () => {
  const out = JSON.parse(wp("eval", `echo wp_json_encode([pll_is_translated_post_type('zero_guides'), pll_is_translated_post_type('zero_posts'), pll_languages_list(['fields' => 'slug']), pll_default_language()]);`));
  assert.deepEqual(out, [true, false, ["en", "de", "fr"], "en"]);
});

test("translationOf joins Polylang's group, synced columns follow, locale reads fall back", async () => {
  const en = await ok("POST", "/guides", { as: "editor", body: { title: `Tea ${run}`, summary: "Hot leaves", price: 3, tags: ["tea"] } });
  assert.deepEqual([en.locale, en.translations], ["en", { en: en.id }]);
  const fr = await ok("POST", "/guides", { as: "editor", body: { title: `Thé ${run}`, locale: "fr", translationOf: en.id } });
  assert.deepEqual([fr.locale, fr.price, fr.tags, fr.summary], ["fr", 3, ["tea"], null]);
  assert.deepEqual(fr.translations, { en: en.id, fr: fr.id });
  // 1. Polylang itself reports both posts in one group.
  assert.deepEqual(polylang(en.id), ["en", { en: en.id, fr: fr.id }]);
  assert.deepEqual(polylang(fr.id), ["fr", { en: en.id, fr: fr.id }]);
  await problem("POST", "/guides", { as: "editor", body: { title: "Tee", locale: "de", translationOf: en.id, price: 9 } }, { status: 422, code: "invalid_input", pointer: "/price" });
  await problem("POST", "/guides", { as: "editor", body: { title: "Thé 2", locale: "fr", translationOf: en.id } }, { status: 409, code: "unique_violation", pointer: "/locale" });

  // 2. A synced (non-localized) change on either row reaches the other; localized columns stay.
  await ok("PATCH", `/guides/${fr.id}`, { as: "editor", body: { price: 4, summary: "Feuilles chaudes" } });
  const both = await ok("GET", "/guides" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id" }), { as: "editor" });
  assert.deepEqual(both.map((r: any) => [r.locale, r.price, r.summary]), [["en", 4, "Hot leaves"], ["fr", 4, "Feuilles chaudes"]]);
  assert.equal(wp("eval", `echo get_post_meta(${en.id}, 'zero_price', true);`), "4");

  // 3 + 4. locale=fr returns the French row, falls back per group, combines with a filter.
  const coffee = await ok("POST", "/guides", { as: "editor", body: { title: `Coffee ${run}`, price: 4 } });
  const mine = { id: { in: [en.id, coffee.id, fr.id] } };
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ locale: "fr", where: mine, orderBy: "id" }))), [`fr:Thé ${run}`, `en:Coffee ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ where: mine, orderBy: "id" }))), [`en:Tea ${run}`, `en:Coffee ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ locale: "fr", where: { AND: [mine, { title: { like: "Th%" } }] } }))), [`fr:Thé ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ locale: "de", where: { AND: [mine, { price: 4 }] }, orderBy: "id" }))), [`en:Tea ${run}`, `en:Coffee ${run}`]);
  assert.equal((await ok("GET", `/guides/${en.id}` + qs({ locale: "fr" }))).title, `Thé ${run}`);
  await problem("GET", "/guides" + qs({ locale: "es" }), {}, { status: 400, code: "invalid_query", pointer: "/locale" });
  await problem("GET", "/posts" + qs({ locale: "en" }), {}, { status: 400, code: "invalid_query", pointer: "/locale" });

  // A draft translation is per row: anonymous readers fall back past it.
  const de = await ok("POST", "/guides", { as: "editor", body: { title: `Tee ${run}`, locale: "de", translationOf: en.id, status: "draft" } });
  assert.deepEqual(polylang(en.id)[1], { en: en.id, fr: fr.id, de: de.id });
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ locale: "de", where: mine, orderBy: "id" }))), [`en:Tea ${run}`, `en:Coffee ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/guides" + qs({ locale: "de", where: { id: { in: [en.id, de.id] } } }), { as: "editor" })), [`de:Tee ${run}`]);

  // Delete removes that row only; Polylang's group shrinks.
  await ok("DELETE", `/guides/${de.id}`, { as: "editor" });
  assert.deepEqual(polylang(en.id)[1], { en: en.id, fr: fr.id });
});

test("a translation linked in wp-admin (Polylang API) adopts the group's synced columns", async () => {
  const en = await ok("POST", "/guides", { as: "editor", body: { title: `Admin ${run}`, price: 7, tags: ["coffee"] } });
  // What Polylang's "+" does: a new post in a language, then the group saved.
  const de = Number(wp("eval", `
    $id = pll_insert_post(['post_type' => 'zero_guides', 'post_title' => 'Admin DE ${run}', 'post_status' => 'publish'], 'de');
    pll_save_post_translations(['en' => ${en.id}, 'de' => $id]);
    echo $id;`));
  const row = await ok("GET", `/guides/${de}`, { as: "editor" });
  assert.deepEqual([row.locale, row.price, row.tags, row.translations], ["de", 7, ["coffee"], { en: en.id, de }]);
});

test("editor: false collections keep their own translation group with the same behaviour", async () => {
  const en = await ok("POST", "/phrases", { as: "editor", body: { text: `Hello ${run}`, weight: 1 } });
  const fr = await ok("POST", "/phrases", { as: "editor", body: { text: `Bonjour ${run}`, locale: "fr", translationOf: en.id } });
  assert.deepEqual([fr.weight, fr.translations], [1, { en: en.id, fr: fr.id }]);
  await ok("PATCH", `/phrases/${en.id}`, { as: "editor", body: { weight: 2 } });
  const mine = { id: { in: [en.id, fr.id] } };
  assert.deepEqual((await ok("GET", "/phrases" + qs({ locale: "*", where: mine, orderBy: "id" }))).map((r: any) => r.weight), [2, 2]);
  assert.deepEqual((await ok("GET", "/phrases" + qs({ locale: "fr", where: mine }))).map((r: any) => r.text), [`Bonjour ${run}`]);
  assert.deepEqual((await ok("GET", "/phrases" + qs({ locale: "de", where: mine }))).map((r: any) => r.text), [`Hello ${run}`]);
  await problem("POST", "/phrases", { as: "editor", body: { text: "Salut", locale: "fr", translationOf: en.id } }, { status: 409, code: "unique_violation", pointer: "/locale" });
});
