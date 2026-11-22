import { capsule, endpoint, string, table, text } from "@spacefast/zero/server";

// A writing GET endpoint that never reads the visitor: the hit counter a link or an <img> pings.
// 0.8 ran it on GET; v2 serves it as a GET route that writes.
export default capsule({
  name: "Hits",
  schema: {
    hits: table({ tag: string() }),
  },
  endpoints: {
    seen: endpoint({ method: "GET", path: "/api/seen/:tag", readOnly: false }, async (ctx, request) => {
      await ctx.db.hits.insert({ tag: request.params.tag });
      return text("seen");
    }),
  },
});
