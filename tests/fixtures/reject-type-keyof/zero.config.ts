import { action, defineConfig } from "zero";
type Keys = keyof { id: number; title: string };
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const key: Keys = "other"; return key; } }) } });
