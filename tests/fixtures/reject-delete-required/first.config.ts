import { action, defineConfig } from "first";

export const drop = action({
  input: {},
  handler: () => {
    const draft: { title: string; note?: string } = { title: "t" };
    delete draft.title;
    return draft;
  },
});

export default defineConfig({});
