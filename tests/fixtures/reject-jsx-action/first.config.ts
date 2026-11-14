import { defineConfig, action } from "first";
import { Badge } from "./first/components/Badge";

export const badge = action({ input: {}, handler: async () => ({ html: Badge({ text: "x" }) }) });

export default defineConfig({});
