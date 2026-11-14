import { readFileSync } from "node:fs";
import { action, defineConfig } from "first";
export const a = action({ input: {}, access: "anyone", handler() { return readFileSync("/etc/hostname", "utf8"); } });

export default defineConfig({});
