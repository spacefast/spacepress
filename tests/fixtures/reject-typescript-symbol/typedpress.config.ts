import { action, defineConfig } from "typedpress";
const key = Symbol("key");
export const probe = action({ input: {}, handler: () => typeof key });

export default defineConfig({ name: "typescriptsymbol" });
