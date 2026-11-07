import { capsule, empty, endpoint, json, mutation, redirect, string, table, text, type EndpointRequest } from "@spacefast/zero/server";

const LIMIT = 3;

// Every 0.8 endpoint result shape, the request API, and both execution modes.
export default capsule({
  name: "Legacy Endpoints",
  schema: {
    notes: table({ body: string(), tag: string().default("") }).index("by_tag", ["tag"]),
    // Owned by the 0.8 caller's identity (`--users`): its anonymous write route must 401 first.
    marks: table({ owner: string(), label: string() }),
  },
  mutations: {
    add: mutation(async (ctx, body: string) => ctx.db.notes.insert({ body })),
  },
  endpoints: {
    ping: endpoint({ method: "GET", path: "/api/ping" }, () => text("ok")),
    banner: endpoint({ method: "GET", path: "/api/banner" }, (ctx) => {
      ctx.log.info("banner", { served: true });
      return text(ctx.env.LEGACY_BANNER ?? "unset");
    }),
    // Declared before the literal /api/notes/count: v2 still prefers the literal, as 0.8 did.
    note: endpoint({ method: "GET", path: "/api/notes/:id" }, async (ctx, request: EndpointRequest) => {
      const note = await ctx.db.notes.get(request.params.id);
      if (!note) return json({ error: "missing" }, { status: 404 });
      return note;
    }),
    count: endpoint({ method: "GET", path: "/api/notes/count" }, async (ctx) =>
      json({ count: (await ctx.db.notes.withIndex("by_creation").collect()).length })),
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
    tags: endpoint({ method: "GET", path: "/api/tags" }, (_ctx, request) =>
      json({ first: request.query.get("t"), all: request.query.getAll("t"), dotted: request.query.get("user.id") })),
    // 0.8's catch-all: a final :splat, read as params.splat; it also answers /api/files itself.
    file: endpoint({ method: "GET", path: "/api/files/:splat" }, (_ctx, request) => text("file " + request.params.splat)),
    mark: endpoint({ method: "POST", path: "/api/marks" }, async (ctx, request) => {
      await ctx.db.marks.insert({ owner: ctx.auth.userId, label: await request.text() });
      return text("marked", { status: 201 });
    }),
    total: endpoint({ method: "GET", path: "/api/total" }, async (ctx) => (await ctx.db.notes.withIndex("by_creation").count())),
  },
});
