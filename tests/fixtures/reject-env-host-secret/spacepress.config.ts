import { defineConfig, env, table, f } from "spacepress";
export const notes = table({ x: f.text().optional() });
export default defineConfig({ webhooks: [{ url: "https://example.com/hook", secret: env("nonce_salt"), events: ["notes.created"] }] });
