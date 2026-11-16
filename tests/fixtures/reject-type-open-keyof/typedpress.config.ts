import { action, defineConfig } from "typedpress";
type Keys = keyof Record<string, number>;
export const example = action({ input: {}, handler: () => { const key: Keys = "anything"; return key; } });

export default defineConfig({});
