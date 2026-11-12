import { action, defineConfig, text } from "first";
import { timingSafeEqual } from "node:crypto";
export default defineConfig({ actions: { a: action({ input: { a: text(), b: text() }, access: "anyone",
  handler(i) { return timingSafeEqual(i.a, i.b); } }) } });
