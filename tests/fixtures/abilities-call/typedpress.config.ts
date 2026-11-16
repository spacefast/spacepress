import { action, defineConfig, text } from "typedpress";
import { abilities } from "php/wordpress";

// A locked third-party ability and the app's own action, called with typed input and output.
export const greet = action({ input: { who: text() }, access: "anyone", handler: (i) => "hi " + i.who });

export const relay = action({
  input: { who: text() },
  access: "anyone",
  async handler(i) {
    const site = await abilities.call("acme/site-info", { field: "name" });
    const own = await abilities.call("calls/greet", { who: i.who });
    return { name: site.value.toUpperCase(), own };
  },
});

export default defineConfig({
  name: "calls",
});
