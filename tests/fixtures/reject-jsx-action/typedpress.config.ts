import { defineConfig, mutation } from "typedpress";
import { Badge } from "./tp/components/Badge";

export const badge = mutation({}, async () => ({ html: Badge({ text: "x" }) }));

export default defineConfig({});
