import { defineConfig, mutation } from "typedpress";
import probe from "./tp/helper.cjs";
export const a = mutation({ access: "anyone" }, () => { return probe(); });

export default defineConfig({});
