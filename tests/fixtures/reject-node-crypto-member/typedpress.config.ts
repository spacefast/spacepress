import { defineConfig, mutation } from "typedpress";
import { createCipheriv } from "node:crypto";
export const a = mutation({ access: "anyone" }, (i: { d: string }) => { return String(createCipheriv); });

export default defineConfig({});
