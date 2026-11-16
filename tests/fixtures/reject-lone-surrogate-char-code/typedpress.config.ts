import { action, defineConfig } from "typedpress";
import { half } from "./tp/half.mjs";

// A high surrogate with no low surrogate after it is a string UTF-8 can't hold.
export const run = action({ input: {}, handler: () => ({ v: half() }) });

export default defineConfig({});
