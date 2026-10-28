import { collection, id, defineConfig, action } from "zero";
const n = collection("n", { id: id() }, { editor: false });
export default defineConfig({
  schema: { n },
  actions: {
    alias: action({
      input: {},
      handler() {
        const a: number[] = [];
        const box = { a };
        a.push(1);
        return box.a.length;
      },
    }),
  },
});
