// Image sizes, focal point and private files on real WordPress (phase 2 §7.2). The app fragment
// (app/lanes/media.ts) configures `card` (120x120 cover) and `wide` (200 wide, inside).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import { api, harness, http, ok, problem, wp } from "./env.ts";

/** A 400x200 PNG: left half red, right half blue, so a crop's colour shows where its origin landed. */
function splitPng(): Uint8Array {
  const [w, h] = [400, 200];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set(x < w / 2 ? [255, 0, 0] : [0, 0, 255], y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function upload(bytes: Uint8Array, name: string, type: string, as: "author" | "subscriber" = "author") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), name);
  return http("POST", `${api}/media`, { as, form });
}

/** Width, height and the centre pixel's [red, blue] of an attachment's registered size, read on the server. */
function sizeOnDisk(id: number, size: string): { file: string; w: number; h: number; rgb: [number, number]; sha: string } {
  return JSON.parse(wp("eval", `
    $src = wp_get_attachment_image_src(${id}, '${size}');
    $file = path_join(dirname(get_attached_file(${id})), wp_basename($src[0]));
    $img = imagecreatefromstring(file_get_contents($file));
    $c = imagecolorsforindex($img, imagecolorat($img, intdiv(imagesx($img), 2), intdiv(imagesy($img), 2)));
    echo wp_json_encode(['file' => wp_basename($file), 'w' => imagesx($img), 'h' => imagesy($img), 'rgb' => [$c['red'], $c['blue']], 'sha' => hash_file('sha256', $file)]);
  `));
}

/** Install a must-use plugin from PHP source (base64 keeps the source free of shell/PHP escaping). */
function muPlugin(name: string, php: string): void {
  wp("eval", `wp_mkdir_p(WPMU_PLUGIN_DIR); file_put_contents(WPMU_PLUGIN_DIR . '/${name}.php', base64_decode('${Buffer.from(php).toString("base64")}'));`);
}
after(() => wp("eval", "array_map('unlink', glob(WPMU_PLUGIN_DIR . '/zero-test-*.php'));"));

/** Upload the split PNG through Zero; returns the media row. */
async function uploadSplit() {
  const r = await upload(splitPng(), "split.png", "image/png");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
}

test("an upload returns the configured sizes; the files exist with the right dimensions", async () => {
  const img = await uploadSplit();
  assert.equal(img.focal, null);
  assert.deepEqual(
    { card: [img.sizes.card.width, img.sizes.card.height], wide: [img.sizes.wide.width, img.sizes.wide.height] },
    { card: [120, 120], wide: [200, 100] },
  );
  for (const [size, w, h] of [["card", 120, 120], ["wide", 200, 100]] as const) {
    assert.ok(img.sizes[size].url.startsWith(`${harness.url}/wp-content/uploads/`), img.sizes[size].url);
    assert.equal((await fetch(img.sizes[size].url)).status, 200, `${size} file is served`);
    const disk = sizeOnDisk(img.id, `zero_${size}`);
    assert.deepEqual([disk.w, disk.h, disk.file], [w, h, img.sizes[size].url.split("/").pop()]);
  }
});

test("PATCH /media focal regenerates cover crops along the focal point; a theme size of the same shape is untouched", async () => {
  // A theme's own 120x120 crop must never pick up Zero's focal point or share Zero's file.
  wp("option", "update", "thumbnail_size_w", "120");
  wp("option", "update", "thumbnail_size_h", "120");
  wp("option", "update", "thumbnail_crop", "1");
  const img = await uploadSplit();
  const centred = sizeOnDisk(img.id, "zero_card");
  const theme = sizeOnDisk(img.id, "thumbnail");
  const wide = sizeOnDisk(img.id, "zero_wide");
  assert.notEqual(theme.file, centred.file);

  const left = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0.5 } } });
  assert.deepEqual([left.focal, [left.sizes.card.width, left.sizes.card.height]], [{ x: 0, y: 0.5 }, [120, 120]]);
  const leftCard = sizeOnDisk(img.id, "zero_card");
  assert.notEqual(leftCard.sha, centred.sha, "changing focal regenerates the cover crop (different bytes)");
  assert.deepEqual(leftCard.rgb, [255, 0], "the left focal crop is red");
  assert.equal(left.sizes.card.url.split("/").pop(), leftCard.file);
  assert.equal((await fetch(img.sizes.card.url)).status, 404, "the previous crop is removed after commit");
  assert.deepEqual(sizeOnDisk(img.id, "thumbnail"), theme, "the theme's same-shape crop is untouched");
  assert.deepEqual(sizeOnDisk(img.id, "zero_wide"), wide, "inside sizes are not regenerated");

  await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 1, y: 0.5 } } });
  assert.deepEqual(sizeOnDisk(img.id, "zero_card").rgb, [0, 255], "the right focal crop is blue");
  assert.equal(wp("post", "meta", "get", String(img.id), "_zero_focal"), '{"x":1,"y":0.5}');
});

test("focal A → B → A inside one transaction: rollback keeps the committed crop, commit keeps the final one", async () => {
  const img = await uploadSplit();
  /** Run focal updates in one transaction (optionally rolled back); returns the zero_card files left on disk. */
  const sequence = (focals: [number, number][], rollback: boolean): string[] => JSON.parse(wp("eval", `
    $media = \\Zero\\Wp\\Runtime::plugin()->app()->db->media();
    try {
      \\Zero\\db()->transaction(function () use ($media) {
        foreach (${JSON.stringify(focals)} as [$x, $y]) {
          $media->update(${img.id}, ['focal' => ['x' => $x, 'y' => $y]]);
        }
        ${rollback ? "throw new RuntimeException('roll back');" : ""}
      });
    } catch (RuntimeException) {}
    $file = get_attached_file(${img.id});
    echo wp_json_encode(array_map('basename', glob(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-zero_card-*')));
  `));

  sequence([[0, 0.5]], false);
  const committed = sizeOnDisk(img.id, "zero_card");
  assert.deepEqual(sequence([[1, 0.5], [0, 0.5]], true), [committed.file], "rollback: only the committed crop remains");
  assert.deepEqual(sizeOnDisk(img.id, "zero_card"), committed);

  const files = sequence([[1, 0.5], [0, 0.5]], false);
  const final = sizeOnDisk(img.id, "zero_card");
  assert.deepEqual(files, [final.file], "commit: exactly the final crop remains, and metadata points at it");
  assert.deepEqual(final.rgb, [255, 0]);
});

test("a crop that fails to render rolls the focal change back, and the same PATCH succeeds on retry", async () => {
  const img = await uploadSplit();
  const before = sizeOnDisk(img.id, "zero_card");
  // A must-use plugin that makes every image save fail while its flag option is set.
  muPlugin("zero-test-editor-fails", "<?php\nadd_filter('wp_image_editors', fn ($e) => get_option('zero_test_editor_fails') ? [] : $e);\n");
  wp("option", "update", "zero_test_editor_fails", "1");
  try {
    const failed = await http("PATCH", `${api}/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.equal((await ok("GET", `/media/${img.id}`)).focal, null, "the focal point did not commit");
    assert.deepEqual(sizeOnDisk(img.id, "zero_card"), before, "the previous crop is still in place");
  } finally {
    wp("option", "delete", "zero_test_editor_fails");
  }
  const retried = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
  assert.deepEqual(retried.focal, { x: 0, y: 0 });
  assert.deepEqual(sizeOnDisk(img.id, "zero_card").rgb, [255, 0]);
});

test("core uploads outside Zero get the zero_* sizes", async () => {
  const imported = wp("eval", `
    $tmp = wp_tempnam('core.png');
    $img = imagecreatetruecolor(300, 300);
    imagepng($img, $tmp);
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    echo media_handle_sideload(['name' => 'core.png', 'tmp_name' => $tmp], 0);
  `);
  const row = await ok("GET", `/media/${imported}`);
  assert.deepEqual([row.sizes.card.width, row.sizes.card.height, row.sizes.wide.width], [120, 120, 200]);
  assert.equal((await fetch(row.sizes.card.url)).status, 200);
});

test("core regeneration: the missing-sizes pass fills Zero sizes without touching a same-shape theme crop; a full pass replaces renditions", async () => {
  // A theme crop of Zero's card shape anchored top-left (different bytes from Zero's centred crop).
  muPlugin("zero-test-theme-size", "<?php\nadd_action('init', fn () => add_image_size('theme_card', 120, 120, ['left', 'top']));\n");
  const img = await uploadSplit();
  const theme = sizeOnDisk(img.id, "theme_card");
  const files = (): string[] => JSON.parse(wp("eval", `
    $file = get_attached_file(${img.id});
    echo wp_json_encode(array_map('basename', glob(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-zero_*')));
  `));

  /** Drop sizes from the metadata (and their files), then let core's missing-sizes pass run. */
  const dropAndUpdate = (sizes: string[]) => wp("eval", `
    $meta = wp_get_attachment_metadata(${img.id});
    foreach (${JSON.stringify(sizes)} as $size) {
      unlink(path_join(dirname(get_attached_file(${img.id})), $meta['sizes'][$size]['file']));
      unset($meta['sizes'][$size]);
    }
    wp_update_attachment_metadata(${img.id}, $meta);
    require_once ABSPATH . 'wp-admin/includes/image.php';
    wp_update_image_subsizes(${img.id});
  `);
  // Only a Zero size missing: core returns early, Zero fills it.
  dropAndUpdate(["zero_card"]);
  const filled = sizeOnDisk(img.id, "zero_card");
  assert.deepEqual([filled.w, filled.h], [120, 120]);
  assert.deepEqual(sizeOnDisk(img.id, "theme_card"), theme, "the theme's crop keeps its bytes");
  assert.equal(files().length, 2, "card + wide, nothing else");
  // A Zero size and a theme size missing: core makes its own, Zero fills its absent one.
  dropAndUpdate(["zero_card", "theme_card"]);
  const both = sizeOnDisk(img.id, "zero_card");
  assert.deepEqual([both.w, both.h, files().length], [120, 120, 2]);
  const remade = sizeOnDisk(img.id, "theme_card");
  assert.deepEqual([remade.file, remade.w, remade.h, remade.rgb], [theme.file, theme.w, theme.h, theme.rgb], "core re-made its top-left crop on its own file");

  // A regeneration inside a transaction that rolls back keeps the committed metadata and files.
  const committed = files();
  const meta = wp("eval", `
    require_once ABSPATH . 'wp-admin/includes/image.php';
    try {
      \\Zero\\Wp\\Runtime::plugin()->db()->transaction(function () {
        wp_update_attachment_metadata(${img.id}, wp_generate_attachment_metadata(${img.id}, get_attached_file(${img.id})));
        wp_get_attachment_metadata(${img.id});
        throw new RuntimeException('roll back');
      });
    } catch (RuntimeException) {}
    echo wp_get_attachment_metadata(${img.id})['sizes']['zero_card']['file'];
  `);
  assert.deepEqual(files(), committed, "rollback removes the new renditions and keeps the committed ones");
  assert.ok(committed.includes(meta), "metadata (and its cache) still names a committed rendition");

  // A full core pass (what regenerate plugins call) renders fresh Zero renditions, and Zero removes
  // the ones they replace (WP-CLI's regenerate would delete old files itself, hiding Zero's cleanup).
  const before = files();
  wp("eval", `
    require_once ABSPATH . 'wp-admin/includes/image.php';
    wp_update_attachment_metadata(${img.id}, wp_generate_attachment_metadata(${img.id}, get_attached_file(${img.id})));
  `);
  const after = files();
  assert.equal(after.length, 2);
  assert.deepEqual(after.filter((f) => before.includes(f)), [], "every replaced rendition is removed");
});

test("a size the original now fits drops its old rendition (metadata and file)", async () => {
  // A 100x100 original fits card (120x120): model a rendition left from a smaller earlier card size.
  const id = wp("eval", `
    $tmp = wp_tempnam('fits.png');
    imagepng(imagecreatetruecolor(100, 100), $tmp);
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $id = media_handle_sideload(['name' => 'fits.png', 'tmp_name' => $tmp], 0);
    $file = get_attached_file($id);
    $stale = pathinfo($file, PATHINFO_FILENAME) . '-zero_card-stale.png';
    copy($file, dirname($file) . '/' . $stale);
    $meta = wp_get_attachment_metadata($id);
    $meta['sizes']['zero_card'] = ['file' => $stale, 'width' => 50, 'height' => 50, 'mime-type' => 'image/png'];
    wp_update_attachment_metadata($id, $meta);
    echo $id;
  `);
  await ok("PATCH", `/media/${id}`, { as: "editor", body: { focal: { x: 0.5, y: 0.5 } } });
  const left = JSON.parse(wp("eval", `
    $file = get_attached_file(${id});
    echo wp_json_encode([isset(wp_get_attachment_metadata(${id})['sizes']['zero_card']), is_file(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-zero_card-stale.png')]);
  `));
  assert.deepEqual(left, [false, false], "no zero_card entry and no stale file");
  const row = await ok("GET", `/media/${id}`);
  assert.equal(row.sizes.card.url, row.url, "the original serves the size");
});

test("without Jetpack the Image CDN adapter is inert", async () => {
  const schema = await ok("GET", "/_schema");
  assert.equal(schema.runtime.wp.imageCdn, false);
});

// ================================================================ private files (G2)

/** A minimal valid PDF (finfo sniffs application/pdf). */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${text}\ntrailer<<>>\n%%EOF\n`);

async function uploadDeck(bytes: Uint8Array, as: "author" | "editor" | "subscriber" = "author", name = "Q3 plan.pdf") {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), name);
  return http("POST", `${api}/files/decks`, { as, form });
}

/**
 * The harness publishes WordPress on a host port the container can't reach, so the probe is routed
 * to the web server's in-network name with `zero_private_probe_url`, the filter hosts use for the
 * same reason. Re-probing then exercises the real Apache `.htaccess` decision.
 */


function probe(): string {
  muPlugin("zero-test-probe-route", "<?php\nadd_filter('zero_private_probe_url', fn ($u) => str_replace(home_url(), 'http://wordpress', $u));\n");
  return wp("eval", "echo \\Zero\\Wp\\WpFiles::probe() ? 'protected' : 'exposed';");
}

test("private files: signed download with security headers; forged/expired → 403; owner rule; Apache denies the direct URL", async () => {
  assert.equal(probe(), "protected");
  assert.equal((await ok("GET", "/_schema")).runtime.privateFiles.protected, true);

  await problem("POST", "/files/decks", { form: (() => { const f = new FormData(); f.append("file", new Blob([pdf("x")]), "a.pdf"); return f; })() },
    { status: 401, code: "unauthenticated", pointer: undefined });
  const r = await uploadDeck(pdf("slide one"));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const deck = r.json.data;
  assert.deepEqual([deck.bucket, deck.mime, deck.filename, deck.ownerId, "path" in deck], ["decks", "application/pdf", "Q3 plan.pdf", harness.users.author.id, false]);
  assert.ok(deck.url.startsWith(`${api}/files/decks/${deck.id}/download?`), deck.url);

  // The signed URL streams the bytes, no credentials needed.
  const res = await fetch(deck.url);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), pdf("slide one"));
  assert.deepEqual(
    ["content-type", "x-content-type-options", "content-security-policy", "cache-control"].map((h) => res.headers.get(h)),
    ["application/pdf", "nosniff", "sandbox", "private, no-store"],
  );
  assert.equal(res.headers.get("content-disposition"), `attachment; filename="Q3 plan.pdf"; filename*=UTF-8''Q3%20plan.pdf`);

  // Forged and expired signatures.
  const signed = new URL(deck.url);
  const forged = new URL(signed);
  forged.searchParams.set("sig", "0".repeat(64));
  assert.equal((await fetch(forged)).status, 403);
  const stretched = new URL(signed);
  stretched.searchParams.set("exp", String(Number(signed.searchParams.get("exp")) + 60));
  assert.equal((await fetch(stretched)).status, 403, "a later exp invalidates the signature");
  const expired = wp("eval", `
    $exp = time() - 1;
    echo rest_url('zero/v1/files/decks/${deck.id}/download') . '?' . http_build_query(['exp' => $exp, 'sig' => hash_hmac('sha256', "decks/${deck.id}/$exp", get_option('zero_runtime_secret'))]);
  `);
  const expiredRes = await fetch(expired.replace(/^https?:\/\/[^/]+/, harness.url));
  assert.equal(expiredRes.status, 403, "a correctly signed but expired link is refused");

  // Owner rule: only the uploader reads or deletes.
  await problem("GET", `/files/decks/${deck.id}`, { as: "editor" }, { status: 403, code: "forbidden", pointer: undefined });
  await problem("GET", `/files/decks/${deck.id}`, {}, { status: 401, code: "unauthenticated", pointer: undefined });
  await problem("DELETE", `/files/decks/${deck.id}`, { as: "admin" }, { status: 403, code: "forbidden", pointer: undefined });
  const mine = await ok("GET", `/files/decks/${deck.id}`, { as: "author" });
  assert.equal((await fetch(mine.url)).status, 200, "the owner gets a fresh working url");

  // The bytes sit under uploads/zero-private/<app>/, which Apache refuses to serve directly.
  const stored = wp("eval", `echo wp_json_encode(array_map('basename', glob(\\Zero\\Wp\\WpFiles::root() . '/blog/decks/*')));`);
  const [uuid] = JSON.parse(stored);
  assert.ok(uuid, stored);
  const direct = await fetch(`${harness.url}/wp-content/uploads/zero-private/blog/decks/${uuid}`);
  assert.equal(direct.status, 403, "Apache denies /wp-content/uploads/zero-private/");
  assert.equal((await fetch(`${harness.url}/wp-content/uploads/zero-private/.htaccess`)).status, 403);
});

test("file({ bucket }) columns on a post-backed collection: checked on write, populated for the owner only, nulled on delete", async () => {
  probe();
  const deck = (await uploadDeck(pdf("talk"))).json.data;
  await problem("POST", "/talks", { as: "author", body: { title: "Bad", deck: 999999 } }, { status: 422, code: "invalid_input", pointer: "/deck" });
  const talk = await ok("POST", "/talks", { as: "author", body: { title: "Q3", deck: deck.id } });
  assert.equal(talk.deck, deck.id);
  const own = await ok("GET", `/talks/${talk.id}?with=deck`, { as: "author" });
  assert.equal(own.deck.id, deck.id);
  assert.equal((await fetch(own.deck.url)).status, 200);
  assert.equal((await ok("GET", `/talks/${talk.id}?with=deck`, { as: "editor" })).deck, deck.id, "a reader the owner rule refuses keeps the id");
  await ok("DELETE", `/files/decks/${deck.id}`, { as: "author" });
  assert.equal((await ok("GET", `/talks/${talk.id}`)).deck, null);
  assert.equal((await fetch(deck.url)).status, 404);
});

test("without .htaccess the probe fails and uploads answer 503 until protection is back", async () => {
  assert.equal(probe(), "protected");
  wp("eval", "unlink(\\Zero\\Wp\\WpFiles::root() . '/.htaccess');");
  wp("option", "delete", "zero_runtime_private_ok");
  try {
    assert.equal(probe(), "exposed");
    const r = await uploadDeck(pdf("leak"));
    assert.equal(r.status, 503, JSON.stringify(r.json));
    assert.equal(r.json.code, "files_unavailable");
    assert.match(r.json.detail, /deny \/wp-content\/uploads\/zero-private\/ in your web server config/);
    assert.equal((await ok("GET", "/_schema")).runtime.privateFiles.protected, false);
  } finally {
    wp("eval", "\\Zero\\Wp\\WpFiles::protect();");
  }
  assert.equal(probe(), "protected");
  assert.equal((await uploadDeck(pdf("ok"))).status, 201);
});
