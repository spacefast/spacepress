import { collection, files, job, env, global, defineConfig, table, mutation, f } from "spacepress";
import { db } from "spacepress/server";
export const notes = table({ x: f.text().optional() });
export const bad = mutation({ access: "anyone", signature: { secret: env("SECRET"), header: "x-signature", scheme: "spacepress" } }, () => true);

export default defineConfig({});
