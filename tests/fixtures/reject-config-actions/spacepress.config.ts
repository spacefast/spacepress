import { defineConfig, mutation } from "spacepress";
const like = mutation({}, () => 1);
export default defineConfig({ actions: { like } });
