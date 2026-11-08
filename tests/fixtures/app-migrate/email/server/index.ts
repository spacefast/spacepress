import { action, capsule, mutation, string, table } from "@spacefast/zero/server";

// ctx.email.send from a mutation (sent only if the write commits) and from an action.
export default capsule({
  name: "legacy-mail",
  schema: { signups: table({ email: string() }) },
  mutations: {
    join: mutation(async (ctx, email: string, fail: boolean) => {
      await ctx.db.signups.insert({ email });
      const queued = await ctx.email.send({
        from: { email: "hello@example.test", name: "Legacy, Inc." },
        to: [email],
        subject: "Welcome",
        text: "Thanks for joining.",
        html: "<p>Thanks for joining.</p>",
      });
      if (fail) throw new Error("rolled back after send");
      return queued;
    }),
  },
  actions: {
    ping: action(async (ctx, to: string) => ctx.email.send({ from: "hello@example.test", to, subject: "Ping", text: "pong" })),
  },
});
