import { defineConfig, env, table, text } from "first";
const notes = table({ x: text().optional() });
export default defineConfig({ tables: { notes }, webhooks: [{ url: "https://example.com/hook", secret: env("nonce_salt"), events: ["notes.created"] }] });
