import { action, defineConfig } from "typedpress";
import { the_title } from "php/wordpress";
export const a = action({ input: {}, access: "anyone", handler: () => the_title() });

export default defineConfig({});
