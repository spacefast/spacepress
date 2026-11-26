import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return crypto.getRandomValues(new Uint8Array(16)).length; });

export default defineConfig({});
