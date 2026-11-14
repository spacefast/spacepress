import { action, defineConfig } from "first";
const key = Symbol("key");
export const probe = action({ input: {}, handler: () => typeof key });

export default defineConfig({ name: "typescriptsymbol" });
