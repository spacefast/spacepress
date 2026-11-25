import { defineConfig, mutation } from "spacepress";
type Identity<T> = T;
type Choice<T> = Identity<T> extends string ? "text" : "other";
export const example = mutation({}, () => { const value: Choice<string | number> = "text"; return value; });

export default defineConfig({});
