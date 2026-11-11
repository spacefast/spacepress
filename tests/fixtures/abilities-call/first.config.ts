import { action, defineConfig, text } from "first";
import { abilities } from "php/wordpress";

// A locked third-party ability and the app's own action, called with typed input and output.
export default defineConfig({
  name: "calls",
  actions: {
    greet: action({ input: { who: text().notNull() }, access: "anyone", handler: (i) => "hi " + i.who }),
    relay: action({
      input: { who: text().notNull() },
      access: "anyone",
      async handler(i) {
        const site = await abilities.call("acme/site-info", { field: "name" });
        const own = await abilities.call("calls/greet", { who: i.who });
        return { name: site.value.toUpperCase(), own };
      },
    }),
  },
});
