import { action, defineConfig } from "first";
import probe from "./helper.cjs";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler() { return probe(); } }) } });
