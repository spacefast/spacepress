import { defineConfig, mutation } from "spacepress";
import probe from "./sp/helper.cjs";
export const a = mutation({ access: "anyone" }, () => { return probe(); });

export default defineConfig({});
