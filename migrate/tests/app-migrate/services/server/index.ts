import { action, capsule, endpoint, query, text } from "@spacefast/zero/server";

// Context services with a direct v2 counterpart.
export default capsule({
  name: "legacy-services",
  queries: {
    greeting: query(async (ctx) => {
      ctx.log.info("greeting", { at: "query" });
      return ctx.env.GREETING ?? "hello";
    }),
  },
  actions: {
    region: action(async (ctx) => ctx.env["APP_REGION"] ?? null),
  },
  endpoints: {
    banner: endpoint({ method: "GET", path: "/api/banner" }, (ctx) => {
      ctx.log.warn("banner served");
      return text(ctx.env.BANNER ?? "");
    }),
  },
});
