import { defineConfig, global } from "spacepress";
import { topics } from "./sp/schema";
import { f } from "spacepress";
export const settings = global({ featured: f.terms(topics) });
export default defineConfig({});
