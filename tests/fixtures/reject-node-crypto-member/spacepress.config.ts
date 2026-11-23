import { defineConfig, mutation } from "spacepress";
import { createCipheriv } from "node:crypto";
export const a = mutation({ access: "anyone" }, (i: { d: string }) => { return String(createCipheriv); });

export default defineConfig({});
