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
    // One 0.8 parity vector: digest, MAC with the given key, and comparison of key and data.
    vector: action(async (ctx, key: string, data: string) => [
      await ctx.crypto.sha256(data),
      await ctx.crypto.hmacSha256({ key: { value: key }, data }),
      await ctx.crypto.timingSafeEqual(key, data),
    ]),
    // An inline key whose value comes from the environment is still used exactly as given.
    inlineEnv: action(async (ctx, data: string) => ctx.crypto.hmacSha256({ key: { value: ctx.env.SECRET }, data })),
    named: action(async (ctx, key: string, data: string) => [
      await ctx.crypto.sha256(data),
      await ctx.crypto.hmacSha256({ key: "K", data }),
      await ctx.crypto.timingSafeEqual(key, data),
    ]),
  },
  mutations: {
    verify: mutation(async (ctx, body: string, given: string) => {
      const expected = await ctx.crypto.hmacSha256({ key: "WEBHOOK_SECRET", data: body });
      return ctx.crypto.timingSafeEqual(expected, given);
    }),
  },
});
