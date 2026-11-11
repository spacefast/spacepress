import { action, defineConfig } from "first";
import { the_title } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: {}, access: "anyone", handler: () => the_title() }) } });
