"""Adds probe routes to a copy of examples/full-site for tests/wp/hosted-pages-run.sh.

Each probe is a `first/app/<path>/route.ts` file beside the example's own routes.
"""
import os
import sys

project = sys.argv[1]
WHO = """export const access = "anyone";
const who = (ctx: HookCtx) => ({ body: ctx.user === null ? "anonymous" : "user " + String(ctx.user.id) });
export function GET(_req: RouteRequest, ctx: HookCtx) {
  return who(ctx);
}
export function POST(_req: RouteRequest, ctx: HookCtx) {
  return who(ctx);
}
"""
probes = {
    # Undefined optional fields take the documented defaults.
    "api/probe/defaults": """export const access = "anyone";
export function GET() {
  return { status: undefined, headers: { "x-probe": "yes" }, body: undefined };
}
""",
    # once() keyed to the request body.
    "api/probe/once": """export const access = "anyone";
export async function POST(req: RouteRequest) {
  const result = await once("probe", async () => ({ seen: req.body }));
  return { body: result.seen };
}
""",
    # Specificity: parameter folders lose to the literal ones (`api/probe/feed.json` and the
    # example's `api/feed.json`), segment by segment from the left.
    "api/[kind]": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { body: "param " + req.params["kind"] };
}
""",
    "api/[kind]/[id]": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { body: "params " + req.params["kind"] + " " + req.params["id"] };
}
""",
    "api/probe/[id]": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { body: "probe param " + req.params["id"] };
}
""",
    "api/probe/feed.json": """export const access = "anyone";
export function GET() {
  return { body: "probe literal" };
}
""",
    # Catch-all: `[...path]` takes one or more decoded segments, below literals and params.
    "files/[...path]": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { body: "rest " + req.params["path"] };
}
""",
    "files/[bucket]/latest": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { body: "latest " + req.params["bucket"] };
}
""",
    "files/readme.txt": """export const access = "anyone";
export function GET() {
  return { body: "readme" };
}
""",
    # Who the route sees: per channel, as WordPress REST decides it.
    "api/probe-who": WHO,
    # The query as URLSearchParams reads it.
    "api/probe-query": """export const access = "anyone";
export function GET(req: RouteRequest) {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify({
    dotted: req.query.get("a.b"), underscored: req.query.get("a_b"),
    brackets: req.query.getAll("x[]"), first: req.query.get("k"), every: req.query.getAll("k"),
    has: req.query.has("k"), missing: req.query.get("missing"), entries: req.query.entries(),
  }) };
}
""",
}
for path, body in probes.items():
    folder = os.path.join(project, "first", "app", *path.split("/"))
    os.makedirs(folder, exist_ok=False)
    with open(os.path.join(folder, "route.ts"), "w") as f:
        f.write('import { once, type HookCtx, type RouteRequest } from "first";\n' + body)
