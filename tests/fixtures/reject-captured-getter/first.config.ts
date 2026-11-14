import { action, defineConfig } from "first";
import lib from "./first/lib.cjs";

export const read = action({ input: {}, handler: () => lib.count });

export default defineConfig({});
