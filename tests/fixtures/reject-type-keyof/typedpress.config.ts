import { action, defineConfig } from "typedpress";
type Keys = keyof { id: number; title: string };
export const example = action({ input: {}, handler: () => { const key: Keys = "other"; return key; } });

export default defineConfig({});
