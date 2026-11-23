import { defineConfig, mutation } from "spacepress";

// An object that holds functions exists only while the config is built: members resolve
// at compile time, but the object itself has no PHP form.
const helpers = { twice: (n: number) => n * 2 };

export const probe = mutation({}, () => Object.keys(helpers));

export default defineConfig({
  name: "reject-namespace-value",
});
