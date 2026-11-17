import { defineConfig, mutation } from "typedpress";
const like = mutation({}, () => 1);
export default defineConfig({ actions: { like } });
