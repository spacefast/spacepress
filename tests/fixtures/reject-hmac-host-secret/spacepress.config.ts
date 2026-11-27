import { createHmac } from "node:crypto";
import { defineConfig, mutation } from "spacepress";
export const sign = mutation({ access: "anyone" }, (_ctx, i: { body: string }) => { return createHmac("sha256", process.env.AUTH_KEY!).update(i.body).digest("hex"); });
export default defineConfig({});
