import { action, defineConfig } from "first";

export default defineConfig({
  actions: {
    drop: action({
      input: {},
      handler: () => {
        const draft: { title: string; note?: string } = { title: "t" };
        delete draft.title;
        return draft;
      },
    }),
  },
});
