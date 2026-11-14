import { action, defineConfig } from "first";
import { abilities } from "php/wordpress";
export const a = action({ input: {}, access: "anyone", handler: () => abilities.call("acme/site-infos", { field: "name" }) });

export default defineConfig({});
