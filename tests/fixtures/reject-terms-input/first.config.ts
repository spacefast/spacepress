import { action, defineConfig, taxonomy, terms } from "first";
export const topics = taxonomy({});
export default defineConfig({ actions: { bad: action({ input: { ids: terms(topics) }, handler: () => null }) } });
