import { action, defineConfig } from "typedpress";
type Stamped<T extends { stamp: number }> = T;
export const example = action({ input: {}, handler: () => { const value: Stamped<{ stamp: Date }> = { stamp: new Date(0) }; return value; } });

export default defineConfig({});
