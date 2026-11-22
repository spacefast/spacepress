import { defineConfig, mutation } from "typedpress";
export const a = mutation({ access: "anyone" }, () => { return navigator.userAgent; });
export default defineConfig({});
