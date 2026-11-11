/**
 * Route discovery: `pages/**` files to canonical routes.
 *
 * Only `page.tsx` creates a route; `layout.tsx` wraps every page below it and
 * `not-found.tsx` at the root supplies the body of a claimed 404. Everything
 * else under `pages/` is a colocated module. `(group)` directories group
 * without a URL segment; `[param]` binds one segment and must be the last
 * one, on an item route. Shapes this release cannot serve honestly (catch-all,
 * optional catch-all, parallel and intercepting routes, `template.tsx`,
 * content-owned `page.md`/`page.blocks.html`) are refused, not approximated.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import type { PagesDiagnostic } from "./diagnostics.ts";

export interface RouteFile {
  /** Canonical pattern: leading `/`, no trailing slash except `/`, `[]` for the dynamic segment. */
  pattern: string;
  /** The dynamic segment's name, for an item route. */
  param: string | null;
  /** Absolute path of `page.tsx`. */
  file: string;
  /** Layouts from the root down, absolute paths. */
  layouts: string[];
  /** Static path segments, in order (the dynamic one excluded). */
  segments: string[];
}

export interface Discovery {
  routes: RouteFile[];
  notFound: string | null;
  diagnostics: PagesDiagnostic[];
}

/** First segments WordPress or First already own. A page there would shadow core behavior. */
const RESERVED_FIRST = new Set([
  "wp-admin", "wp-content", "wp-includes", "wp-json", "wp-login.php", "wp-signup.php", "wp-cron.php", "xmlrpc.php",
  "wp-sitemap.xml", "feed", "comments", "search", "author", "category", "tag", "page", "embed", "trackback",
  "robots.txt", "favicon.ico", "first-admin", "auth",
]);

const LITERAL = /^[a-z0-9](?:[a-z0-9._~-]*[a-z0-9_~-])?$/;
const PARAM = /^\[([a-z][a-zA-Z0-9_]*)\]$/;
const GROUP = /^\(([a-z0-9][a-z0-9-]*)\)$/;
const REFUSED_FILES: Record<string, string> = {
  "template.tsx": "template.tsx is not supported; put shared structure in layout.tsx.",
  "page.md": "Content-owned pages (page.md) are not in this release; write page.tsx, or keep the page as an ordinary WordPress Page.",
  "page.blocks.html": "Content-owned pages (page.blocks.html) are not in this release; write page.tsx, or keep the page as an ordinary WordPress Page.",
  "page.ts": "A page is page.tsx.",
  "page.jsx": "A page is page.tsx.",
  "page.js": "A page is page.tsx.",
  "layout.ts": "A layout is layout.tsx.",
  "layout.jsx": "A layout is layout.tsx.",
};

function at(file: string, message: string, code: PagesDiagnostic["code"], hint?: string): PagesDiagnostic {
  const diagnostic: PagesDiagnostic = { code, severity: "error", message, loc: { file, line: 1, column: 1 } };
  if (hint !== undefined) diagnostic.hint = hint;
  return diagnostic;
}

interface Segment {
  kind: "literal" | "param" | "group";
  value: string;
}

function segment(name: string, dir: string, diagnostics: PagesDiagnostic[]): Segment | null {
  const nfc = name.normalize("NFC");
  const group = GROUP.exec(nfc);
  if (group) return { kind: "group", value: group[1]! };
  if (/^\[\[?\.\.\./.test(nfc)) {
    diagnostics.push(at(dir, `Catch-all segment "${name}" is not supported; each route matches a fixed number of segments.`, "route_shape"));
    return null;
  }
  if (nfc.startsWith("@")) {
    diagnostics.push(at(dir, `Parallel route slot "${name}" is not supported.`, "route_shape"));
    return null;
  }
  if (/^\(\.{1,3}\)/.test(nfc) || /^\(\.\.\)/.test(nfc)) {
    diagnostics.push(at(dir, `Intercepting route "${name}" is not supported.`, "route_shape"));
    return null;
  }
  const param = PARAM.exec(nfc);
  if (param) return { kind: "param", value: param[1]! };
  if (nfc === "." || nfc === ".." || nfc.includes("%") || /[[\]()]/.test(nfc) || !LITERAL.test(nfc)) {
    diagnostics.push(at(
      dir,
      `"${name}" is not a valid URL segment.`,
      "route_shape",
      "Use lowercase letters, digits and . _ ~ - (not leading or trailing dots), (group) or [param].",
    ));
    return null;
  }
  return { kind: "literal", value: nfc };
}

/** Walk `pages/`, depth-first and sorted, so diagnostics and output are deterministic. */
export async function discover(pagesDir: string): Promise<Discovery> {
  const diagnostics: PagesDiagnostic[] = [];
  const routes: RouteFile[] = [];
  let notFound: string | null = null;

  async function walk(dir: string, segments: Segment[], layouts: string[]): Promise<void> {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const here = [...layouts];
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    if (names.has("layout.tsx")) here.push(path.join(dir, "layout.tsx"));
    for (const name of names) {
      const refused = Object.hasOwn(REFUSED_FILES, name) ? REFUSED_FILES[name] : undefined;
      if (refused !== undefined) diagnostics.push(at(path.join(dir, name), refused, "route_shape"));
    }
    if (names.has("not-found.tsx")) {
      if (segments.length === 0) notFound = path.join(dir, "not-found.tsx");
      else diagnostics.push(at(path.join(dir, "not-found.tsx"), "not-found.tsx is supported only at the root of pages/.", "route_shape"));
    }
    if (names.has("page.tsx")) {
      const file = path.join(dir, "page.tsx");
      const visible = segments.filter((s) => s.kind !== "group");
      const params = visible.filter((s) => s.kind === "param");
      const dynamicIndex = visible.findIndex((s) => s.kind === "param");
      if (params.length > 1 || (dynamicIndex !== -1 && dynamicIndex !== visible.length - 1)) {
        diagnostics.push(at(file, "An item route has one [param] segment, and it is the last one.", "route_shape", "Move the page so the [param] directory is the deepest segment."));
      } else if (visible[0]?.kind === "literal" && RESERVED_FIRST.has(visible[0].value)) {
        diagnostics.push(at(file, `/${visible[0].value} belongs to WordPress or First; a page cannot claim it.`, "reserved_path"));
      } else {
        const pattern = `/${visible.map((s) => (s.kind === "param" ? "[]" : s.value)).join("/")}`;
        routes.push({
          pattern: pattern === "/" ? "/" : pattern.replace(/\/$/, ""),
          param: params[0]?.value ?? null,
          file,
          layouts: here,
          segments: visible.filter((s) => s.kind === "literal").map((s) => s.value),
        });
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      // `_private` directories hold colocated modules and never route.
      if (entry.name.startsWith("_")) continue;
      const next = segment(entry.name, path.join(dir, entry.name), diagnostics);
      if (next === null) continue;
      await walk(path.join(dir, entry.name), [...segments, next], here);
    }
  }

  await walk(pagesDir, [], []);
  diagnostics.push(...collisions(routes));
  return { routes, notFound, diagnostics };
}

/** Two pages with one URL shape are an error, across groups and parameter names. */
function collisions(routes: readonly RouteFile[]): PagesDiagnostic[] {
  const seen = new Map<string, RouteFile>();
  const out: PagesDiagnostic[] = [];
  for (const route of routes) {
    const other = seen.get(route.pattern);
    if (other !== undefined) {
      out.push(at(route.file, `${displayPattern(route)} is also served by ${other.file}; two pages cannot share a URL.`, "route_collision"));
      continue;
    }
    seen.set(route.pattern, route);
  }
  return out;
}

export function displayPattern(route: Pick<RouteFile, "pattern" | "param">): string {
  return route.param === null ? route.pattern : route.pattern.replace("[]", `[${route.param}]`);
}

/**
 * Static routes that sit beside an item route's `[param]`: `/notes/featured` next
 * to `/notes/[slug]`. The static page wins (its rewrite comes first), and the
 * collection must never accept that slug.
 */
export function reservedSiblings(routes: readonly RouteFile[]): Map<RouteFile, string[]> {
  const out = new Map<RouteFile, string[]>();
  for (const dynamic of routes) {
    if (dynamic.param === null) continue;
    const parent = dynamic.pattern.slice(0, dynamic.pattern.lastIndexOf("/"));
    const reserved = routes
      .filter((route) => route.param === null && route.pattern.startsWith(`${parent}/`) && !route.pattern.slice(parent.length + 1).includes("/"))
      .map((route) => route.pattern.slice(parent.length + 1));
    out.set(dynamic, reserved);
  }
  return out;
}

/** `p:` and the lowercase hex of the UTF-8 pattern, or `u:` and an explicit ID. */
export function routeId(pattern: string, explicit: string | null): string {
  return explicit !== null ? `u:${explicit}` : `p:${Buffer.from(pattern, "utf8").toString("hex")}`;
}

export const EXPLICIT_ID = /^[a-z][a-z0-9._-]{0,63}$/;

/** SHA-256 of the length-prefixed app ID and full route ID: the key every generated name derives from. */
export function routeKey(app: string, id: string): string {
  const prefix = (value: string): Buffer => {
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
  };
  return createHash("sha256").update(Buffer.concat([prefix(app), prefix(id)])).digest("hex");
}
