import { action, defineConfig } from "first";
import { make } from "./first/lib.mjs";

export const read = action({ input: {}, handler: () => make() });

export default defineConfig({});
