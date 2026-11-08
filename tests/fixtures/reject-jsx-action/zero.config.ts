import { defineConfig, action } from "zero";
import { Badge } from "./zero/components/Badge";

export default defineConfig({
  actions: { badge: action({ input: {}, handler: async () => ({ html: Badge({ text: "x" }) }) }) },
});
