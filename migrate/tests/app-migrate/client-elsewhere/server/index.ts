import { capsule, query, string, table } from "@spacefast/zero/server";
export default capsule({
  name: "client-elsewhere",
  schema: { notes: table({ body: string() }) },
  queries: { count: query(async (ctx) => ctx.db.notes.withIndex("by_creation").count()) },
});
