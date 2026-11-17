import { defineConfig, mutation } from "typedpress";
function identity<T>(value: T): T { return value; }
export const example = mutation({}, () => { return identity(1); });

export default defineConfig({});
