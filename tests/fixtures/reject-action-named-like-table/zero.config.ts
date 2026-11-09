import { action, defineConfig } from "zero";
// An action listed under the name an export already took: names are unique across the app.
const count = action({ input: {}, access: "anyone", handler: () => 1 });
export default defineConfig({ name: "clash", actions: { notes: count } });
