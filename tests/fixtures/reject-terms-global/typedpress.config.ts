import { defineConfig, global } from "typedpress";
import { topics } from "./tp/schema";
import { terms } from "typedpress";
export const settings = global({ featured: terms(topics) });
export default defineConfig({});
