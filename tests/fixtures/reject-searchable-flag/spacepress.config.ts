import { defineConfig, table, f } from "spacepress";
export const a = table({ note: f.text().searchable("yes" as any) });
export default defineConfig({});
