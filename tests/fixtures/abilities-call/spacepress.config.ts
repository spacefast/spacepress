import { defineConfig, mutation } from "spacepress";
import { abilities } from "spacepress/server/wp";

// A locked third-party ability and the app's own action, called with typed input and output.
export const greet = mutation({ access: "anyone" }, (_ctx, i: { who: string }) => "hi " + i.who);

export const relay = mutation({ access: "anyone" }, async (_ctx, i: { who: string }) => {
  const site = await abilities.call("acme/site-info", { field: "name" });
  const own = await abilities.call("calls/greet", { who: i.who });
  return { name: site.value.toUpperCase(), own };
});

export default defineConfig({
  name: "calls",
});
