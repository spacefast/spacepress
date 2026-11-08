import { capsule, endpoint, json, mutation, query, string, table, text } from "@spacefast/zero/server";

// Helpers that take the context or the endpoint request, as 0.8 apps wrote them: typed loosely,
// called from handlers and from each other, with the context aliased and destructured on the way.
type Ctx = { db: any; auth: any; env: Record<string, string | undefined> };
type Req = { url: string; headers: { get(name: string): string | null }; json(): Promise<unknown> };

async function owner(ctx: Ctx): Promise<string> {
  return ctx.auth.isSignedIn ? ctx.auth.displayName : "anonymous";
}
async function save(ctx: Ctx, body: string) {
  const who = await owner(ctx);
  return ctx.db.notes.insert({ body, owner: who });
}
const prefix = (ctx: Ctx) => ctx.env.NOTE_PREFIX ?? "";
async function listAll(ctx: Ctx) {
  const { db } = ctx;
  return db.notes.withIndex("by_creation").order("desc").collect();
}
async function subject(ctx: Ctx): Promise<string> {
  return String(ctx.auth.userId);
}
function getHeader(req: Req, name: string): string | null {
  return req.headers.get(name);
}
// Sync helpers that hand the request on keep their values; nothing to await.
function bearer(req: Req): string | null {
  return getHeader(req, "Authorization");
}
async function authed(ctx: Ctx, req: Req): Promise<boolean> {
  return bearer(req) === "Bearer " + (ctx.env.NOTE_KEY ?? "");
}
function originOf(req: Req) {
  return new URL(req.url).origin;
}
async function readBody(req: Req) {
  return (await req.json()) as { body?: string };
}

export default capsule({
  name: "helpers",
  schema: { notes: table({ body: string(), owner: string() }) },
  queries: {
    list: query(async (ctx) => listAll(ctx)),
    greeting: query(async (ctx) => {
      const c = ctx;
      return prefix(c) + (await owner(c));
    }),
    me: query(async (ctx) => subject(ctx)),
  },
  mutations: {
    add: mutation(async (ctx, body: string) => {
      const auth = ctx.auth;
      await save(ctx, body);
      return auth.isSignedIn;
    }),
  },
  endpoints: {
    post: endpoint({ method: "POST", path: "/api/notes" }, async (ctx, req) => {
      if (!(await authed(ctx, req))) return text("no", { status: 403 });
      const { body } = await readBody(req);
      await save(ctx, body ?? "");
      return text("saved", { status: 201 });
    }),
    // 0.8's json() rejected on invalid JSON: `.catch` answers instead, also on a returned promise.
    parse: endpoint({ method: "POST", path: "/api/parse" }, (_ctx, req) => req.json().catch(() => ({ invalid: true }))),
    where: endpoint({ method: "GET", path: "/api/where" }, (_ctx, req) => json({ origin: originOf(req), url: req.url })),
  },
});
