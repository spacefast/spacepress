import { action, defineConfig } from "zero";

export default defineConfig({
  actions: {
    drop: action({
      input: {},
      handler: () => {
        const items = ["a", "b", "c"];
        delete items[0];
        return items;
      },
    }),
  },
});
