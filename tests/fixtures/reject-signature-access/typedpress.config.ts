import { collection, text, files, job, once, env, global, defineConfig, db, table, mutation } from "typedpress";
export const notes = table({ x: text().optional() });
export const bad = mutation({ access: "anyone", signature: { secret: env("SECRET"), header: "x-signature", scheme: "typedpress" } }, () => true);

export default defineConfig({});
