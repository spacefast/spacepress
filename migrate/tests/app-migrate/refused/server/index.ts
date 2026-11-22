import { capsule, connector, endpoint, query, string, table } from "@spacefast/zero/server";
export default capsule({
  name: "needs-port",
  schema: { tasks: table({ title: string() }) },
  auth: { onGuestUpgrade: async (ctx) => {} },
  endpoints: { status: endpoint({ method: "GET", path: "/status" }, () => "ok") },
  queries: {
    email: query(async (ctx) => ctx.email.send({})),
    identity: query(async (ctx) => ctx.auth.userId),
    pages: query(async (ctx) => ctx.db.tasks.withIndex("by_creation").offset(10).collect()),
  },
});
