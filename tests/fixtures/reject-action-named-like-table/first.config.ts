import { action, defineConfig } from "first";
// An action listed under the name an export already took: names are unique across the app.
const count = action({ input: {}, access: "anyone", handler: () => 1 });
export { count as notes };

export default defineConfig({ name: "clash" });
