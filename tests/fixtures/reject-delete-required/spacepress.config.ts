import { defineConfig, mutation } from "spacepress";

export const drop = mutation({}, () => {
  const draft: { title: string; note?: string } = { title: "t" };
  delete draft.title;
  return draft;
});

export default defineConfig({});
