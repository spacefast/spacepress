import { action, defineConfig, text } from "first";
import { timingSafeEqual } from "node:crypto";
export default defineConfig({ actions: { a: action({ input: { a: text().notNull(), b: text().notNull() }, access: "anyone",
  handler(i) { return timingSafeEqual(i.a, i.b); } }) } });
