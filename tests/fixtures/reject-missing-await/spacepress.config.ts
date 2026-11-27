import { defineConfig, table, f } from "spacepress";
export const a = table({ name: f.text() }).on({ async afterCreate({ db }) { db.a.create({ name: "x" }); } });
export default defineConfig({});
