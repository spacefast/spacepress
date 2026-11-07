"""Adds probe routes to a copy of examples/full-site for tests/wp/hosted-pages-run.sh."""
import sys

path = sys.argv[1]
text = open(path).read()
text = text.replace("import { collection,", "import { once, collection,", 1)
probe = """    // Probes: undefined optional fields, and once() keyed to the request body.
    probeDefaults: route({ method: "GET", path: "/api/probe/defaults", access: "anyone", handler() {
      return { status: undefined, headers: { "x-probe": "yes" }, body: undefined };
    } }),
    probeOnce: route({ method: "POST", path: "/api/probe/once", access: "anyone", async handler(req) {
      const result = await once("probe", async () => ({ seen: req.body }));
      return { body: result.seen };
    } }),
    // Specificity: declared first, a parameter route must still lose to the literal routes below
    // (`/api/probe/feed.json` and the example's `/api/feed.json`).
    probeAny: route({ method: "GET", path: "/api/:id", access: "anyone", handler(req) {
      return { body: "param " + req.params["id"] };
    } }),
    probeDeepAny: route({ method: "GET", path: "/api/:kind/:id", access: "anyone", handler(req) {
      return { body: "params " + req.params["kind"] + " " + req.params["id"] };
    } }),
    probeLiteralLast: route({ method: "GET", path: "/api/probe/:id", access: "anyone", handler(req) {
      return { body: "probe param " + req.params["id"] };
    } }),
    probeLiteral: route({ method: "GET", path: "/api/probe/feed.json", access: "anyone", handler() {
      return { body: "probe literal" };
    } }),
    // Who the route sees: per channel, as WordPress REST decides it.
    probeWhoGet: route({ method: "GET", path: "/api/probe-who", access: "anyone", handler(_req, ctx) {
      return { body: ctx.user === null ? "anonymous" : "user " + String(ctx.user.id) };
    } }),
    probeWhoPost: route({ method: "POST", path: "/api/probe-who", access: "anyone", handler(_req, ctx) {
      return { body: ctx.user === null ? "anonymous" : "user " + String(ctx.user.id) };
    } }),
    // The query as URLSearchParams reads it.
    probeQuery: route({ method: "GET", path: "/api/probe-query", access: "anyone", handler(req) {
      return { headers: { "content-type": "application/json" }, body: JSON.stringify({
        dotted: req.query.get("a.b"), underscored: req.query.get("a_b"),
        brackets: req.query.getAll("x[]"), first: req.query.get("k"), every: req.query.getAll("k"),
        has: req.query.has("k"), missing: req.query.get("missing"), entries: req.query.entries(),
      }) };
    } }),
"""
assert "  routes: {\n" in text
text = text.replace("  routes: {\n", "  routes: {\n" + probe, 1)
open(path, "w").write(text)
