import { action, defineConfig } from "typedpress";
import { make } from "./tp/lib.mjs";
export const probe = action({ input: {}, handler: () => make() });

export default defineConfig({ name: "classcomputedstringkey" });
