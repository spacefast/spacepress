import { action, defineConfig, text } from "typedpress";
import { abilities } from "php/wordpress";
export const a = action({ input: { name: text() }, access: "anyone", handler: (i) => abilities.call(i.name, {}) });

export default defineConfig({});
