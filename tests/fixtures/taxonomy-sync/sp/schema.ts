import { collection, global, table, taxonomy, f } from "spacepress";
export const topics = taxonomy({}, { sync: "content/topics/*.json" });
