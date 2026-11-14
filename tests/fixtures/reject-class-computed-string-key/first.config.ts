import { action, defineConfig } from "first";
import { make } from "./first/lib.mjs";
export const probe = action({ input: {}, handler: () => make() });

export default defineConfig({ name: "classcomputedstringkey" });
