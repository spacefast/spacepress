import { defineConfig, env, table, text } from "first";
export const notes = table({ x: text().optional() });
export default defineConfig({ webhooks: [{ url: "https://example.com/hook", secret: env("nonce_salt"), events: ["notes.created"] }] });
