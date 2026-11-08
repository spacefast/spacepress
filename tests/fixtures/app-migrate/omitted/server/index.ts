import { capsule, connector, query, string, table } from "@spacefast/zero/server";
export default capsule({
  name: "omitted",
  schema: { notes: table({ body: string() }) },
  connectors: { calendar: connector({ as: "owner", connector: "calendar" }) },
  queries: { count: query(async (ctx) => ctx.db.notes.withIndex("by_creation").count()) },
});
