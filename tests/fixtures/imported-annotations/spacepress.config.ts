// A constant keeps its declared type across imports and re-exports: `LABELS[name]` with a string
// `name` reads a Record<string, string>, not the object literal's fixed keys.
import { defineConfig } from "spacepress";
export default defineConfig({ name: "annotations" });
