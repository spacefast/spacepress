import { defineConfig, env } from "typedpress";
import kitchenPolicy from "./tp/plugins/kitchen-policy/index";

export default defineConfig({
  name: "kitchen-sink",
  use: [kitchenPolicy()],
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  uploads: { backend: "local" },
  plugins: { "classic-editor": "1.6.7" },
  webhooks: [{
    url: env("KITCHEN_WEBHOOK_URL"),
    secret: env("KITCHEN_WEBHOOK_SECRET"),
    events: ["events.created", "events.updated"],
  }],
});
