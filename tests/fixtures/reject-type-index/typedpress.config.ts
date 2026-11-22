import { defineConfig, mutation } from "typedpress";
type Value = ({ id: number } | { other: string })["id"];
export const example = mutation({}, () => { const value: Value = 1; return value; });

export default defineConfig({});
