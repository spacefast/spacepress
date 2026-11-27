import { defineConfig, table, f } from "spacepress";
export const a = table({ name: f.text(), x: f.text() }).on({ async afterCreate({ db }) { await db.a.create({ name: "x" }); } });
export default defineConfig({});
