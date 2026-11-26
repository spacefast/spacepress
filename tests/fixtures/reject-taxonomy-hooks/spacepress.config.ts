import { defineConfig, taxonomy } from "spacepress";
export const subjects = taxonomy({}).on({ beforeCreate: (data) => data });
export default defineConfig({});
