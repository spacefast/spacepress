import { defineConfig, mutation } from "spacepress";
class Brand {
  static [Symbol.hasInstance](value: unknown): boolean { return typeof value === "object" && value !== null; }
}
export const probe = mutation({}, () => ({}) instanceof Brand);

export default defineConfig({ name: "typescriptclasssymbolmethod" });
