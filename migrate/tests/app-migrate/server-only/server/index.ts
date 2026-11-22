import { capsule, mutation, query, string, table } from "@spacefast/zero/server";
export default capsule({
  name: "server-only",
  schema: { notes: table({ body: string() }) },
  queries: { list: query(async (ctx) => ctx.db.notes.withIndex("by_creation").collect()) },
  mutations: { add: mutation(async (ctx, body: string) => ctx.db.notes.insert({ body })) },
});
