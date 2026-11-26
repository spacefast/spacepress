import { defineConfig, global } from "spacepress";
import { topics } from "./sp/schema";
import { terms } from "spacepress";
export const settings = global({ featured: terms(topics) });
export default defineConfig({});
