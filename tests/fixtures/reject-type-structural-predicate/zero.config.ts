import { action, defineConfig } from "zero";
type Check<T> = T extends { length: number } ? "sized" : "other";
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Check<string> = "sized"; return value; } }) } });
