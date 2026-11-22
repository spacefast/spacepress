import { defineConfig, mutation } from "typedpress";

class Deferred {
  value = 1;
  then(resolve: (v: number) => void): void {
    resolve(this.value);
  }
}

export const probe = mutation({}, async () => {
  const out: unknown[] = [];
  for await (const v of [new Deferred()]) out.push(v);
  return out;
});

export default defineConfig({});
