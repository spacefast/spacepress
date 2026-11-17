import { defineConfig, env, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return env("API_KEY") ?? "unset"; });

export default defineConfig({});
