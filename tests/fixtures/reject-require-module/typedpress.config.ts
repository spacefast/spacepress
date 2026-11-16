import { action, defineConfig } from "typedpress";
import probe from "./tp/helper.cjs";
export const a = action({ input: {}, access: "anyone", handler() { return probe(); } });

export default defineConfig({});
