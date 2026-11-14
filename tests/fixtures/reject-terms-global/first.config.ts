import { defineConfig, global } from "first";
import { topics } from "./first/schema";
import { terms } from "first";
export default defineConfig({ globals: { settings: global("settings", { featured: terms(topics) }) } });
