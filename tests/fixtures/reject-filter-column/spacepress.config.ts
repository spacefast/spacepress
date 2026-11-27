import { defineConfig, table, f } from "spacepress";
export const a = table({ name: f.text() }).on({ async afterCreate({ db }) { await db.a.list({ where: { nmae: "x" } }); } });
export default defineConfig({});
