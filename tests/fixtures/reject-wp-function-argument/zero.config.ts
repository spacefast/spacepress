import { action, defineConfig } from "zero";
import { get_post } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler: () => get_post("12") }) } });
