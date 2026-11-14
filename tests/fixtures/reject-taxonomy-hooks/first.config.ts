import { defineConfig } from "first";
export default defineConfig({ hooks: { topics: { beforeCreate: (data) => data } } });
