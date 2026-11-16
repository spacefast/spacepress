import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, jobs, once, env, global, action, defineConfig, db, table } from "typedpress";
export const notes = table({ x: text().optional() });
export const bad = action({ input: {}, access: "anyone", signature: { secret: env("SECRET"), header: "x-signature", scheme: "typedpress" }, handler: () => true });

export default defineConfig({});
