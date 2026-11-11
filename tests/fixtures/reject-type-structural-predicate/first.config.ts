import { action, defineConfig } from "first";
type Check<T> = T extends { length: number } ? "sized" : "other";
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Check<string> = "sized"; return value; } }) } });
