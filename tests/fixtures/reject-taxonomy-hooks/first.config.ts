import { defineConfig, taxonomy } from "first";
export const subjects = taxonomy({}).on({ beforeCreate: (data) => data });
export default defineConfig({});
