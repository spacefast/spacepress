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
"""
assert "  routes: {\n" in text
text = text.replace("  routes: {\n", "  routes: {\n" + probe, 1)
open(path, "w").write(text)
