// Image sizes, focal point and private files on real WordPress (phase 2 §7.2). The app fragment
// (app/lanes/media.ts) configures `card` (120x120 cover) and `wide` (200 wide, inside).
import { test } from "node:test";
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

  await problem("PATCH", `/media/${img.id}`, { as: "author", body: { focal: { x: 0, y: 0.5 } } }, { status: 403, code: "forbidden", pointer: undefined });
  await problem("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: -1, y: 0 } } }, { status: 422, code: "invalid_input", pointer: "/focal/x" });
  const left = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0.5 }, alt: "Red side" } });
  assert.deepEqual([left.focal, left.alt, [left.sizes.card.width, left.sizes.card.height]], [{ x: 0, y: 0.5 }, "Red side", [120, 120]]);
  const leftCard = sizeOnDisk(img.id, "zero_card");
  assert.notEqual(leftCard.sha, centred.sha, "changing focal regenerates the cover crop (different bytes)");
  assert.deepEqual(leftCard.rgb, [255, 0], "the left focal crop is red");
  assert.equal(left.sizes.card.url.split("/").pop(), leftCard.file);
  assert.equal((await fetch(img.sizes.card.url)).status, 404, "the previous crop is removed after commit");
  assert.deepEqual(sizeOnDisk(img.id, "thumbnail"), theme, "the theme's same-shape crop is untouched");
  assert.deepEqual(sizeOnDisk(img.id, "zero_wide"), wide, "inside sizes are not regenerated");

  const right = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 1, y: 0.5 } } });
  assert.deepEqual(sizeOnDisk(img.id, "zero_card").rgb, [0, 255], "the right focal crop is blue");
  assert.equal(wp("post", "meta", "get", String(img.id), "_zero_focal"), '{"x":1,"y":0.5}');
  assert.equal(right.sizes.card.url, (await ok("GET", `/media/${img.id}`)).sizes.card.url);
});

test("a crop that fails to render rolls the focal change back, and the same PATCH succeeds on retry", async () => {
  const img = await uploadSplit();
  const before = sizeOnDisk(img.id, "zero_card");
  // A must-use plugin that makes every image save fail while its flag option is set.
  wp("eval", `
    wp_mkdir_p(WPMU_PLUGIN_DIR);
    file_put_contents(WPMU_PLUGIN_DIR . '/zero-test-editor-fails.php', "<?php\nadd_filter('wp_image_editors', fn (\\$e) => get_option('zero_test_editor_fails') ? [] : \\$e);\n");
  `);
  wp("option", "update", "zero_test_editor_fails", "1");
  try {
    const failed = await http("PATCH", `${api}/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
    assert.equal(failed.status, 500, JSON.stringify(failed.json));
    assert.equal((await ok("GET", `/media/${img.id}`)).focal, null, "the focal point did not commit");
    assert.deepEqual(sizeOnDisk(img.id, "zero_card"), before, "the previous crop is still in place");
  } finally {
    wp("option", "delete", "zero_test_editor_fails");
    wp("eval", "unlink(WPMU_PLUGIN_DIR . '/zero-test-editor-fails.php');");
  }
  const retried = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0 } } });
  assert.deepEqual(retried.focal, { x: 0, y: 0 });
  assert.deepEqual(sizeOnDisk(img.id, "zero_card").rgb, [255, 0]);
});

test("core uploads outside Zero get the zero_* sizes; non-images get none", async () => {
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

  const doc = await upload(new TextEncoder().encode("plain text"), "notes.txt", "text/plain");
  assert.equal(doc.status, 201, JSON.stringify(doc.json));
  assert.deepEqual([doc.json.data.sizes, doc.json.data.focal], [{}, null]);
});

test("without Jetpack the Image CDN adapter is inert", async () => {
  const schema = await ok("GET", "/_schema");
  assert.equal(schema.runtime.wp.imageCdn, false);
});
