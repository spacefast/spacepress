import { defineConfig, mutation } from "spacepress";
import { scrypt } from "node:crypto";
export const a = mutation({ access: "anyone" }, (i: { d: string }) => { return String(scrypt); });

export default defineConfig({});
