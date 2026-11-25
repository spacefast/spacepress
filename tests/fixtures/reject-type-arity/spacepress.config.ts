import { defineConfig, mutation } from "spacepress";
type Box<T> = { value: T };
export const example = mutation({}, () => { const value: Box = { value: 1 }; return value; });

export default defineConfig({});
