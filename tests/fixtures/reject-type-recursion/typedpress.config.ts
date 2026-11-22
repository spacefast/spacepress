import { defineConfig, mutation } from "typedpress";
type Recursive<T> = { value: Recursive<T> };
export const example = mutation({}, () => { const value: Recursive<number> = { value: {} }; return value; });

export default defineConfig({});
