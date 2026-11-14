import { action, defineConfig } from "first";

export const drop = action({
  input: {},
  handler: () => {
    const items = ["a", "b", "c"];
    delete items[0];
    return items;
  },
});

export default defineConfig({});
