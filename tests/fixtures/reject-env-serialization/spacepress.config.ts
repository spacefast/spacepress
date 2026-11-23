import { defineConfig, env, mutation } from "spacepress";
const serialized = JSON.stringify([{ tokens: [env("HOOK_SECRET")] }]);
export const bad = mutation({}, () => serialized);

export default defineConfig({});
