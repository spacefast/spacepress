import { action, capsule, mutation, query } from "@spacefast/zero/server";

// The three ctx.crypto calls, awaited and returned as promises.
export default capsule({
  name: "legacy-crypto",
  queries: {
    digest: query(async (ctx, text: string) => ctx.crypto.sha256(text)),
  },
  actions: {
    sign: action(async (ctx, payload: string) => {
      const inline = await ctx.crypto.hmacSha256({ key: { value: "Jefe" }, data: payload });
      const named = await ctx.crypto.hmacSha256({ key: "WEBHOOK_SECRET", data: payload });
      return { inline, named };
    }),
  },
  mutations: {
    verify: mutation(async (ctx, body: string, given: string) => {
      const expected = await ctx.crypto.hmacSha256({ key: "WEBHOOK_SECRET", data: body });
      return ctx.crypto.timingSafeEqual(expected, given);
    }),
  },
});
