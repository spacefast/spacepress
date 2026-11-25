import { defineConfig, env, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return env("API_KEY") ?? "unset"; });

export default defineConfig({});
