import { defineConfig, mutation } from "spacepress";

export const drop = mutation({}, () => {
  const items = ["a", "b", "c"];
  delete items[0];
  return items;
});

export default defineConfig({});
