import { defineConfig, action } from "typedpress";
import { Badge } from "./tp/components/Badge";

export const badge = action({ input: {}, handler: async () => ({ html: Badge({ text: "x" }) }) });

export default defineConfig({});
