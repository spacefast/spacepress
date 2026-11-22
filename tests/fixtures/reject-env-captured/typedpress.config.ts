import { defineConfig, env, mutation } from "typedpress";
const values = [{ tokens: [env("PRIVATE_TOKEN")] }];
export const bad = mutation({}, () => values[0]);

export default defineConfig({});
