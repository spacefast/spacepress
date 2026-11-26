import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig, table } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = table({ n: integer().localized().optional() });
export default defineConfig({ locales: { default: "en", all: ["en"] } });
