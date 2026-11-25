import { defineConfig, mutation } from "spacepress";
// An action listed under the name an export already took: names are unique across the app.
const count = mutation({ access: "anyone" }, () => 1);
export { count as notes };

export default defineConfig({ name: "clash" });
