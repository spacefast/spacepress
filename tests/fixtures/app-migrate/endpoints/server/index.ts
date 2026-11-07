import { capsule, empty, endpoint, json, mutation, redirect, string, table, text, type EndpointRequest } from "@spacefast/zero/server";

const LIMIT = 3;

// Every 0.8 endpoint result shape, the request API, and both execution modes.
export default capsule({
  name: "Legacy Endpoints",
  schema: { notes: table({ body: string(), tag: string().default("") }).index("by_tag", ["tag"]) },
  mutations: {
    add: mutation(async (ctx, body: string) => ctx.db.notes.insert({ body })),
  },
  endpoints: {
    ping: endpoint({ method: "GET", path: "/api/ping" }, () => text("ok")),
    count: endpoint({ method: "GET", path: "/api/notes/count" }, async (ctx) =>
      json({ count: (await ctx.db.notes.withIndex("by_creation").collect()).length })),
    note: endpoint({ method: "GET", path: "/api/notes/:id" }, async (ctx, request: EndpointRequest) => {
      const note = await ctx.db.notes.get(request.params.id);
      if (!note) return json({ error: "missing" }, { status: 404 });
      return note;
    }),
    search: endpoint({ method: "POST", path: "/api/search", readOnly: true }, async (ctx, request) => {
      const filter = (await request.json()) as { tag?: string };
      const rows = await ctx.db.notes.withIndex("by_tag", (r) => r.eq("tag", filter.tag ?? "")).take(LIMIT);
      return rows.map((row) => row.body);
    }),
    create: endpoint({ method: "PUT", path: "/api/notes" }, async (ctx, request) => {
      const body = await request.text();
      if (!body) return text("empty body", { status: 400, headers: { "X-Reason": "empty" } });
      const note = await ctx.db.notes.insert({ body, tag: request.query.get("tag") ?? "" });
      return json(note, { status: 201, headers: { "Cache-Control": "no-store" } });
    }),
    remove: endpoint({ method: "DELETE", path: "/api/notes/:id" }, async (ctx, request) => {
      if (request.headers.get("X-Confirm") !== "yes") return empty({ status: 412 });
      await ctx.db.notes.delete(request.params.id);
    }),
    home: endpoint({ method: "GET", path: "/go/home" }, (_ctx, request) =>
      redirect("/?from=" + (request.query.has("ref") ? "ref" : "direct"), { status: 303 })),
    total: endpoint({ method: "GET", path: "/api/total" }, async (ctx) => (await ctx.db.notes.withIndex("by_creation").count())),
  },
});
