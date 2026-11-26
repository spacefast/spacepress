import { collection, text, email, integer, boolean, richText, slug, group, repeater, json, media, file, files, job, env, global, defineConfig } from "spacepress";
import { once, db } from "spacepress/server";
export const notes = collection({ title: text().showIf({ title: "x" }) });
export default defineConfig({});
