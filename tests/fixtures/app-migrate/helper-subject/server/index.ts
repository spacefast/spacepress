import { capsule, mutation, query, string, table } from "@spacefast/zero/server";

// One helper reads the caller's subject for a query and a mutation. It converts with the query's
// read-only mode, so the mutation must still refuse a caller without an identity.
async function uid(ctx: any) {
  return ctx.auth.userId;
}
async function stamp(ctx: any, body: string) {
  return { body, owner: String(await uid(ctx)) };
}

export default capsule({
  name: "helper-subject",
  schema: { notes: table({ body: string(), owner: string() }) },
  queries: {
    whoami: query(async (ctx) => uid(ctx)),
  },
  mutations: {
    add: mutation(async (ctx, body: string) => {
      const row = await stamp(ctx, body);
      await ctx.db.notes.insert(row);
      return row.owner;
    }),
  },
});
