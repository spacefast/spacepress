import { action, defineConfig } from "typedpress";
import { get_post } from "php/wordpress";
export const a = action({ input: {}, access: "anyone", handler: () => get_post("12") });

export default defineConfig({});
