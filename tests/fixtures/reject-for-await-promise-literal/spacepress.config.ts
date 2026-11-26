import { defineConfig, mutation } from "spacepress";

async function double(n: number): Promise<number> {
  return n * 2;
}

export const probe = mutation({}, async () => {
  const out: number[] = [];
  for await (const v of [double(1), double(2)]) out.push(v);
  return out;
});

export default defineConfig({});
