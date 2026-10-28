// Shared helpers for the WordPress suites: the harness's `up` JSON (written by run.sh to
// tests/wp/.harness.json), WP-CLI and SQL through harness.sh, and raw HTTP against /zero/v1 and
// core /wp/v2.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Role = "admin" | "editor" | "author" | "subscriber";
interface Harness {
  url: string;
  wp: string;
  scf: string;
  plugin: string;
  users: Record<Role, { id: number; appPassword: string }>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const harness: Harness = JSON.parse(readFileSync(process.env.ZERO_WP_HARNESS ?? join(here, ".harness.json"), "utf8"));
export const api = `${harness.url}/wp-json/zero/v1`;
export const core = `${harness.url}/wp-json/wp/v2`;

export function auth(role: Role): Record<string, string> {
  return { Authorization: "Basic " + btoa(`${role}:${harness.users[role].appPassword}`) };
}

/** WP-CLI inside the stack; returns trimmed stdout. */
export function wp(...args: string[]): string {
  return execFileSync(join(here, "harness.sh"), ["wp", ...args], { encoding: "utf8" }).trim();
}

/** WP-CLI that may exit non-zero; returns stdout either way (`wp zero` prints {error} and exits 1). */
export function wpTry(...args: string[]): string {
  try {
    return wp(...args);
  } catch (e: any) {
    return String(e.stdout).trim();
  }
}

/** `wp zero <cmd> ...`: Zero's trusted CLI on WordPress; returns `data`. */
export function zero(...args: string[]): any {
  const out = JSON.parse(wp("zero", ...args));
  assert.ok("data" in out, JSON.stringify(out));
  return out.data;
}

/** Rows of a MariaDB query as objects (harness `sql` prints a TSV with a header line). */
export function sql(query: string): Record<string, string>[] {
  const out = execFileSync(join(here, "harness.sh"), ["sql", query], { encoding: "utf8" }).trimEnd();
  if (out === "") return [];
  const [head, ...lines] = out.split("\n");
  const cols = head.split("\t");
  return lines.map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
}

export interface Res {
  status: number;
  type: string;
  json: any;
}

export async function http(method: string, url: string, opts: { as?: Role; body?: unknown; form?: FormData } = {}): Promise<Res> {
  const headers: Record<string, string> = opts.as ? auth(opts.as) : {};
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${url} → ${res.status}, not JSON: ${text.slice(0, 500)}`);
  }
  return { status: res.status, type: res.headers.get("content-type") ?? "", json };
}

/** A 2xx Zero call; returns `data`. */
export async function ok(method: string, path: string, opts: Parameters<typeof http>[2] = {}): Promise<any> {
  const r = await http(method, api + path, opts);
  assert.ok(r.status < 300, `${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data;
}

/** A Zero problem document with the expected status/code/pointer; returns it. */
export async function problem(method: string, path: string, opts: Parameters<typeof http>[2], expect: { status: number; code: string; pointer: string | undefined }) {
  const r = await http(method, api + path, opts);
  assert.match(r.type, /^application\/problem\+json/);
  assert.deepEqual({ status: r.status, code: r.json.code, pointer: r.json.pointer }, expect, r.json.detail);
  return r.json;
}

export const qs = (o: Record<string, unknown>) =>
  "?" + new URLSearchParams(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])).toString();

/** Unique per process so suites can share one WordPress. */
export const run = Date.now().toString(36);
