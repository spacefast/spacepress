import { defineConfig, env, mutation } from "typedpress";
const serialized = JSON.stringify([{ tokens: [env("HOOK_SECRET")] }]);
export const bad = mutation({}, () => serialized);

export default defineConfig({});
