// The plugin lane's app at each deploy, one typedpress.config.ts per step (`node steps.mjs <step>`).
const notes = (fields = "") => `export const notes = collection({
  title: text(),
  body: text().optional(),${fields}
}, { title: "title", url: "/notes/:id", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });`;
// What a host supplies and the plugin supplies here: the app's variables, and mail delivery. The
// lane's site answers on 127.0.0.1, which makes no default sender address, so the app names one.
const actions = `export const greeting = mutation({ access: "anyone" }, () => { return { greeting: process.env.GREETING ?? null }; });
export const welcome = mutation({ access: "editor" }, async (i: { to: string }) => { return { id: (await mail.send({ to: i.to, from: "app@example.test", subject: "Welcome", text: "Sent by the deployed app." })).id }; });`;
// A SQL table: its changes are migrations, and the deploy-time schema check counts its rows.
const entries = (fields = "") => `export const entries = table({
  body: text().optional(),${fields}
});`;
const app = (parts, options = "") => `import { collection, defineConfig, mail, table, text, mutation } from "typedpress";
${parts.join("\n")}
${actions}
export default defineConfig({ name: "pluginlane"${options} });
`;
const tasks = `export const tasks = collection({ name: text() }, { title: "name", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });`;

export const steps = {
  // 1. The typedpress deploy.
  initial: app([notes(), entries()]),
  // 2. A new kind, and a column with a default on the table: one migration, no refusal.
  additive: app([notes(`\n  mood: text().optional(),`), entries(`\n  state: text().default("open"),`), tasks]),
  // The same app, sealed: only the plugins on its list may be activated (docs/sealed.md).
  sealed: app([notes(`\n  mood: text().optional(),`), entries(`\n  state: text().default("open"),`), tasks], ", sealed: true"),
  // 3. A new binding to a table missing on the site: the site refuses it.
  adoption: app([notes(`\n  mood: text().optional(),`), entries(`\n  state: text().default("open"),`), tasks,
    `export const external = table({ title: text() }, { existingTable: "wp_missing_entries" });`]),
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const step = steps[process.argv[2]];
  if (!step) { console.error(`steps: ${Object.keys(steps).join(", ")}`); process.exit(2); }
  process.stdout.write(step);
}
