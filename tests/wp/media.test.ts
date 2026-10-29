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

test("an upload returns the configured sizes, made by core, honouring the focal point", async () => {
  const r = await upload(splitPng(), "split.png", "image/png");
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const img = r.json.data;
  assert.equal(img.focal, null);
  assert.deepEqual(
    { card: [img.sizes.card.width, img.sizes.card.height], wide: [img.sizes.wide.width, img.sizes.wide.height] },
    { card: [120, 120], wide: [200, 100] },
  );
  for (const size of ["card", "wide"]) {
    assert.ok(img.sizes[size].url.startsWith(`${harness.url}/wp-content/uploads/`), img.sizes[size].url);
    const res = await fetch(img.sizes[size].url);
    assert.equal(res.status, 200, `${size} file is served`);
  }
  const centred = sizeOnDisk(img.id, "zero_card");
  const wide = sizeOnDisk(img.id, "zero_wide");
  assert.deepEqual([centred.w, centred.h, centred.file], [120, 120, img.sizes.card.url.split("/").pop()]);

  await problem("PATCH", `/media/${img.id}`, { as: "author", body: { focal: { x: 0, y: 0.5 } } }, { status: 403, code: "forbidden", pointer: undefined });
  await problem("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: -1, y: 0 } } }, { status: 422, code: "invalid_input", pointer: "/focal/x" });
  const left = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 0, y: 0.5 }, alt: "Red side" } });
  assert.deepEqual([left.focal, left.alt, left.sizes.card], [{ x: 0, y: 0.5 }, "Red side", img.sizes.card]);
  const leftCard = sizeOnDisk(img.id, "zero_card");
  assert.notEqual(leftCard.sha, centred.sha, "changing focal regenerates the cover crop");
  assert.deepEqual(leftCard.rgb, [255, 0], "the left focal crop is red");
  assert.deepEqual([sizeOnDisk(img.id, "zero_wide").w, sizeOnDisk(img.id, "zero_wide").h], [wide.w, wide.h], "inside sizes keep their shape");

  const right = await ok("PATCH", `/media/${img.id}`, { as: "editor", body: { focal: { x: 1, y: 0.5 } } });
  assert.deepEqual(right.focal, { x: 1, y: 0.5 });
  assert.deepEqual(sizeOnDisk(img.id, "zero_card").rgb, [0, 255], "the right focal crop is blue");
  assert.equal(wp("post", "meta", "get", String(img.id), "_zero_focal"), '{"x":1,"y":0.5}');
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

  const doc = await upload(new TextEncoder().encode("plain text"), "notes.txt", "text/plain");
  assert.equal(doc.status, 201, JSON.stringify(doc.json));
  assert.deepEqual([doc.json.data.sizes, doc.json.data.focal], [{}, null]);
});

test("without Jetpack the Image CDN adapter is inert", async () => {
  const schema = await ok("GET", "/_schema");
  assert.equal(schema.runtime.wp.imageCdn, false);
});
