import { action, defineConfig } from "first";
type Keys = keyof { id: number; title: string };
export const example = action({ input: {}, handler: () => { const key: Keys = "other"; return key; } });

export default defineConfig({});
