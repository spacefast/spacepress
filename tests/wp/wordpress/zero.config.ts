import { action, defineConfig, text } from "zero";
import { abilities } from "php/wordpress";

// Calls another plugin's ability (locked by `zero abilities pull`) as the signed-in user.
export default defineConfig({
  name: "abilities-lane",
  actions: {
    count: action({
      input: { text: text().notNull() },
      access: "anyone",
      async handler(input) {
        const result = await abilities.call("acme/word-count", { text: input.text, unit: "words" });
        return { words: result.count, by: result.by.toUpperCase() };
      },
    }),
  },
});
