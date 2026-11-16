import { action, defineConfig, taxonomy, terms } from "typedpress";
export const topics = taxonomy({});
export const bad = action({ input: { ids: terms(topics) }, handler: () => null });
export default defineConfig({});
