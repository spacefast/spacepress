import { capsule, query, string, table } from "@spacefast/zero/server";

// A brochure site: static pages, a layout, and one data query for its callers.
export default capsule({
  name: "Legacy Site",
  schema: { leads: table({ email: string() }) },
  queries: { leads: query(async (ctx) => ctx.db.leads.withIndex("by_creation").collect()) },
});
