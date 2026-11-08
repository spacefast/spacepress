import { capsule, endpoint, mutation, query, string, table, text } from "@spacefast/zero/server";

// Helpers that take the context or the endpoint request, as 0.8 apps wrote them: typed loosely,
// called from handlers and from each other, with the context aliased and destructured on the way.
type Ctx = { db: any; auth: any; env: Record<string, string | undefined> };
type Req = { headers: { get(name: string): string | null }; json(): Promise<unknown> };

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
async function authed(ctx: Ctx, req: Req): Promise<boolean> {
  return getHeader(req, "Authorization") === "Bearer " + (ctx.env.NOTE_KEY ?? "");
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
  },
});
