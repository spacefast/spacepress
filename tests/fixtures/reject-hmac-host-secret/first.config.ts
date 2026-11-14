import { createHmac } from "node:crypto";
import { action, defineConfig, text } from "first";
export default defineConfig({ actions: { sign: action({ input: { body: text() }, access: "anyone",
  handler(i) { return createHmac("sha256", process.env.AUTH_KEY!).update(i.body).digest("hex"); } }) } });
