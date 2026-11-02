import { action, defineConfig } from "zero";
type Keys = keyof Record<string, number>;
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const key: Keys = "anything"; return key; } }) } });
