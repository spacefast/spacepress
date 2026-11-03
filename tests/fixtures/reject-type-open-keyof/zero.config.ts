import { action, defineConfig } from "zero";
type Keys = keyof Record<string, number>;
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const key: Keys = "anything"; return key; } }) } });
