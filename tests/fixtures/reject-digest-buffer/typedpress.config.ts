import { defineConfig, mutation } from "typedpress";
import { createHash } from "node:crypto";
export const a = mutation({ access: "anyone" }, (i: { d: string }) => { return createHash("sha256").update(i.d).digest().length; });

export default defineConfig({});
