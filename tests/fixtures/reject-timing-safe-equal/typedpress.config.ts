import { action, defineConfig, text } from "typedpress";
import { timingSafeEqual } from "node:crypto";
export const a = action({ input: { a: text(), b: text() }, access: "anyone",
  handler(i) { return timingSafeEqual(i.a, i.b); } });

export default defineConfig({});
