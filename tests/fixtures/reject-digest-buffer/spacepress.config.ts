import { defineConfig, mutation } from "spacepress";
import { createHash } from "node:crypto";
export const a = mutation({ access: "anyone" }, (_ctx, i: { d: string }) => { return createHash("sha256").update(i.d).digest().length; });

export default defineConfig({});
