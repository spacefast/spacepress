import { boolean, capsule, id, mutation, number, query, string, table, userId } from "@spacefast/zero/server";
import { cleanTitle as text } from "../shared/title";

const OWNER = "legacy-user", TAKE = 2;
class Defaults {
  static owner(): string { return OWNER; }
}

export default capsule({
  name: "legacy-board",
  realtime: { enabled: true },
  schema: {
    tasks: table({
      title: string(),
      done: boolean().default(false),
      score: number().default(2),
      note: string().optional(),
      category: string().optional().default("inbox"),
      owner: userId(),
      parent: id("tasks").optional(),
    }).index("by_owner", ["owner"]).index("by_done", ["done"]),
  },
  queries: {
    list: query(async (ctx) => ctx.db.tasks.withIndex("by_creation").order("desc").collect()),
    get: query(async (ctx, id: string) => ctx.db.tasks.get(id)),
    owned: query(async (ctx, db: string, from: string) =>
      ctx.db.tasks.withIndex("by_owner", (r) => r.eq("owner", db)
        .eq("createdAt", "2026-03-01T00:00:00.123Z").gte("id", from)).order("asc").take(TAKE)),
    byDone: query(async (ctx, done: boolean) =>
      ctx.db.tasks.withIndex("by_done", (r) => r.eq("done", done)).collect()),
    count: query(async (ctx) => ctx.db.tasks.withIndex("by_creation").count()),
    first: query(async (ctx) => ctx.db.tasks.withIndex("by_creation").first()),
  },
  mutations: {
    add: mutation(async function (ctx, input: { title: string }) {
      const clean = text(input.title);
      if (!clean) return null;
      return ctx.db.tasks.insert({ title: clean, owner: Defaults.owner() });
    }),
    update: mutation(async (ctx, id: string, note: string | null) =>
      ctx.db.tasks.update(id, { note, category: null })),
    clearNote: mutation(async (ctx, id: string) => ctx.db.tasks.update(id, { note: undefined })),
    touch: mutation(async (ctx, id: string) => ctx.db.tasks.update(id, {})),
    setDone: mutation(async (ctx, id: string, done: boolean) => {
      ctx.invalidate("list", "byDone");
      return ctx.db.tasks.update(id, { done });
    }),
    remove: mutation(async (ctx, id: string) => ctx.db.tasks.delete(id)),
    rollback: mutation(async (ctx) => {
      await ctx.db.tasks.insert({ title: "must roll back", owner: "legacy-user" });
      throw new Error("rollback proof");
    }),
  },
});
