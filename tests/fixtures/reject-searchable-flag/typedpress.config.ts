import { defineConfig, table, text } from "typedpress";
export const a = table({ note: text().searchable("yes" as any) });
export default defineConfig({});
