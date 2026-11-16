import { action, defineConfig } from "typedpress";

export const drop = action({
  input: {},
  handler: () => {
    const items = ["a", "b", "c"];
    delete items[0];
    return items;
  },
});

export default defineConfig({});
