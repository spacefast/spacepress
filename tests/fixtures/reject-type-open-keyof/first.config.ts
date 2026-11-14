import { action, defineConfig } from "first";
type Keys = keyof Record<string, number>;
export const example = action({ input: {}, handler: () => { const key: Keys = "anything"; return key; } });

export default defineConfig({});
