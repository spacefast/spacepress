import { defineConfig, mutation } from "spacepress";
import { timingSafeEqual } from "node:crypto";
export const a = mutation({ access: "anyone" }, (i: { a: string; b: string }) => { return timingSafeEqual(i.a, i.b); });

export default defineConfig({});
