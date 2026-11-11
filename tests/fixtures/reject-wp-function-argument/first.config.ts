import { action, defineConfig } from "first";
import { get_post } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler: () => get_post("12") }) } });
