import { action, defineConfig } from "typedpress";
type Check<T> = T extends { length: number } ? "sized" : "other";
export const example = action({ input: {}, handler: () => { const value: Check<string> = "sized"; return value; } });

export default defineConfig({});
