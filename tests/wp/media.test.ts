// Image sizes, focal point and private files on real WordPress (phase 2 §7.2). The app fragment
// (app/tp/lanes/media.ts) configures `card` (120x120 cover) and `wide` (200 wide, inside).
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createClient, TypedPressError } from "./app/tp/_generated/client/index.ts";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, crc32 } from "node:zlib";
import { api, auth, core, harness, http, ok, problem, run, sql, wp } from "./env.ts";

/** A 400x200 PNG: left half red, right half blue, so a crop's colour shows where its origin landed. */
function splitPng(): Buffer<ArrayBuffer> {
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
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
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
after(() => wp("eval", "array_map('unlink', glob(WPMU_PLUGIN_DIR . '/typedpress-test-*.php'));"));

/** Upload the split PNG through TypedPress; returns the media row. */
async function uploadSplit() {
  const r = await upload(splitPng(), "split.png", "image/png");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
}

if (process.env.TP_WP_S3 !== "1") {
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
    const disk = sizeOnDisk(img.id, `tp_${size}`);
    assert.deepEqual([disk.w, disk.h, disk.file], [w, h, img.sizes[size].url.split("/").pop()]);
  }
});

test("PATCH /media focal regenerates cover crops along the focal point; a theme size of the same shape is untouched", async () => {
  // A theme's own 120x120 crop must never pick up TypedPress's focal point or share TypedPress's file.
  wp("option", "update", "thumbnail_size_w", "120");
  wp("option", "update", "thumbnail_size_h", "120");
  wp("option", "update", "thumbnail_crop", "1");
  const img = await uploadSplit();
  const centred = sizeOnDisk(img.id, "tp_card");
  const theme = sizeOnDisk(img.id, "thumbnail");
  const wide = sizeOnDisk(img.id, "tp_wide");
  assert.notEqual(theme.file, centred.file);

  const left = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0.5 } } });
  assert.deepEqual([left.focal, [left.sizes.card.width, left.sizes.card.height]], [{ x: 0, y: 0.5 }, [120, 120]]);
  const leftCard = sizeOnDisk(img.id, "tp_card");
  assert.notEqual(leftCard.sha, centred.sha, "changing focal regenerates the cover crop (different bytes)");
  assert.deepEqual(leftCard.rgb, [255, 0], "the left focal crop is red");
  assert.equal(left.sizes.card.url.split("/").pop(), leftCard.file);
  assert.equal((await fetch(img.sizes.card.url)).status, 404, "the previous crop is removed after commit");
  assert.deepEqual(sizeOnDisk(img.id, "thumbnail"), theme, "the theme's same-shape crop is untouched");
  assert.deepEqual(sizeOnDisk(img.id, "tp_wide"), wide, "inside sizes are not regenerated");

  await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 1, y: 0.5 } } });
  assert.deepEqual(sizeOnDisk(img.id, "tp_card").rgb, [0, 255], "the right focal crop is blue");
  assert.equal(wp("post", "meta", "get", String(img.id), "_tp_focal"), '{"x":1,"y":0.5}');
});

test("focal A → B → A inside one transaction: rollback keeps the committed crop, commit keeps the final one", async () => {
  const img = await uploadSplit();
  /** Run focal updates in one transaction (optionally rolled back); returns the tp_card files left on disk. */
  const sequence = (focals: [number, number][], rollback: boolean): string[] => JSON.parse(wp("eval", `
    $media = \\TypedPress\\Wp\\Runtime::plugin()->app()->db->media();
    try {
      \\TypedPress\\db()->transaction(function () use ($media) {
        foreach (${JSON.stringify(focals)} as [$x, $y]) {
          $media->update(${img.id}, ['focal' => ['x' => $x, 'y' => $y]]);
        }
        ${rollback ? "throw new RuntimeException('roll back');" : ""}
      });
    } catch (RuntimeException) {}
    $file = get_attached_file(${img.id});
    echo wp_json_encode(array_map('basename', glob(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-tp_card-*')));
  `));

  sequence([[0, 0.5]], false);
  const committed = sizeOnDisk(img.id, "tp_card");
  assert.deepEqual(sequence([[1, 0.5], [0, 0.5]], true), [committed.file], "rollback: only the committed crop remains");
  assert.deepEqual(sizeOnDisk(img.id, "tp_card"), committed);

  const files = sequence([[1, 0.5], [0, 0.5]], false);
  const final = sizeOnDisk(img.id, "tp_card");
  assert.deepEqual(files, [final.file], "commit: exactly the final crop remains, and metadata points at it");
  assert.deepEqual(final.rgb, [255, 0]);
});

test("a crop that fails to render rolls the focal change back, and the same PATCH succeeds on retry", async () => {
  const img = await uploadSplit();
  const before = sizeOnDisk(img.id, "tp_card");
  // A must-use plugin that makes every image save fail while its flag option is set.
  muPlugin("typedpress-test-editor-fails", "<?php\nadd_filter('wp_image_editors', fn ($e) => get_option('tp_test_editor_fails') ? [] : $e);\n");
  wp("option", "update", "tp_test_editor_fails", "1");
  try {
    const failed = await http("PATCH", `${api}/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.equal((await ok("GET", `/media/${img.id}`)).focal, null, "the focal point did not commit");
    assert.deepEqual(sizeOnDisk(img.id, "tp_card"), before, "the previous crop is still in place");
    const attachments = sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n;
    const disk = () => wp("eval", "echo wp_json_encode(glob(wp_upload_dir()['path'] . '/*'));");
    const files = disk();
    const form = new FormData();
    form.append("file", new Blob([splitPng()], { type: "image/png" }), `failed-native-${run}.png`);
    const nativeFailed = await http("POST", `${core}/media`, { as: "author", form });
    assert.equal(nativeFailed.status, 400, JSON.stringify(nativeFailed.json));
    assert.equal(nativeFailed.json.code, "rest_upload_image_type_not_supported", "core retains its image-editor validation");
    assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n, attachments);
    assert.equal(disk(), files);
  } finally {
    wp("option", "delete", "tp_test_editor_fails");
  }
  const retried = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
  assert.deepEqual(retried.focal, { x: 0, y: 0 });
  assert.deepEqual(sizeOnDisk(img.id, "tp_card").rgb, [255, 0]);

  // A late refusal may refresh another attachment or create an edited attachment. Rollback
  // owns only files actually created by this operation, never the committed source's metadata.
  muPlugin("typedpress-test-native-upload", `<?php
add_filter('wp_generate_attachment_metadata', function ($meta) {
    if (get_option('tp_test_native_upload') === 'generate') throw new RuntimeException('Native metadata refused');
    return $meta;
}, 100);
add_action('rest_after_insert_attachment', function () {
    if (get_option('tp_test_native_upload') !== 'refresh') return;
    $id = (int) get_option('tp_test_native_source');
    wp_update_attachment_metadata($id, wp_get_attachment_metadata($id));
    throw new RuntimeException('Native insert refused after existing metadata refresh');
});
add_filter('wp_edited_image_metadata', function ($meta) {
    if (get_option('tp_test_native_upload') === 'edit') throw new RuntimeException('Native edited metadata refused');
    return $meta;
});
`);
  const source = await http("GET", `${core}/media/${img.id}`, { as: "editor" });
  assert.equal(source.status, 200);
  const current = await ok("GET", `/media/${img.id}`);
  const sourceUrls = [source.json.source_url, ...Object.values(current.sizes).map((size) => {
    assert.ok(typeof size === "object" && size !== null && "url" in size && typeof size.url === "string");
    return size.url;
  })];
  const bytes = async (url: string) => {
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    return Buffer.from(await response.arrayBuffer()).toString("base64");
  };
  const committedBytes = await Promise.all(sourceUrls.map(bytes));
  const attachments = sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n;
  const disk = () => wp("eval", "echo wp_json_encode(glob(wp_upload_dir()['path'] . '/*'));");
  const files = disk();
  wp("option", "update", "tp_test_native_source", String(img.id));
  try {
    for (const phase of ["generate", "refresh", "edit"]) {
      wp("option", "update", "tp_test_native_upload", phase);
      const form = new FormData();
      form.append("file", new Blob([splitPng()], { type: "image/png" }), `rollback-native-${phase}-${run}.png`);
      const failed = phase === "edit"
        ? await http("POST", `${core}/media/${img.id}/edit`, { as: "editor", body: { src: source.json.source_url, rotation: 90 } })
        : await http("POST", `${core}/media`, { as: "author", form });
      assert.equal(failed.status, 500, `${phase}: ${JSON.stringify(failed.json)}`);
      assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n, attachments, phase);
      assert.equal(disk(), files, `${phase}: new files roll back and committed files remain`);
      assert.deepEqual(await Promise.all(sourceUrls.map(bytes)), committedBytes, `${phase}: committed source and renditions retain their bytes`);
    }
  } finally {
    wp("option", "delete", "tp_test_native_upload");
    wp("option", "delete", "tp_test_native_source");
  }
  const edited = await http("POST", `${core}/media/${img.id}/edit`, { as: "editor", body: { src: source.json.source_url, rotation: 90 } });
  assert.equal(edited.status, 201, JSON.stringify(edited.json));
  assert.notEqual(edited.json.id, img.id, "core creates a distinct edited attachment on retry");
  assert.deepEqual([edited.json.media_details.width, edited.json.media_details.height], [200, 400]);
  await bytes(edited.json.source_url);
  assert.deepEqual(await Promise.all(sourceUrls.map(bytes)), committedBytes, "successful editing also preserves its source");
});

test("native uploads enforce TypedPress authority and retain core validation, metadata, response and image sizes", async () => {
  const parent = Number(wp("post", "create", "--post_type=post", "--post_status=draft", `--post_author=${harness.users.author.id}`, "--post_title=Native media parent", "--porcelain"));
  const multipart = () => {
    const form = new FormData();
    form.append("file", new Blob([splitPng()], { type: "image/png" }), `native-${run}.png`);
    for (const [name, value] of Object.entries({ post: String(parent), title: "Native title", caption: "Native caption", description: "Native description", alt_text: "Native upload alt" })) form.append(name, value);
    return form;
  };
  // A real WP capability grant makes core's upload permission pass, without making this viewer
  // a TypedPress author. The request must still be refused before any attachment is persisted.
  wp("user", "add-cap", "subscriber", "upload_files");
  try {
    const before = sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n;
    const deniedForm = multipart();
    deniedForm.delete("post");
    const refused = await http("POST", `${core}/media`, { as: "subscriber", form: deniedForm });
    assert.equal(refused.status, 403, JSON.stringify(refused.json));
    assert.equal(refused.json.code, "forbidden");
    assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_type = 'attachment'")[0].n, before);
  } finally {
    wp("user", "remove-cap", "subscriber", "upload_files");
  }
  const uploaded = await http("POST", `${core}/media`, { as: "author", form: multipart() });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.json));
  assert.deepEqual(
    [uploaded.json.type, uploaded.json.post, uploaded.json.title.raw, uploaded.json.caption.raw, uploaded.json.description.raw, uploaded.json.alt_text],
    ["attachment", parent, "Native title", "Native caption", "Native description", "Native upload alt"],
  );
  assert.equal(uploaded.json.mime_type, "image/png");
  assert.equal(uploaded.json._links.self[0].href, `${core}/media/${uploaded.json.id}`);
  // Its parent is a draft: like core, the API shows it only to whoever may read the draft (its author).
  const row = await ok("GET", `/media/${uploaded.json.id}`, { as: "author" });
  assert.equal(row.alt, "Native upload alt");
  assert.deepEqual([row.sizes.card.width, row.sizes.card.height, row.sizes.wide.width], [120, 120, 200]);
  assert.equal((await fetch(row.sizes.card.url)).status, 200);

  // Gutenberg and other WP clients may send raw bytes instead of multipart. Keep core's
  // Content-Disposition, hash and MIME validation instead of parsing this transport again.
  const headers = { ...auth("author"), "content-type": "image/png", "content-disposition": `attachment; filename="raw-${run}.png"` };
  const badHash = await fetch(`${core}/media`, { method: "POST", headers: { ...headers, "content-md5": "wrong" }, body: splitPng() });
  assert.equal(badHash.status, 412, await badHash.text());
  const raw = await fetch(`${core}/media?title=Raw%20title`, { method: "POST", headers, body: splitPng() });
  const rawRow = await raw.json();
  assert.equal(raw.status, 201, JSON.stringify(rawRow));
  assert.equal(rawRow.title.raw, "Raw title");
  assert.equal((await ok("GET", `/media/${rawRow.id}`)).mime, "image/png");
  const invalid = new FormData();
  invalid.append("file", new Blob(["<?php echo 'invalid';"], { type: "application/x-php" }), "invalid.php");
  const invalidUpload = await http("POST", `${core}/media`, { as: "author", form: invalid });
  assert.equal(invalidUpload.status, 500, JSON.stringify(invalidUpload.json));
  assert.equal(invalidUpload.json.code, "rest_upload_unknown_error");
});

test("native alt/delete share TypedPress rules and reference cleanup while caption/title retain WP permissions", async () => {
  const img = await uploadSplit();
  const post = await ok("POST", "/posts", { as: "admin", body: { title: `Native reference ${run}`, cover: img.id } });
  const refusedAlt = await http("POST", `${core}/media/${img.id}`, { as: "author", body: { alt_text: "Bypass", title: "Must not change" } });
  assert.equal(refusedAlt.status, 403, JSON.stringify(refusedAlt.json));
  assert.equal(refusedAlt.json.code, "forbidden");
  assert.equal((await ok("GET", `/media/${img.id}`)).alt, null);
  const ownCaption = await http("POST", `${core}/media/${img.id}`, { as: "author", body: { title: "WP title", caption: "WP caption" } });
  assert.equal(ownCaption.status, 200, JSON.stringify(ownCaption.json));
  assert.deepEqual([ownCaption.json.title.raw, ownCaption.json.caption.raw], ["WP title", "WP caption"]);
  const other = await uploadSplit();
  wp("post", "update", String(other.id), `--post_author=${harness.users.admin.id}`);
  assert.equal((await http("POST", `${core}/media/${other.id}`, { as: "author", body: { caption: "Not mine" } })).status, 403, "WP still denies another owner's caption");
  const edited = await http("POST", `${core}/media/${img.id}`, { as: "editor", body: { alt_text: "Editor alt" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  assert.equal(edited.json.alt_text, "Editor alt");
  assert.equal((await ok("GET", `/media/${img.id}`)).alt, "Editor alt");
  const refusedDelete = await http("DELETE", `${core}/media/${img.id}?force=true`, { as: "author" });
  assert.equal(refusedDelete.status, 403, JSON.stringify(refusedDelete.json));
  assert.equal((await ok("GET", `/posts/${post.id}`, { as: "admin" })).cover, img.id);
  assert.equal((await fetch(img.url)).status, 200);

  // A real native-plugin refusal must undo the reference writes too, not merely keep the file.
  muPlugin("typedpress-test-native-delete", "<?php\nadd_filter('pre_delete_attachment', fn ($delete) => get_option('tp_test_native_delete') === 'early' ? false : $delete);\nadd_action('rest_delete_attachment', function () { if (get_option('tp_test_native_delete') === 'late') throw new RuntimeException('Native deletion refused'); });\n");
  try {
    for (const phase of ["early", "late"]) {
      wp("option", "update", "tp_test_native_delete", phase);
      const failed = await http("DELETE", `${core}/media/${img.id}?force=true`, { as: "editor" });
      assert.equal(failed.status, 500, JSON.stringify(failed.json));
      assert.equal(failed.json.code, phase === "early" ? "rest_cannot_delete" : "internal");
      assert.equal((await ok("GET", `/posts/${post.id}`, { as: "admin" })).cover, img.id);
      assert.equal((await ok("GET", `/media/${img.id}`)).alt, "Editor alt");
      assert.equal((await fetch(img.url)).status, 200);
      assert.equal((await fetch(img.sizes.card.url)).status, 200);
    }
  } finally {
    wp("option", "delete", "tp_test_native_delete");
  }
  const deleted = await http("DELETE", `${core}/media/${img.id}?force=true`, { as: "editor" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual([deleted.json.deleted, deleted.json.previous.id, deleted.json.previous.alt_text], [true, img.id, "Editor alt"]);
  assert.equal((await ok("GET", `/posts/${post.id}`, { as: "admin" })).cover, null);
  assert.equal(sql(`SELECT COUNT(*) AS n FROM wp_posts WHERE ID = ${img.id}`)[0].n, "0");
  assert.equal((await fetch(img.url)).status, 404);
  assert.equal((await fetch(img.sizes.card.url)).status, 404);
});

test("core regeneration: the missing-sizes pass fills TypedPress sizes without touching a same-shape theme crop; a full pass replaces renditions", async () => {
  // A theme crop of TypedPress's card shape anchored top-left (different bytes from TypedPress's centred crop).
  muPlugin("typedpress-test-theme-size", "<?php\nadd_action('init', fn () => add_image_size('theme_card', 120, 120, ['left', 'top']));\n");
  const img = await uploadSplit();
  const theme = sizeOnDisk(img.id, "theme_card");
  const files = (): string[] => JSON.parse(wp("eval", `
    $file = get_attached_file(${img.id});
    echo wp_json_encode(array_map('basename', glob(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-tp_*')));
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
  // Only a TypedPress size missing: core returns early, TypedPress fills it.
  dropAndUpdate(["tp_card"]);
  const filled = sizeOnDisk(img.id, "tp_card");
  assert.deepEqual([filled.w, filled.h], [120, 120]);
  assert.deepEqual(sizeOnDisk(img.id, "theme_card"), theme, "the theme's crop keeps its bytes");
  assert.equal(files().length, 2, "card + wide, nothing else");
  // A TypedPress size and a theme size missing: core makes its own, TypedPress fills its absent one.
  dropAndUpdate(["tp_card", "theme_card"]);
  const both = sizeOnDisk(img.id, "tp_card");
  assert.deepEqual([both.w, both.h, files().length], [120, 120, 2]);
  const remade = sizeOnDisk(img.id, "theme_card");
  assert.deepEqual([remade.file, remade.w, remade.h, remade.rgb], [theme.file, theme.w, theme.h, theme.rgb], "core re-made its top-left crop on its own file");

  // A regeneration inside a transaction that rolls back keeps the committed metadata and files.
  const committed = files();
  const meta = wp("eval", `
    require_once ABSPATH . 'wp-admin/includes/image.php';
    try {
      \\TypedPress\\Wp\\Runtime::plugin()->db()->transaction(function () {
        wp_update_attachment_metadata(${img.id}, wp_generate_attachment_metadata(${img.id}, get_attached_file(${img.id})));
        wp_get_attachment_metadata(${img.id});
        throw new RuntimeException('roll back');
      });
    } catch (RuntimeException) {}
    echo wp_get_attachment_metadata(${img.id})['sizes']['tp_card']['file'];
  `);
  assert.deepEqual(files(), committed, "rollback removes the new renditions and keeps the committed ones");
  assert.ok(committed.includes(meta), "metadata (and its cache) still names a committed rendition");

  // A full core pass (what regenerate plugins call) renders fresh TypedPress renditions, and TypedPress removes
  // the ones they replace (WP-CLI's regenerate would delete old files itself, hiding TypedPress's cleanup).
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
    $stale = pathinfo($file, PATHINFO_FILENAME) . '-tp_card-stale.png';
    copy($file, dirname($file) . '/' . $stale);
    $meta = wp_get_attachment_metadata($id);
    $meta['sizes']['tp_card'] = ['file' => $stale, 'width' => 50, 'height' => 50, 'mime-type' => 'image/png'];
    wp_update_attachment_metadata($id, $meta);
    echo $id;
  `);
  await ok("PATCH", `/media/${id}`, { as: "editor", body: { focal: { x: 0.5, y: 0.5 } } });
  const left = JSON.parse(wp("eval", `
    $file = get_attached_file(${id});
    echo wp_json_encode([isset(wp_get_attachment_metadata(${id})['sizes']['tp_card']), is_file(dirname($file) . '/' . pathinfo($file, PATHINFO_FILENAME) . '-tp_card-stale.png')]);
  `));
  assert.deepEqual(left, [false, false], "no tp_card entry and no stale file");
  const row = await ok("GET", `/media/${id}`);
  assert.equal(row.sizes.card.url, row.url, "the original serves the size");
});

test("without Jetpack the Image CDN adapter is inert", async () => {
  const schema = await ok("GET", "");
  assert.equal(schema.runtime.wp.imageCdn, false);
});

// ================================================================ private files (G2)
// Rule edges (accept, maxBytes, owner, expiry math, `with` gating) are held by tests/php/files_test.php;
// these prove what only WordPress decides: REST streaming, Apache, the probe, editor saves, rollback.

/** A minimal valid PDF (finfo sniffs application/pdf). */
const pdf = (text: string) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${text}\ntrailer<<>>\n%%EOF\n`);

async function uploadDeck(bytes: Uint8Array, as: "author" | "editor" = "author", name = "Q3 plan.pdf") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), name);
  return http("POST", `${api}/files/decks`, { as, form });
}

/** Upload a deck as the author; returns the row. */
async function deck(text: string) {
  const r = await uploadDeck(pdf(text));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
}

/**
 * The harness publishes WordPress on a host port the container can't reach, so the probe is routed
 * to the web server's in-network name with `tp_private_probe_url`, the filter hosts use for the
 * same reason. Probing then exercises the real Apache `.htaccess` decision.
 */
function probe(): string {
  muPlugin("typedpress-test-probe-route", "<?php\nadd_filter('tp_private_probe_url', fn ($u) => str_replace(home_url(), 'http://wordpress', $u));\n");
  return wp("eval", "echo \\TypedPress\\Wp\\WpFiles::probe() ? 'protected' : 'exposed';");
}

/** The stored file names in the decks bucket. */
const stored = (): string[] => JSON.parse(wp("eval", "echo wp_json_encode(array_map('basename', glob(\\TypedPress\\Wp\\WpFiles::root() . '/blog/decks/*')));"));

test("activation writes the deny rules and reports a passing probe", async () => {
  // Route the probe, remove the rules and the verdict, then reactivate the app plugin for real.
  probe();
  wp("eval", "unlink(\\TypedPress\\Wp\\WpFiles::root() . '/.htaccess'); delete_option('tp_runtime_private_ok'); delete_option('tp_runtime_private_checked');");
  wp("plugin", "deactivate", harness.plugin);
  wp("plugin", "activate", harness.plugin);
  assert.equal(wp("option", "get", "tp_runtime_private_ok"), "1");
  assert.match(wp("eval", "echo file_get_contents(\\TypedPress\\Wp\\WpFiles::root() . '/.htaccess');"), /Require all denied/);
  assert.equal(wp("option", "get", "tp_runtime_secret").length, 64);
  assert.equal((await ok("GET", "")).runtime.privateFiles.protected, true);
});

test("a site already on runtime tables 0.2 gains the files table and working protection on its next admin_init", async () => {
  // What a site that ran the runtime before private files existed looks like: no table, no private
  // directory, no secret, no probe verdict, and no reactivation.
  probe(); // routes the probe to the in-network host (harness only)
  sql("DROP TABLE wp_tp__files");
  wp("eval", `
    array_map('unlink', glob(\\TypedPress\\Wp\\WpFiles::root() . '/{,.}*', GLOB_BRACE) ?: []);
    foreach (['tp_runtime_private_ok', 'tp_runtime_private_checked', 'tp_runtime_secret'] as $o) delete_option($o);
  `);
  wp("option", "update", "tp_runtime_tables", "0.2");
  wp("eval", "do_action('admin_init');");
  assert.deepEqual(sql("SHOW TABLES LIKE 'wp\\_tp\\_\\_files'").length, 1, "the table exists again");
  assert.equal(wp("option", "get", "tp_runtime_tables"), wp("eval", "echo \\TypedPress\\Wp\\Runtime::tablesVersion();"));
  assert.equal(wp("option", "get", "tp_runtime_private_ok"), "1", "the deny rules were written and probed");
  assert.equal((await uploadDeck(pdf("after upgrade"))).status, 201, "uploads work without reactivating anything");
});

test("file rows belong to their app: another app's ids don't resolve", async () => {
  probe();
  const row = await deck("mine");
  // Re-label the row as another app's (what a replaced or second app leaves behind).
  sql(`UPDATE wp_tp__files SET app = 'other' WHERE id = ${row.id}`);
  try {
    await problem("GET", `/files/decks/${row.id}`, { as: "author" }, { status: 404, code: "not_found", pointer: undefined });
    assert.equal((await fetch(row.url)).status, 404);
    await problem("POST", "/talks", { as: "author", body: { title: "Foreign", deck: row.id } }, { status: 422, code: "invalid_input", pointer: "/deck" });
  } finally {
    sql(`UPDATE wp_tp__files SET app = 'blog' WHERE id = ${row.id}`);
  }
  assert.equal((await ok("GET", `/files/decks/${row.id}`, { as: "author" })).id, row.id);
});

test("a signed URL streams the file through the REST route with the security headers", async () => {
  probe();
  const row = await deck("slide one");
  assert.deepEqual([row.bucket, row.mime, row.filename, row.ownerId, "path" in row], ["decks", "application/pdf", "Q3 plan.pdf", harness.users.author.id, false]);
  assert.ok(row.url.startsWith(`${harness.url}/wp-json/typedpress/v1/files/decks/${row.id}/download?`), row.url);
  const res = await fetch(row.url);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), pdf("slide one"));
  assert.deepEqual(
    ["content-type", "x-content-type-options", "content-security-policy", "cache-control", "content-disposition"].map((h) => res.headers.get(h)),
    ["application/pdf", "nosniff", "sandbox", "private, no-store", `attachment; filename="Q3 plan.pdf"; filename*=UTF-8''Q3%20plan.pdf`],
  );
});

test("a forged or expired signature gets 403 from WordPress", async () => {
  probe();
  const row = await deck("signed");
  const forged = new URL(row.url);
  forged.searchParams.set("sig", "0".repeat(64));
  assert.equal((await fetch(forged)).status, 403);
  // Correctly signed with the site secret, but already expired.
  const expired = wp("eval", `
    $exp = time() - 1;
    echo 'exp=' . $exp . '&sig=' . hash_hmac('sha256', "decks/${row.id}/$exp", get_option('tp_runtime_secret'));
  `);
  assert.equal((await fetch(`${api}/files/decks/${row.id}/download?${expired}`)).status, 403);
});

test("the owner rule holds over REST", async () => {
  probe();
  const row = await deck("mine");
  await problem("GET", `/files/decks/${row.id}`, { as: "editor" }, { status: 403, code: "forbidden", pointer: undefined });
  await problem("DELETE", `/files/decks/${row.id}`, { as: "admin" }, { status: 403, code: "forbidden", pointer: undefined });
  assert.equal((await fetch((await ok("GET", `/files/decks/${row.id}`, { as: "author" })).url)).status, 200, "the owner gets a fresh working url");
});

test("Apache denies the direct /wp-content/uploads/typedpress-private/ URL", async () => {
  probe();
  const before = stored();
  await deck("direct");
  const [file] = stored().filter((f) => !before.includes(f));
  assert.ok(file);
  assert.equal((await fetch(`${harness.url}/wp-content/uploads/typedpress-private/blog/decks/${file}`)).status, 403);
});

test("file(bucket) columns: checked on API and editor writes, populated for the owner only, nulled on delete", async () => {
  probe();
  const row = await deck("talk");
  await problem("POST", "/talks", { as: "author", body: { title: "Bad", deck: 999999 } }, { status: 422, code: "invalid_input", pointer: "/deck" });
  // Core REST saves with the SCF field go through the same check.
  const editor = await fetch(`${harness.url}/wp-json/wp/v2/tp_talks`, {
    method: "POST",
    headers: { ...auth("author"), "content-type": "application/json" },
    body: JSON.stringify({ title: "Editor", status: "publish", acf: { tp_deck: 999999 } }),
  });
  assert.equal(editor.status, 400, await editor.text());
  // … including a file id nested in a group, rejected before core persists anything.
  const nested = await fetch(`${harness.url}/wp-json/wp/v2/tp_talks`, {
    method: "POST",
    headers: { ...auth("author"), "content-type": "application/json" },
    body: JSON.stringify({ title: "Nested editor", status: "publish", acf: { tp_extras: { handout: 999999 } } }),
  });
  assert.equal(nested.status, 400, await nested.text());
  assert.equal(sql("SELECT COUNT(*) AS n FROM wp_posts WHERE post_title = 'Nested editor'")[0].n, "0");

  const talk = await ok("POST", "/talks", { as: "author", body: { title: "Q3", deck: row.id } });
  const own = await ok("GET", `/talks/${talk.id}?with=deck`, { as: "author" });
  assert.equal((await fetch(own.deck.url)).status, 200);
  assert.equal((await ok("GET", `/talks/${talk.id}?with=deck`, { as: "editor" })).deck, row.id, "a reader the owner rule refuses keeps the id");
  await ok("DELETE", `/files/decks/${row.id}`, { as: "author" });
  assert.equal((await ok("GET", `/talks/${talk.id}`)).deck, null, "the referencing post meta is nulled");
  assert.equal((await fetch(row.url)).status, 404);
});

test("rollback: a failed upload leaves no bytes, a failed delete keeps the row, the reference and the bytes", async () => {
  probe();
  const row = await deck("keep");
  const talk = await ok("POST", "/talks", { as: "author", body: { title: "Kept", deck: row.id } });
  const before = stored();
  // Run inside the web server (it owns the private directory): upload, then delete, each rolled back.
  muPlugin("typedpress-test-rollback", `<?php
add_action('rest_api_init', fn () => register_rest_route('typedpress-test/v1', '/rollback/(?P<id>\\\\d+)', ['methods' => 'POST', 'permission_callback' => '__return_true',
  'callback' => function ($r) {
    $db = \\TypedPress\\Wp\\Runtime::plugin()->db();
    $out = [];
    $tmp = tempnam(get_temp_dir(), 'zr');
    file_put_contents($tmp, "%PDF-1.4\\n%%EOF\\n");
    foreach (['upload' => fn () => \\TypedPress\\Media\\Files::upload('decks', $tmp, 'r.pdf', null), 'delete' => fn () => \\TypedPress\\Media\\Files::delete('decks', (int) $r['id'], null)] as $name => $op) {
      try { $db->transaction(function () use ($op) { $op(); throw new RuntimeException('roll back'); }); } catch (RuntimeException $e) { $out[$name] = $e->getMessage(); }
    }
    return $out;
  }]));
`);
  const res = await fetch(`${harness.url}/wp-json/typedpress-test/v1/rollback/${row.id}`, { method: "POST" });
  const text = await res.text();
  assert.equal(res.status, 200, text.slice(0, 2000));
  assert.deepEqual(JSON.parse(text), { upload: "roll back", delete: "roll back" }, "both operations ran and rolled back");
  assert.deepEqual(stored(), before);
  assert.equal((await ok("GET", `/talks/${talk.id}`)).deck, row.id);
  assert.equal((await fetch(row.url)).status, 200);
});

test("a probe that cannot write its file is a failed probe, not a pass", async () => {
  assert.equal(probe(), "protected");
  wp("eval", "chmod(\\TypedPress\\Wp\\WpFiles::root(), 0555);");
  try {
    assert.equal(probe(), "exposed");
    assert.equal((await uploadDeck(pdf("unproven"))).status, 503);
  } finally {
    wp("eval", "chmod(\\TypedPress\\Wp\\WpFiles::root(), 0755);");
  }
  assert.equal(probe(), "protected");
});

test("without .htaccess the probe fails and uploads answer 503 until protection is back", async () => {
  assert.equal(probe(), "protected");
  wp("eval", "unlink(\\TypedPress\\Wp\\WpFiles::root() . '/.htaccess');");
  try {
    assert.equal(probe(), "exposed");
    const r = await uploadDeck(pdf("leak"));
    assert.equal(r.status, 503, JSON.stringify(r.json));
    assert.equal(r.json.code, "files_unavailable");
    assert.match(r.json.detail, /deny \/wp-content\/uploads\/typedpress-private\/ in your web server config/);
    assert.equal((await ok("GET", "")).runtime.privateFiles.protected, false);
  } finally {
    wp("eval", "\\TypedPress\\Wp\\WpFiles::protect();");
  }
  assert.equal(probe(), "protected");
  assert.equal((await uploadDeck(pdf("ok"))).status, 201);
});

test("a media item reads on the API exactly as on core's media route: its parent post's visibility decides", async () => {
  const upload = (parent?: number) => {
    const form = new FormData();
    form.append("file", new Blob([splitPng()], { type: "image/png" }), `parent-${run}-${parent ?? "none"}.png`);
    if (parent !== undefined) form.append("post", String(parent));
    return http("POST", `${core}/media`, { as: "author", form });
  };
  const post = (status: string) => Number(wp("post", "create", "--post_type=post", `--post_status=${status}`, `--post_author=${harness.users.author.id}`, `--post_title=Media parent ${status} ${run}`, "--porcelain"));
  const published = (await upload(post("publish"))).json.id;
  const drafted = (await upload(post("draft"))).json.id;
  const loose = (await upload()).json.id;
  const both = async (id: number, as?: "author" | "subscriber") => {
    const viaCore = await http("GET", `${core}/media/${id}`, as ? { as } : {});
    const viaApi = await http("GET", `${api}/media/${id}`, as ? { as } : {});
    return [viaCore.status, viaApi.status];
  };
  assert.deepEqual(await both(published), [200, 200], "a published parent: anyone reads it");
  assert.deepEqual(await both(loose), [200, 200], "an unattached item: anyone reads it");
  const [coreAnon, apiAnon] = await both(drafted);
  assert.ok(coreAnon >= 400, `core hides a draft's attachment (${coreAnon})`);
  assert.equal(apiAnon, 404, "the API hides it too, as a missing item");
  assert.deepEqual(await both(drafted, "subscriber"), [403, 404], "another signed-in user: hidden");
  assert.deepEqual(await both(drafted, "author"), [200, 200], "the draft's author reads it");
  const listed = await ok("GET", "/media" + `?${new URLSearchParams({ limit: "100" })}`);
  assert.ok(!listed.some((m: any) => m.id === drafted), "the anonymous list doesn't hold it either");
});

} else {
  // This lane buys the real provider/replica boundary; local tests above own the ordinary rules.
  test("S3 keeps files, originals and editor derivatives durable across fresh replicas", async () => {
    const compose = (...args: string[]) => execFileSync(fileURLToPath(new URL("./harness.sh", import.meta.url)), ["compose", ...args], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).trim();
    const replicaPhp = (code: string) => compose("exec", "-T", "replica", "php", "-r", "require '/var/www/html/wp-load.php'; " + code);
    const editor = createClient({ url: api, headers: auth("editor") });
    const other = createClient({ url: api, headers: auth("subscriber") });
    const bytes = Buffer.from("%PDF-1.4\nstateless replica proof\n%%EOF\n");
    const file = await editor.files.decks.upload(new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), { filename: "replicas.pdf" });
    const image = await editor.media.upload(new Blob([splitPng()], { type: "image/png" }), { filename: "replicas.png" });
    const post = await editor.talks.create({ title: "Remote files", deck: file.id, image: image.id });
    const record = await editor.uploadRecords.create({ deck: file.id, image: image.id });
    for (const result of [await editor.talks.get(post.id, { with: { deck: true, image: true } }), await editor.uploadRecords.get(record.id, { with: { deck: true, image: true } })]) {
      assert.ok(result.deck !== null && typeof result.deck === "object");
      assert.equal(result.deck.id, file.id);
      assert.equal(result.image?.id, image.id);
    }
    await assert.rejects(other.files.decks.get(file.id), (error: unknown) => error instanceof TypedPressError && error.status === 403);
    const masked = await other.uploadRecords.get(record.id, { with: { deck: true } });
    assert.equal(masked.deck, file.id, "unauthorized relation loads reveal no download grant");
    assert.equal((await fetch(file.url.split("?")[0])).status, 403);
    assert.deepEqual(Buffer.from(await (await fetch(file.url)).arrayBuffer()), bytes);
    assert.deepEqual([image.sizes.card.width, image.sizes.card.height], [120, 120]);
    const original = Buffer.from(await (await fetch(image.url)).arrayBuffer());
    const derivative = Buffer.from(await (await fetch(image.sizes.card.url)).arrayBuffer());
    assert.deepEqual(original, Buffer.from(splitPng()));
    assert.notDeepEqual(derivative, original);
    // Core REST uploads follow the same WP hooks, including the TypedPress sizes used by the editor.
    const coreUpload = await fetch(`${harness.url}/wp-json/wp/v2/media`, { method: "POST", headers: { ...auth("editor"), "Content-Type": "image/png", "Content-Disposition": 'attachment; filename="editor.png"' }, body: splitPng() });
    assert.equal(coreUpload.status, 201, await coreUpload.clone().text());
    const attachment: { id: number; source_url: string; media_details: { sizes: Record<string, { source_url: string }> } } = await coreUpload.json();
    const coreDerivative = attachment.media_details.sizes.tp_card.source_url;
    assert.equal((await fetch(coreDerivative)).status, 200);
    // Persist a real block URL: it must remain useful without an expiring provider grant.
    await editor.posts.create({ title: "Bucket block", body: `<!-- wp:image {"id":${attachment.id}} --><figure class="wp-block-image"><img src="${attachment.source_url}"/></figure><!-- /wp:image -->` });
    const manifest: Record<string, { key: string }> = JSON.parse(wp("eval", `echo wp_json_encode(\\TypedPress\\Wp\\Uploads::manifest(${image.id}));`));
    assert.ok(Object.values(manifest).length >= 3);
    assert.ok(Object.values(manifest).every((entry) => /\/media\/[a-f0-9]{48}$/.test(entry.key)));
    const inspect = await ok("GET", "");
    const publicJson = JSON.stringify(inspect);
    assert.equal(publicJson.includes("TP_TEST_UPLOAD_SECRET"), false);
    assert.equal(publicJson.includes("1111111111111111111111111111111111111111111111111111111111111111"), false);
    const fileKey = sql(`SELECT path FROM wp_tp__files WHERE id=${file.id}`)[0].path.slice(3);
    const unsignedObject = "http://garage:3900/typedpress-uploads/" + fileKey.split("/").map(encodeURIComponent).join("/");
    assert.equal(wp("eval", `echo wp_remote_retrieve_response_code(wp_remote_get(${JSON.stringify(unsignedObject)}));`), "403", "the provider denies unsigned private-object reads");
    // Provisioning can run again after uploads without replacing the bucket, key or objects.
    execFileSync(fileURLToPath(new URL("./harness.sh", import.meta.url)), ["s3-setup"], { stdio: "pipe" });
    // New container, independent WP volume, same database and bucket. No A upload bytes survive.
    compose("exec", "-T", "wordpress", "sh", "-c", "rm -rf /var/www/html/wp-content/uploads/* /tmp/typedpress-uploads-*");
    compose("--profile", "replica", "up", "-d", "replica");
    const replicaUrl = `http://127.0.0.1:${process.env.TP_WP_REPLICA_PORT ?? "8791"}`;
    // Poll an actual HTTP signal while the fresh image installs core/config.
    const deadline = Date.now() + 60_000;
    while (true) {
      try { if ((await fetch(`${replicaUrl}/wp-json/typedpress/v1`)).status === 200) break; } catch {}
      assert.ok(Date.now() < deadline, "fresh replica reached the TypedPress route");
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(replicaPhp("echo count(glob(WP_CONTENT_DIR . '/uploads/*') ?: []);"), "0", "B starts without upload data");
    wp("option", "update", "home", replicaUrl);
    wp("option", "update", "siteurl", replicaUrl);
    compose("stop", "wordpress");
    const replica = createClient({ url: `${replicaUrl}/wp-json/typedpress/v1`, headers: auth("editor") });
    const fresh = await replica.files.decks.get(file.id);
    assert.deepEqual(Buffer.from(await (await fetch(fresh.url)).arrayBuffer()), bytes);
    const freshImage = await replica.media.get(image.id);
    assert.deepEqual(Buffer.from(await (await fetch(freshImage.url)).arrayBuffer()), original);
    assert.deepEqual(Buffer.from(await (await fetch(freshImage.sizes.card.url)).arrayBuffer()), derivative);
    assert.equal((await fetch(coreDerivative.replace(harness.url, replicaUrl))).status, 200);
    const focal = await replica.media.update(image.id, { focal: { x: 0, y: 0.5 } });
    assert.notDeepEqual(Buffer.from(await (await fetch(focal.sizes.card.url)).arrayBuffer()), derivative, "B hydrates original and generates a new crop");
    assert.equal((await fetch(freshImage.sizes.card.url)).status, 404, "superseded crop loses its manifest grant");
    const responsive = replicaPhp(`echo wp_get_attachment_image_srcset(${attachment.id}, 'tp_wide');`);
    assert.ok(responsive.includes('/wp-json/typedpress/v1/media/'), responsive);
    for (const candidate of responsive.split(', ')) {
      assert.equal((await fetch(candidate.split(' ')[0])).status, 200, "core srcset uses durable variants");
    }
    // Core clears its size list before regenerating deterministic thumbnail paths.
    // Immediate deletion, queued commit deletion and rollback compensation own distinct lifecycles.
    for (const mode of ["native", "commit", "rollback"] as const) {
      const regenerated: { missing: string[]; restored: boolean | null; thumbnails: { size: string; url: string; bytes: string }[] } = JSON.parse(replicaPhp(String.raw`
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $id = ${attachment.id}; $mode = ${JSON.stringify(mode)};
        $db = \TypedPress\Wp\Runtime::plugin()->connection();
        $path = get_attached_file($id);
        $before = \TypedPress\Wp\Uploads::manifest($id);
        [$objects] = \TypedPress\Wp\Uploads::store()->page(\TypedPress\Wp\Uploads::prefix(), null);
        $beforeKeys = array_column($objects, 'key');
        $regenerate = static function () use ($id): void {
          foreach ([1, 2] as $pass) {
            $meta = wp_generate_attachment_metadata($id, get_attached_file($id));
            wp_update_attachment_metadata($id, $meta);
          }
        };
        $restored = null;
        if ($mode !== 'native') $db->begin();
        try {
          $regenerate();
          if ($mode === 'commit') $db->commit();
          if ($mode === 'rollback') {
            $db->rollback();
            [$objects] = \TypedPress\Wp\Uploads::store()->page(\TypedPress\Wp\Uploads::prefix(), null);
            $afterKeys = array_column($objects, 'key');
            $restored = \TypedPress\Wp\Uploads::manifest($id) === $before
              && array_diff($beforeKeys, $afterKeys) === [] && array_diff($afterKeys, $beforeKeys) === [];
            // Reusing the same paths after rollback must not republish compensated objects.
            $regenerate();
          }
        } catch (Throwable $e) {
          if ($db->inTransaction()) $db->rollback();
          throw $e;
        }
        [$objects] = \TypedPress\Wp\Uploads::store()->page(\TypedPress\Wp\Uploads::prefix(), null);
        $keys = array_column($objects, 'key');
        $missing = [];
        foreach (\TypedPress\Wp\Uploads::manifest($id) as $rel => $entry) {
          if (!in_array($entry['key'], $keys, true)) $missing[] = $rel;
        }
        $meta = wp_get_attachment_metadata($id);
        $thumbnails = [];
        foreach (['medium', 'thumbnail'] as $size) {
          $src = wp_get_attachment_image_src($id, $size);
          $thumbnails[] = ['size' => $size, 'url' => $src[0], 'bytes' => base64_encode(file_get_contents(dirname($path) . '/' . $meta['sizes'][$size]['file']))];
        }
        echo wp_json_encode(['missing' => $missing, 'restored' => $restored, 'thumbnails' => $thumbnails]);
      `));
      assert.deepEqual(regenerated.missing, [], `${mode}: final manifest contains only durable objects`);
      assert.equal(regenerated.restored, mode === "rollback" ? true : null, "rollback retains committed manifests and bytes");
      assert.deepEqual(regenerated.thumbnails.map((row) => row.size), ["medium", "thumbnail"]);
      for (const thumbnail of regenerated.thumbnails) {
        const response = await fetch(thumbnail.url);
        assert.equal(response.status, 200, `${mode}: core ${thumbnail.size} URL serves the regenerated bytes`);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(thumbnail.bytes, "base64"));
      }
    }
    // On a fresh replica, code that reads an attachment's file inside one of the API's GET
    // dispatches that isn't a media item read (here a GET ability run whose callback reads it) gets
    // the bytes, not a scratch path that was never downloaded.
    const viaGet: { inside: string; bytes: number } = JSON.parse(replicaPhp(String.raw`
      wp_set_current_user(1);
      $id = ${attachment.id};
      $seen = null;
      add_filter('rest_pre_dispatch', static function ($result, $server, $request) use ($id, &$seen) {
        if ($request->get_route() === '/typedpress-probe/attached') {
          $path = get_attached_file($id);
          $seen = ['inside' => $request->get_method(), 'bytes' => is_string($path) && is_file($path) ? filesize($path) : 0];
          return new WP_REST_Response(['ok' => true]);
        }
        return $result;
      }, 10, 3);
      \TypedPress\Wp\Runtime::plugin()->app();
      $run = new ReflectionMethod(\TypedPress\Wp\Facade::class, 'run');
      $run->invoke(null, new WP_REST_Request('GET', '/typedpress-probe/attached'));
      echo wp_json_encode($seen);
    `));
    assert.equal(viaGet.inside, "GET");
    assert.ok(viaGet.bytes > 0, "the file was downloaded for the code that reads it");

    // The core image editor scales and restores on B using remote originals and backup sizes.
    const edited: { msg?: string; error?: string } = JSON.parse(replicaPhp(String.raw`
      require_once ABSPATH . 'wp-admin/includes/image.php';
      require_once ABSPATH . 'wp-admin/includes/image-edit.php';
      $_REQUEST = ['do' => 'scale', 'fwidth' => 200, 'fheight' => 100, 'target' => 'all', 'context' => 'edit-attachment'];
      echo wp_json_encode(wp_save_image(${attachment.id}));
    `));
    assert.equal(edited.error, undefined, JSON.stringify(edited));
    const restored: { msg?: string; error?: string } = JSON.parse(replicaPhp(String.raw`
      require_once ABSPATH . 'wp-admin/includes/image.php';
      require_once ABSPATH . 'wp-admin/includes/image-edit.php';
      echo wp_json_encode(wp_restore_image(${attachment.id}));
    `));
    assert.equal(restored.error, undefined, JSON.stringify(restored));
    assert.deepEqual(Buffer.from(await (await fetch((await replica.media.get(attachment.id)).url)).arrayBuffer()), original);
    const credentialFailure: { status: number; code: string; detail: string } = JSON.parse(replicaPhp(String.raw`
      putenv('TP_TEST_UPLOAD_SECRET=invalid-test-credential');
      $tmp = tempnam(sys_get_temp_dir(), 'credential'); file_put_contents($tmp, 'private');
      try { (new \TypedPress\Media\S3(\TypedPress\Wp\Runtime::plugin()->schema->uploads()))->put(\TypedPress\Wp\Uploads::prefix() . 'denied', $tmp, 'text/plain'); }
      catch (\TypedPress\HttpError $e) { echo wp_json_encode(['status' => $e->status, 'code' => $e->errorCode, 'detail' => $e->getMessage()]); }
      finally { unlink($tmp); }
    `));
    assert.deepEqual(credentialFailure, { status: 503, code: 'uploads_unavailable', detail: 'The configured upload storage is unavailable' });
    // Compensation removes a rolled-back private object while keeping committed bytes.
    const rollback: { before: number; after: number; rows: number } = JSON.parse(replicaPhp(String.raw`
      \TypedPress\Wp\Runtime::plugin()->app();
      $db = \TypedPress\Db::instance();
      $store = \TypedPress\Wp\Uploads::store();
      [$before] = $store->page(\TypedPress\Wp\Uploads::prefix(), null);
      $tmp = tempnam(sys_get_temp_dir(), 'rollback'); file_put_contents($tmp, "%PDF-1.4\n%%EOF\n");
      try { $db->transaction(function () use ($tmp) { \TypedPress\Media\Files::upload('decks', $tmp, 'rollback.pdf', null); throw new RuntimeException('rollback'); }); }
      catch (RuntimeException $e) { if ($e->getMessage() !== 'rollback') throw $e; }
      [$after] = $store->page(\TypedPress\Wp\Uploads::prefix(), null);
      global $wpdb;
      echo wp_json_encode(['before' => count($before), 'after' => count($after), 'rows' => (int) $wpdb->get_var("SELECT COUNT(*) FROM {$wpdb->prefix}tp__files WHERE filename = 'rollback.pdf'")]);
    `));
    assert.equal(rollback.after, rollback.before);
    assert.equal(rollback.rows, 0);
    // Upload failure must not succeed onto replica-local disk or leak provider request details.
    compose("stop", "garage");
    await assert.rejects(replica.files.decks.upload(new Blob([bytes]), { filename: "failure.pdf" }), (error: unknown) => error instanceof TypedPressError && error.status === 503 && !error.message.includes("1111111111111111"));
    await assert.rejects(replica.media.upload(new Blob([splitPng()], { type: "image/png" }), { filename: "failure.png" }), (error: unknown) => error instanceof TypedPressError && error.status === 503);
    // Metadata deletion immediately revokes access even when the provider cannot delete yet.
    await replica.files.decks.delete(file.id);
    assert.equal((await fetch(fresh.url)).status, 404);
    await replica.media.delete(image.id);
    assert.equal((await fetch(focal.url)).status, 404);
    compose("up", "-d", "--wait", "garage");
    assert.equal(replicaPhp("echo as_has_scheduled_action('tp_uploads_maintain', [], 'typedpress') ? 'scheduled' : 'missing';"), "scheduled", "cleanup has durable Action Scheduler delivery");
    // Durable maintenance retries failed deletes; a committed editor attachment remains referenced.
    const recovered: { remaining: string[] } = JSON.parse(replicaPhp(String.raw`
      \TypedPress\Wp\Uploads::reconcile(time() + 1);
      [$objects] = \TypedPress\Wp\Uploads::store()->page(\TypedPress\Wp\Uploads::prefix(), null);
      echo wp_json_encode(['remaining' => array_column($objects, 'key')]);
    `));
    assert.equal(recovered.remaining.includes(fileKey), false, "outage-deferred private deletion is retried");
    assert.ok(Object.values(manifest).every((entry) => !recovered.remaining.includes(entry.key)), "deleted media objects are collected");
    assert.equal((await fetch((await replica.media.get(attachment.id)).url)).status, 200, "reconciliation retains referenced objects");
    assert.equal(replicaPhp("echo count(glob(sys_get_temp_dir() . '/typedpress-uploads-*') ?: []);"), "0", "successful requests clean processing scratch data");
    const logs = compose("logs", "--no-color", "replica");
    assert.equal(logs.includes("1111111111111111111111111111111111111111111111111111111111111111"), false, "credentials never enter server logs");
    assert.equal(logs.includes("GK111111111111111111111111"), false, "provider identity never enters server logs");
  });
}
