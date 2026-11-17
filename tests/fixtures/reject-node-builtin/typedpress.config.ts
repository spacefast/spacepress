import { readFileSync } from "node:fs";
import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return readFileSync("/etc/hostname", "utf8"); });

export default defineConfig({});
