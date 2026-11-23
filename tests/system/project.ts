// The site project as a user handles it: a working copy of examples/site, the `spacepress` binary that
// tests/system/run.sh built, the additive upgrade a later release of the app makes, and `spacepress doctor`.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Role, UpgradedClient } from "./journey.ts";

export const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const work = join(repo, "tests/system/.work");
const spBin = join(process.env.CARGO_TARGET_DIR ?? join(repo, "target"), "debug/spacepress");

/** A fresh copy of examples/site (config, committed migrations and client; no build output). */
export function copySite(dest: string): string {
  rmSync(dest, { recursive: true, force: true });
  cpSync(join(repo, "examples/site"), dest, { recursive: true, filter: (src) => !src.includes("/.sp") });
  return dest;
}

/** The next release of the app: one new post field and one new comment column, both additive. */
export function upgrade(project: string): void {
  const file = join(project, "spacepress.config.ts");
  let src = readFileSync(file, "utf8");
  const add = (anchor: string, line: string) => {
    assert.ok(src.includes(anchor), `upgrade anchor missing: ${anchor}`);
    src = src.replace(anchor, anchor + line);
  };
  add("  featured: boolean().default(false),\n", "  readingMinutes: integer().min(1).max(120).optional(),\n");
  add("  approved: boolean().default(false),\n", "  pinned: boolean().default(false),\n");
  writeFileSync(file, src);
}

/** `spacepress sync <dir> --only posts --no-commit --json` with the given site credentials; the result's data. */
export function sync(dir: string, site: string, appPassword: string): { applied: number; conflicts: unknown[]; refused: string[] } {
  const r = spawnSync(spBin, ["sync", dir, "--only", "posts", "--no-commit", "--json", "--site", site], { encoding: "utf8", env: { ...process.env, SP_APP_PASSWORD: appPassword } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout).data;
}

export function first(...args: string[]): string {
  return execFileSync(spBin, args, { encoding: "utf8", env: { ...process.env } });
}

export interface Doctor {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

/** `spacepress doctor ... --json`: the diagnosis, after checking it exits 1 exactly when a check fails. */
export function doctor(...args: string[]): Doctor {
  const r = spawnSync(spBin, ["doctor", ...args, "--json"], { encoding: "utf8" });
  const diagnosis: Doctor = JSON.parse(r.stdout).data;
  assert.equal(diagnosis.ok, diagnosis.checks.every((c) => c.ok));
  assert.equal(r.status, diagnosis.ok ? 0 : 1, r.stderr);
  return diagnosis;
}

export const failing = (d: Doctor) => d.checks.filter((c) => !c.ok).map((c) => c.name);

/** A 400×200 PNG: red left half, blue right half, so a focal crop's colour shows where it was taken. */
export function splitPng(): Uint8Array {
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

/**
 * Width, height and the centre pixel's colour of a served PNG, decoded here so the journey judges a
 * crop by the bytes a browser gets, on either target. Handles what GD and Imagick write for these
 * crops: non-interlaced 8-bit RGB/RGBA and 1/2/4/8-bit palette images, with any row filter.
 */
export function pngCentre(png: Uint8Array): { width: number; height: number; colour: "red" | "blue" | "other" } {
  const buf = Buffer.from(png);
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), depth = buf[24], type = buf[25];
  const samples = type === 6 ? 4 : type === 2 ? 3 : type === 3 ? 1 : 0;
  assert.ok(samples > 0 && buf[28] === 0 && (type === 3 ? [1, 2, 4, 8].includes(depth) : depth === 8), `unsupported PNG (depth ${depth}, type ${type})`);
  const idat: Buffer[] = [];
  let palette = Buffer.alloc(0);
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString("latin1", at + 4, at + 8);
    if (kind === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + len));
    if (kind === "PLTE") palette = buf.subarray(at + 8, at + 8 + len);
    at += len + 12;
  }
  const data = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (samples * depth) >> 3); // bytes per pixel for filtering (≥ 1)
  const stride = Math.ceil((width * samples * depth) / 8);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const line = Buffer.from(data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    const prev = rows[y - 1] ?? Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const add = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      line[i] = (line[i] + add) & 0xff;
    }
    rows.push(line);
  }
  const row = rows[height >> 1], x = width >> 1;
  let px: Buffer;
  if (type === 3) {
    const bit = x * depth;
    const index = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    px = palette.subarray(index * 3, index * 3 + 3);
  } else {
    px = row.subarray(x * samples, x * samples + 3);
  }
  const colour = px[0] > 200 && px[2] < 60 ? "red" : px[2] > 200 && px[0] < 60 ? "blue" : "other";
  return { width, height, colour };
}

export interface Delivery {
  event: string;
  data: { row: Record<string, unknown> };
  /** The receiver checked `spacepress-signature` against the secret: t=<unix>,v1=hex(HMAC-SHA256(secret, "t.body")). */
  verified: boolean;
}

/**
 * The site's moderation tool: an HTTP endpoint on this host that records each signed webhook POSTed
 * to /hook. It answers 500 to the first one so every journey also proves the retry. It runs in its own
 * process (the tests drive WP-CLI and PHP synchronously, which would starve an in-process server)
 * and listens on all interfaces, since WordPress reaches it from its container via host.docker.internal.
 */
export async function receiver(secret: string) {
  const log = join(work, `deliveries-${process.pid}.jsonl`);
  rmSync(log, { force: true });
  mkdirSync(work, { recursive: true });
  const child = spawn(process.execPath, ["-e", `
    const { appendFileSync } = require("node:fs");
    let failNext = true;
    const server = require("node:http").createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (req.method !== "POST" || req.url !== "/hook") { res.writeHead(404).end(); return; }
        if (failNext) { failNext = false; res.writeHead(500).end("try again"); return; }
        appendFileSync(${JSON.stringify(log)}, JSON.stringify({ signature: req.headers["spacepress-signature"] ?? "", body }) + "\\n");
        res.writeHead(200).end("ok");
      });
    });
    server.listen(0, "0.0.0.0", () => console.log(server.address().port));
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const [chunk] = await once(child.stdout!, "data");
  const verify = (signature: string, body: string) => {
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature) ?? [];
    return v1 !== undefined && v1 === createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  };
  return {
    port: Number(String(chunk).trim()),
    deliveries: (): Delivery[] => existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").map((line) => {
        const { signature, body } = JSON.parse(line);
        const event = JSON.parse(body);
        return { event: event.event, data: event.data, verified: verify(signature, body) };
      })
      : [],
    close: () => child.kill(),
  };
}

/** The typed client a rebuilt project generated, loaded the way a frontend imports it. */
export async function clientOf(project: string, make: (createClient: (o: object) => unknown, role: Role) => unknown) {
  const mod = await import(pathToFileURL(join(project, "sp/_generated/client/index.ts")).href);
  return (role: Role) => make(mod.createClient, role) as UpgradedClient;
}
