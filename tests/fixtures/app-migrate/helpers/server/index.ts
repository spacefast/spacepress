import { capsule, mutation, query, string, table } from "@spacefast/zero/server";

// Helpers that take the context, as 0.8 apps wrote them: typed loosely, called from handlers
// and from each other, with the context aliased and destructured on the way.
type Ctx = { db: any; auth: any; env: Record<string, string | undefined> };

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
});
