import { action, defineConfig } from "first";
class Brand {
  static [Symbol.hasInstance](value: unknown): boolean { return typeof value === "object" && value !== null; }
}
export const probe = action({ input: {}, handler: () => ({}) instanceof Brand });

export default defineConfig({ name: "typescriptclasssymbolmethod" });
