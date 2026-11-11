import { action, defineConfig } from "first";
type Identity<T> = T;
type Choice<T> = Identity<T> extends string ? "text" : "other";
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Choice<string | number> = "text"; return value; } }) } });
