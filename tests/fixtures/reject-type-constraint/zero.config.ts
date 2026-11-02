import { action, defineConfig } from "zero";
type Stamped<T extends { stamp: number }> = T;
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Stamped<{ stamp: Date }> = { stamp: new Date(0) }; return value; } }) } });
