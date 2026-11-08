import { action, defineConfig } from "zero";

async function double(n: number): Promise<number> {
  return n * 2;
}

export default defineConfig({
  actions: {
    probe: action({
      input: {},
      handler: async () => {
        const out: number[] = [];
        for await (const v of [double(1), double(2)]) out.push(v);
        return out;
      },
    }),
  },
});
