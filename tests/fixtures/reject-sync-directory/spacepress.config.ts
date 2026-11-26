import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const a = table({  }, { sync: "data/./items/*.json" });
export const b = table({  }, { sync: "data/items/*.json" });
export default defineConfig({});
