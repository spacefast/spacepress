import { action, defineConfig } from "first";
type Check<T> = T extends { length: number } ? "sized" : "other";
export const example = action({ input: {}, handler: () => { const value: Check<string> = "sized"; return value; } });

export default defineConfig({});
