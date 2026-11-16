import { action, defineConfig } from "typedpress";
import { abilities } from "php/wordpress";
export const a = action({ input: {}, access: "anyone", handler: () => abilities.call("acme/site-info", { field: "title" }) });

export default defineConfig({});
