import { capsule, mutation, number, query, string, table, type PaginationOptions } from "@spacefast/zero/server";

// Paginated reads over the creation index and a declared index with an equality prefix.
export default capsule({
  name: "Legacy Feed",
  // 0.8 type-checked favicon and never served it; the converter drops it.
  favicon: "/favicon.png",
  schema: {
    posts: table({
      channel: string(),
      body: string(),
      score: number().default(0),
    }).index("by_channel", ["channel", "score"]),
  },
  queries: {
    latest: query(async (ctx, options: PaginationOptions) =>
      ctx.db.posts.withIndex("by_creation").order("desc").paginate(options)),
    channel: query(async (ctx, channel: string, options: PaginationOptions) =>
      ctx.db.posts
        .withIndex("by_channel", (range) => range.eq("channel", channel))
        .order("asc")
        .paginate(options)),
  },
  mutations: {
    post: mutation(async (ctx, channel: string, body: string, score: number) =>
      ctx.db.posts.insert({ channel, body, score })),
  },
});
