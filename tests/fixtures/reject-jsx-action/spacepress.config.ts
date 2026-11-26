import { defineConfig, mutation } from "spacepress";
import { Badge } from "./sp/components/Badge";

export const badge = mutation({}, async () => ({ html: Badge({ text: "x" }) }));

export default defineConfig({});
