import { createHmac } from "node:crypto";
import { defineConfig, mutation } from "typedpress";
export const sign = mutation({ access: "anyone" }, (i: { body: string }) => { return createHmac("sha256", process.env.AUTH_KEY!).update(i.body).digest("hex"); });
export default defineConfig({});
