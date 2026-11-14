import { action, defineConfig } from "first";
import probe from "./first/helper.cjs";
export const a = action({ input: {}, access: "anyone", handler() { return probe(); } });

export default defineConfig({});
