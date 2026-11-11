import { action, defineConfig } from "first";
import { abilities } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler: () => abilities.call("acme/site-info", { field: "title" }) }) } });
