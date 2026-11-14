import { action, defineConfig } from "first";
import { half } from "./first/half.mjs";

// A high surrogate with no low surrogate after it is a string UTF-8 can't hold.
export default defineConfig({
  actions: { half: action({ input: {}, handler: () => ({ v: half() }) }) },
});
