// A 0.3.0 app's HTTP routes: `routes` with `route()`, served outside /wp-json. Captured by that
// compiler (tests/fixtures/zero-0.3/README.md); do not edit by hand.
import { table, text, defineConfig, route, env, db } from "zero";

export const notes = table({
  title: text().notNull(),
  status: text({ enum: ["draft", "published"] }).notNull().default("draft"),
}, { access: { read: (ctx) => ctx.user !== null ? true : { status: "published" }, create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({
  name: "routes",
  tables: { notes },
  routes: {
    feed: route({ method: "GET", path: "/api/feed.json", access: "anyone", async handler(req) {
      const limit = Number(req.query.get("limit") ?? "20");
      const rows = await db.query.notes.findMany({ orderBy: { id: "asc" }, limit });
      return { headers: { "content-type": "application/feed+json" }, body: JSON.stringify(rows.map((n) => n.title)) };
    } }),
    note: route({ method: "GET", path: "/api/notes/:id", access: "anyone", handler(req) { return { body: "get " + req.params.id }; } }),
    latest: route({ method: "GET", path: "/api/notes/latest", access: "anyone", handler() { return { body: "latest" }; } }),
    rename: route({ method: "POST", path: "/api/notes/:id", access: "editor", handler(req) { return { status: 201, body: "post " + req.params.id }; } }),
    files: route({ method: "GET", path: "/files/*path", access: (ctx) => ctx.user !== null, handler(req) { return { body: "file " + req.params.path }; } }),
    hook: route({ method: "POST", path: "/webhooks/in", signature: { secret: env("ROUTES_SECRET"), header: "x-signature", scheme: "zero" }, handler(req) {
      return { status: 202, body: "signed " + req.body };
    } }),
  },
});
