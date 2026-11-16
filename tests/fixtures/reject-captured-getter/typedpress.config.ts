import { action, defineConfig } from "typedpress";
import lib from "./tp/lib.cjs";

export const read = action({ input: {}, handler: () => lib.count });

export default defineConfig({});
