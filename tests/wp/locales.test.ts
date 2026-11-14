// Localization on WordPress (§7.3): Polylang owns each post's language and its translation group,
// First writes them through Polylang's API and keeps synced columns equal across the group. Group and
// language assertions read Polylang's own functions through WP-CLI, not First's view of them.
// Pipeline semantics (validation, 409s, fallback edge cases) are proven in tests/php; this file
// proves what Polylang and MySQL add. `phrases` (table()) uses First's own group column.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { api, core, harness, http, ok, problem, qs, run, wp } from "./env.ts";

/** Polylang's view of a post: [language slug, translations]. */
function polylang(id: number): [string, Record<string, number>] {
  return JSON.parse(wp("eval", `echo wp_json_encode([pll_get_post_language(${id}), pll_get_post_translations(${id})]);`));
}

const titles = (rows: { locale: string; title: string }[]) => rows.map((r) => `${r.locale}:${r.title}`);
const log = async (ids: number[]) =>
  (await ok("GET", "/tour_log" + qs({ where: { tourId: { in: ids } }, orderBy: "id" }))).map((r: any) => `${r.tourId}=${r.entry}`);

async function pair(tag: string) {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `${tag} ${run}`, summary: "Hot leaves", price: 3, tags: ["tea"] } });
  const fr = await ok("POST", "/tours", { as: "editor", body: { title: `${tag} FR ${run}`, locale: "fr", translationOf: en.id } });
  return { en, fr };
}

test("Polylang treats localized post types as translatable and has every configured language", () => {
  const out = JSON.parse(wp("eval", `echo wp_json_encode([pll_is_translated_post_type('first_tours'), pll_is_translated_post_type('first_posts'), pll_languages_list(['fields' => 'slug']), pll_default_language()]);`));
  assert.deepEqual(out, [true, false, ["en", "de", "fr"], "en"]);
});

test("translationOf puts both posts in one Polylang group and copies synced columns", async () => {
  const { en, fr } = await pair("Tea");
  assert.deepEqual([fr.locale, fr.price, fr.tags, fr.summary, fr.translations], ["fr", 3, ["tea"], null, { en: en.id, fr: fr.id }]);
  assert.deepEqual(polylang(en.id), ["en", { en: en.id, fr: fr.id }]);
  assert.deepEqual(polylang(fr.id), ["fr", { en: en.id, fr: fr.id }]);
  assert.deepEqual(await ok("POST", "/actions/refsTranslations", { as: "editor", body: { id: en.id } }), ["en", "fr"]);
  await problem("POST", "/tours", { as: "editor", body: { title: "Again", locale: "fr", translationOf: en.id } }, { status: 409, code: "unique_violation", pointer: "/locale" });
  assert.deepEqual(polylang(en.id)[1], { en: en.id, fr: fr.id }, "a refused join leaves Polylang's group as it was");
});

test("a synced column change through the API reaches the translation's postmeta, hooks per row", async () => {
  const { en, fr } = await pair("Sync");
  await ok("PATCH", `/tours/${fr.id}`, { as: "editor", body: { price: 4, summary: "Feuilles chaudes" } });
  const both = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id" }), { as: "editor" });
  assert.deepEqual(both.map((r: any) => [r.locale, r.price, r.summary]), [["en", 4, "Hot leaves"], ["fr", 4, "Feuilles chaudes"]]);
  assert.equal(wp("eval", `echo get_post_meta(${en.id}, 'first_price', true);`), "4");
  assert.deepEqual(await log([en.id, fr.id]), [`${fr.id}=fr:4 by Editor`, `${en.id}=en:4 by Editor`]);
});

test("a synced column change saved in the editor (core REST) runs the sibling's pipeline too", async () => {
  const { en, fr } = await pair("Editor");
  const saved = await http("POST", `${core}/first_tours/${en.id}`, { as: "editor", body: { acf: { first_price: 6 } } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(wp("eval", `echo get_post_meta(${fr.id}, 'first_price', true);`), "6");
  assert.deepEqual(await log([en.id, fr.id]), [`${en.id}=en:6 by Editor`, `${fr.id}=fr:6 by Editor`]);
  const revisions = await ok("GET", `/tours/${fr.id}/revisions`, { as: "editor" });
  assert.equal(revisions.length, 2);
  const revision = await ok("GET", `/tours/${fr.id}/revisions/${revisions[0].id}`, { as: "editor" });
  assert.deepEqual([revision.locale, revision.price, revision.translations], ["fr", 6, { en: en.id, fr: fr.id }]);
});

test("locale reads: the locale's row, else the group's default-locale row, combined with filters", async () => {
  const { en, fr } = await pair("Read");
  const solo = await ok("POST", "/tours", { as: "editor", body: { title: `Solo ${run}`, price: 3 } });
  const mine = { id: { in: [en.id, fr.id, solo.id] } };
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ locale: "fr", where: mine, orderBy: "id" }))), [`fr:Read FR ${run}`, `en:Solo ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ where: mine, orderBy: "id" }))), [`en:Read ${run}`, `en:Solo ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ locale: "fr", where: { AND: [mine, { title: { like: "Read%" } }] } }))), [`fr:Read FR ${run}`]);
  assert.equal((await ok("GET", `/tours/${en.id}` + qs({ locale: "fr" }))).title, `Read FR ${run}`);
  // A draft translation is its own row: anonymous readers fall back past it, editors see it.
  const de = await ok("POST", "/tours", { as: "editor", body: { title: `Read DE ${run}`, locale: "de", translationOf: en.id, status: "draft" } });
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ locale: "de", where: mine, orderBy: "id" }))), [`en:Read ${run}`, `en:Solo ${run}`]);
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ locale: "de", where: { id: { in: [en.id, de.id] } } }), { as: "editor" })), [`de:Read DE ${run}`]);
  await problem("GET", "/posts" + qs({ locale: "en" }), {}, { status: 400, code: "invalid_query", pointer: "/locale" });
});

test("delete removes one post; Polylang's group shrinks", async () => {
  const { en, fr } = await pair("Delete");
  await ok("DELETE", `/tours/${fr.id}`, { as: "editor" });
  assert.deepEqual(polylang(en.id), ["en", { en: en.id }]);
});

test("a translation linked outside the API (Polylang's +) adopts the group's synced columns", async () => {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `Admin ${run}`, price: 7, tags: ["coffee"] } });
  const de = Number(wp("eval", `
    wp_set_current_user(get_user_by('login', 'editor')->ID);
    $id = pll_insert_post(['post_type' => 'first_tours', 'post_title' => 'Admin DE ${run}', 'post_status' => 'publish'], 'de');
    pll_save_post_translations(['en' => ${en.id}, 'de' => $id]);
    echo $id;`));
  const row = await ok("GET", `/tours/${de}`, { as: "editor" });
  assert.deepEqual([row.locale, row.price, row.tags, row.translations], ["de", 7, ["coffee"], { en: en.id, de }]);
  // Adoption runs as the user who made the link, like an editor save: hooks and revisions see them.
  assert.deepEqual(await log([de]), [`${de}=de:7 by Editor`]);
  const revisions = await ok("GET", `/tours/${de}/revisions`, { as: "editor" });
  assert.equal(revisions[0].user?.name, "Editor");
});

test("a link made outside the API: adoption a hook would split is rolled back; the link stands, as for editor saves", async () => {
  const en = await ok("POST", "/tours", { as: "editor", body: { title: `Linked ${run}`, price: 7 } });
  const out = JSON.parse(wp("eval", `
    $de = pll_insert_post(['post_type' => 'first_tours', 'post_title' => 'Bump DE ${run}', 'post_status' => 'publish'], 'de');
    try {
      pll_save_post_translations(['en' => ${en.id}, 'de' => $de]);
      $result = 'adopted';
    } catch (\\First\\HttpError $e) {
      $result = $e->status . ' ' . $e->errorCode;
    }
    echo wp_json_encode([$result, $de]);`));
  // The adoption that would leave en=7, de=8 is refused and rolled back (no adopted price, no hook
  // effects); like an editor save (design-wp-parity §1.7), the link Polylang already wrote stands.
  assert.deepEqual([out[0], wp("eval", `echo get_post_meta(${out[1]}, 'first_price', true);`)], ["409 conflict", ""]);
  assert.deepEqual(await log([out[1]]), []);
  assert.deepEqual(polylang(en.id)[1], { en: en.id, de: out[1] });
});

test("a hook failing after a translation joined leaves Polylang's group as it was", () => {
  const out = JSON.parse(wp("eval", `
    $db = \\First\\Wp\\Plugin::instance()->db();
    $en = $db->insert('tours', ['title' => 'Rollback ${run}'], true)[0]['id'];
    try {
      $db->transaction(function () use ($db, $en) {
        $db->insert('tours', ['title' => 'Rollback FR ${run}', 'locale' => 'fr', 'translationOf' => $en]);
        throw new \\RuntimeException('later failure');
      });
    } catch (\\RuntimeException $e) {}
    echo wp_json_encode([$en, pll_get_post_translations($en)]);`));
  assert.deepEqual(out[1], { en: out[0] }, "the rolled-back join is not visible through Polylang in the same process");
});

test("tables keep their own translation group", async () => {
  const en = await ok("POST", "/phrases", { as: "editor", body: { text: `Hello ${run}`, weight: 1 } });
  const fr = await ok("POST", "/phrases", { as: "editor", body: { text: `Bonjour ${run}`, locale: "fr", translationOf: en.id } });
  assert.deepEqual([fr.weight, fr.translations], [1, { en: en.id, fr: fr.id }]);
  await ok("PATCH", `/phrases/${en.id}`, { as: "editor", body: { weight: 2 } });
  const mine = { id: { in: [en.id, fr.id] } };
  assert.deepEqual((await ok("GET", "/phrases" + qs({ locale: "*", where: mine, orderBy: "id" }))).map((r: any) => r.weight), [2, 2]);
  assert.deepEqual((await ok("GET", "/phrases" + qs({ locale: "de", where: mine }))).map((r: any) => r.text), [`Hello ${run}`]);
  // The (translationGroup, locale) unique key on MySQL backs one row per locale.
  await problem("POST", "/phrases", { as: "editor", body: { text: "Salut", locale: "fr", translationOf: en.id } }, { status: 409, code: "unique_violation", pointer: "/locale" });
});

test("posts that predate localization become default-locale rows; Polylang's default follows locales.default", async () => {
  const id = Number(wp("eval", `
    $id = wp_insert_post(['post_type' => 'first_tours', 'post_title' => 'Legacy ${run}', 'post_status' => 'publish']);
    wp_delete_object_term_relationships($id, 'language');
    PLL()->model->update_default_lang('fr');
    delete_option('first_polylang_languages');
    \\First\\Wp\\Polylang::ensureLanguages();
    echo $id;`));
  assert.deepEqual([polylang(id)[0], wp("eval", "echo pll_default_language();")], ["en", "en"]);
  assert.deepEqual(titles(await ok("GET", "/tours" + qs({ where: { id } }))), [`en:Legacy ${run}`]);
});

test("a write based on a group another connection changed first is refused, not committed divergent", async () => {
  const { en, fr } = await pair("Race");
  // Inside one First transaction: read the group (the snapshot), let a second MySQL connection commit
  // a synced change, then write. Both a stale update and a stale join must fail with 409 conflict.
  const out = JSON.parse(wp("eval", `
    $db = \\First\\Wp\\Plugin::instance()->db();
    $other = new mysqli(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);
    $race = function (callable $write) use ($db, $other): string {
      try {
        $db->transaction(function () use ($db, $other, $write) {
          $db->findMany('tours', ['where' => ['id' => ['in' => [${en.id}, ${fr.id}]]], 'locale' => '*']);
          $other->query("UPDATE wp_postmeta SET meta_value = meta_value + 1 WHERE post_id IN (${en.id}, ${fr.id}) AND meta_key = 'first_price'");
          $write();
        });
        return 'committed';
      } catch (\\First\\HttpError $e) {
        return $e->status . ' ' . $e->errorCode;
      }
    };
    echo wp_json_encode([
      $race(fn () => $db->update('tours', ['price' => 3], ['id' => ${fr.id}])),
      $race(fn () => $db->insert('tours', ['title' => 'Race DE ${run}', 'locale' => 'de', 'translationOf' => ${en.id}])),
    ]);`));
  assert.deepEqual(out, ["409 conflict", "409 conflict"]);
  const both = await ok("GET", "/tours" + qs({ locale: "*", where: { id: { in: [en.id, fr.id] } }, orderBy: "id" }), { as: "editor" });
  assert.deepEqual(both.map((r: any) => r.price), [5, 5], "the group stays equal at the other connection's value");
});

test("a trashed translation leaves the group usable; its locale can be translated again", async () => {
  const { en, fr } = await pair("Trash");
  wp("eval", `wp_trash_post(${fr.id});`); // to the trash: Polylang keeps the relationship
  await ok("PATCH", `/tours/${en.id}`, { as: "editor", body: { price: 8 } });
  const again = await ok("POST", "/tours", { as: "editor", body: { title: `Trash FR2 ${run}`, locale: "fr", translationOf: en.id } });
  assert.deepEqual([again.price, polylang(en.id)[1]], [8, { en: en.id, fr: again.id }]);
});

test("sync pulls a localized collection as one record per locale, and a pushed translation joins the Polylang group", async () => {
  const { en, fr } = await pair("Synced");
  // Pull: every locale is its own record; `translations` travels as locale → uid.
  const records = new Map<string, any>();
  for (let after = 0; ; ) {
    const page = await ok("GET", "/sync/tours" + qs({ after: String(after), first: "100" }), { as: "editor" });
    for (const item of page.records) if (item.record) records.set(item.record.uid, item.record);
    if (page.next === null) break;
    after = page.next;
  }
  const enRecord = records.get(en.uid);
  const frRecord = records.get(fr.uid);
  assert.deepEqual([enRecord.fields.locale, enRecord.fields.title, frRecord.fields.locale, frRecord.fields.title], ["en", `Synced ${run}`, "fr", `Synced FR ${run}`]);
  assert.deepEqual([enRecord.fields.translations, frRecord.fields.translations], [{ en: en.uid, fr: fr.uid }, { en: en.uid, fr: fr.uid }]);
  // Push: a new German file naming its group joins it through translationOf, copying synced columns.
  const deUid = "zr_" + createHash("sha256").update(`${run}:tour-de`).digest("hex").slice(0, 20);
  const pushed = await http("POST", `${api}/sync/tours`, {
    as: "editor",
    body: { expect: "absent", record: { uid: deUid, fields: { title: `Synced DE ${run}`, locale: "de", translations: { en: en.uid, fr: fr.uid } }, body: "Hallo **Tee**." } },
  });
  assert.equal(pushed.status, 201, JSON.stringify(pushed.json));
  const [de] = await ok("GET", "/tours" + qs({ locale: "de", where: { uid: deUid } }), { as: "editor" });
  assert.deepEqual([de.locale, de.price, de.tags], ["de", 3, ["tea"]]);
  assert.deepEqual(polylang(en.id)[1], { en: en.id, fr: fr.id, de: de.id });
  // A file with no group yet (`translations: {}`) creates a translation of its own.
  const soloUid = "zr_" + createHash("sha256").update(`${run}:tour-solo`).digest("hex").slice(0, 20);
  const solo = await http("POST", `${api}/sync/tours`, {
    as: "editor",
    body: { expect: "absent", record: { uid: soloUid, fields: { title: `Solo ${run}`, locale: "en", translations: {} }, body: "Alone." } },
  });
  assert.equal(solo.status, 201, JSON.stringify(solo.json));
});

test("a core create with `locale` keeps core's own post fields and other plugins' meta", async () => {
  const author = harness.users.author.id;
  const made = await http("POST", `${core}/first_tours`, { as: "editor", body: {
    title: `Core fields ${run}`, status: "publish", locale: "de", author, menu_order: 7, meta: { other_plugin_note: "kept" },
  } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const id = made.json.id;
  const post = JSON.parse(wp("eval", `$p = get_post(${id}); echo wp_json_encode([(int) $p->post_author, (int) $p->menu_order, get_post_meta(${id}, 'other_plugin_note', true), pll_get_post_language(${id})]);`));
  assert.deepEqual(post, [author, 7, "kept", "de"], "author, menu order and the other plugin's meta survive First's write");
  const asAuthor = await http("POST", `${core}/first_tours`, { as: "author", body: { title: `Other author ${run}`, locale: "de", author: harness.users.editor.id } });
  assert.equal(asAuthor.status, 403, "an author can't create as someone else, as core checks");
});
