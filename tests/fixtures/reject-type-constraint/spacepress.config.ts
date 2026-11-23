import { defineConfig, mutation } from "spacepress";
type Stamped<T extends { stamp: number }> = T;
export const example = mutation({}, () => { const value: Stamped<{ stamp: Date }> = { stamp: new Date(0) }; return value; });

export default defineConfig({});
