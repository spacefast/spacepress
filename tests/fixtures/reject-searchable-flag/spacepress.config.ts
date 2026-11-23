import { defineConfig, table, text } from "spacepress";
export const a = table({ note: text().searchable("yes" as any) });
export default defineConfig({});
