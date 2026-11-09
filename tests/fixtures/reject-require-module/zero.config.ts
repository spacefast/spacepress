import { action, defineConfig } from "zero";
import probe from "./zero/helper.cjs";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler() { return probe(); } }) } });
