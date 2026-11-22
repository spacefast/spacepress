import { defineConfig, mutation } from "typedpress";
import { abilities } from "php/wordpress";

// A locked third-party ability and the app's own action, called with typed input and output.
export const greet = mutation({ access: "anyone" }, (i: { who: string }) => "hi " + i.who);

export const relay = mutation({ access: "anyone" }, async (i: { who: string }) => {
  const site = await abilities.call("acme/site-info", { field: "name" });
  const own = await abilities.call("calls/greet", { who: i.who });
  return { name: site.value.toUpperCase(), own };
});

export default defineConfig({
  name: "calls",
});
