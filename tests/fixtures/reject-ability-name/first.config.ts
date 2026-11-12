import { action, defineConfig, text } from "first";
import { abilities } from "php/wordpress";
export default defineConfig({ actions: { a: action({ input: { name: text() }, access: "anyone", handler: (i) => abilities.call(i.name, {}) }) } });
