import { action, defineConfig } from "typedpress";

async function double(n: number): Promise<number> {
  return n * 2;
}

export const probe = action({
  input: {},
  handler: async () => {
    const out: number[] = [];
    for await (const v of [double(1), double(2)]) out.push(v);
    return out;
  },
});

export default defineConfig({});
