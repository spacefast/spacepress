import { boolean, capsule, mutation, query, string, table } from "@spacefast/zero/server";

export default capsule({
  name: "Shelf Notes",
  schema: {
    notes: table({
      title: string(),
      shelf: string(),
      done: boolean().default(false),
    }).index("by_shelf", ["shelf"]),
  },
  queries: {
    onShelf: query(async (ctx, shelf: string) =>
      ctx.db.notes.withIndex("by_shelf", (r) => r.eq("shelf", shelf)).collect()),
  },
  mutations: {
    add: mutation(async (ctx, shelf: string, title: string) =>
      ctx.db.notes.insert({ title, shelf })),
    setDone: mutation(async (ctx, id: string, done: boolean) => ctx.db.notes.update(id, { done })),
  },
});
