import { action, defineConfig } from "zero";

// An object that holds functions exists only while the config is built: members resolve
// at compile time, but the object itself has no PHP form.
const helpers = { twice: (n: number) => n * 2 };

export default defineConfig({
  name: "reject-namespace-value",
  actions: { probe: action({ input: {}, handler: () => Object.keys(helpers) }) },
});
