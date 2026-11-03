import { action, defineConfig } from "zero";
type Keys = keyof { id: number; title: string };
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const key: Keys = "other"; return key; } }) } });
