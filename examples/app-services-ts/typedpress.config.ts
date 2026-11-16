import { collection, defineConfig, env, text } from "typedpress";

export const articles = collection({
  title: text(),
  excerpt: text().optional(),
}, {
  storageName: "service_posts",
  title: "title",
  drafts: true,
  access: { read: "anyone" },
});

export default defineConfig({
  name: "services-ts",
  services: {
    forms: {
      contact: {
        fields: {
          email: { type: "email", notNull: true, rules: { max: 191 } },
          message: { type: "text", notNull: true, rules: { min: 3, max: 2000 } },
          guests: { type: "integer", rules: { min: 1, max: 10 } },
          updates: { type: "boolean" },
        },
        recipient: env("APP_SERVICES_RECIPIENT"),
        sender: env("APP_SERVICES_SENDER"),
        limit: 5,
      },
    },
    search: { articles: ["title", "excerpt"] },
    products: { workshop: { name: "WordPress workshop", amount: 1900, currency: "usd" } },
    checkoutReturnUrl: "https://example.test/checkout",
  },
});
