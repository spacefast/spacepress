import { defineConfig, taxonomy } from "typedpress";
export const subjects = taxonomy({}).on({ beforeCreate: (data) => data });
export default defineConfig({});
