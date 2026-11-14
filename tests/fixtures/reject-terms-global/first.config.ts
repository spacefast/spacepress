import { defineConfig, global } from "first";
import { topics } from "./first/schema";
import { terms } from "first";
export const settings = global({ featured: terms(topics) });
export default defineConfig({});
