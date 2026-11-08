import { action, boolean, capsule, mutation, query, string, table, type PaginationOptions } from "@spacefast/zero/server";

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
    // The shelf first, then the page: usePaginatedQuery's options go to the second input.
    page: query(async (ctx, shelf: string, options: PaginationOptions) =>
      ctx.db.notes.withIndex("by_shelf", (r) => r.eq("shelf", shelf)).paginate(options)),
  },
  mutations: {
    add: mutation(async (ctx, shelf: string, title: string) =>
      ctx.db.notes.insert({ title, shelf })),
    setDone: mutation(async (ctx, id: string, done: boolean) => ctx.db.notes.update(id, { done })),
  },
  actions: {
    banner: action(async (_ctx, text: string, times: number) => text.toUpperCase().repeat(times)),
  },
});
