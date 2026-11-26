import { defineConfig, mutation } from "spacepress";
export const a = mutation({ access: "anyone" }, () => { return navigator.userAgent; });
export default defineConfig({});
