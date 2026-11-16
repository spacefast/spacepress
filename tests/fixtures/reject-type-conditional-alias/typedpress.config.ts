import { action, defineConfig } from "typedpress";
type Identity<T> = T;
type Choice<T> = Identity<T> extends string ? "text" : "other";
export const example = action({ input: {}, handler: () => { const value: Choice<string | number> = "text"; return value; } });

export default defineConfig({});
