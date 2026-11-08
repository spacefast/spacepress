// The schema-check lane's app at each deploy, one zero.config.ts per step. `run.sh` builds them
// in order into one project, so every step's migration is planned against the previous step's
// ledger, exactly as successive deploys of one app would be.
//
//   node steps.mjs <step>   prints that step's zero.config.ts
//
// `tasks` is bound to a table the app did not create (`existingTable`), as `zero migrate app
// --from zero-0.8 --space <id>` binds a migrated Space's tables. `likes` and `notes` are Zero's.
const tasks = (fields = "") => `const tasks = table({
  id: id(),
  title: text().notNull(),
  note: text(),${fields}
}, { existingTable: "sf_spc_schema_check_tasks_0123456789" });`;
const likes = (fields = "", options = "") => `const likes = table({
  id: id(),
  post: integer().notNull(),${fields}
}${options});`;
const notes = (fields = "", options = "") => `const notes = table({
  id: id(),
  body: text(),${fields}
}${options});`;

const app = (parts, tables) => `import { defineConfig, id, integer, table, text } from "zero";
${parts.join("\n")}
export default defineConfig({ name: "schema-check", tables: { ${tables} } });
`;

export const steps = {
  // 1. The first deploy: adopts tasks, creates likes and notes.
  initial: app([tasks(), likes(), notes()], "tasks, likes, notes"),
  // 2. Additive: a new kind, an optional field, a required field with a default. No --drop, no refusal.
  additive: app([tasks(), likes(`\n  emoji: text(),`), notes(`\n  state: text().notNull().default("open"),`),
    "const tags = table({ id: id(), name: text() });"], "tasks, likes, notes, tags"),
  // 3. A new required field with no default on a kind that has rows: refused with the count.
  required: app([tasks(), likes(`\n  emoji: text(),`), notes(`\n  state: text().notNull().default("open"),\n  author: text().notNull(),`),
    "const tags = table({ id: id(), name: text() });"], "tasks, likes, notes, tags"),
  // 4. An optional field becomes required: refused while rows lack it.
  tighten: app([tasks(), likes(`\n  emoji: text().notNull(),`), notes(`\n  state: text().notNull().default("open"),`),
    "const tags = table({ id: id(), name: text() });"], "tasks, likes, notes, tags"),
  // 5. Renames: notes → memos, body → text. Nothing is dropped, so nothing is asked.
  rename: app([tasks(), likes(`\n  emoji: text(),`),
    `const memos = table({
  id: id(),
  text: text().was("body"),
  state: text().notNull().default("open"),
}, { was: "notes" });`,
    "const tags = table({ id: id(), name: text() });"], "tasks, likes, memos, tags"),
  // 6. Drops: the likes kind and the memos.state field, both holding rows.
  drop: app([tasks(),
    `const memos = table({
  id: id(),
  text: text(),
}, { was: "notes" });`,
    "const tags = table({ id: id(), name: text() });"], "tasks, memos, tags"),
  // 7. The adopted table renames a field and loses one, then (8) its kind: never without --drop, even when empty.
  adoptedField: app([`const tasks = table({
  id: id(),
  name: text().notNull().was("title"),
}, { existingTable: "sf_spc_schema_check_tasks_0123456789" });`,
    "const memos = table({ id: id(), text: text() }, { was: \"notes\" });",
    "const tags = table({ id: id(), name: text() });"], "tasks, memos, tags"),
  adoptedKind: app(["const memos = table({ id: id(), text: text() }, { was: \"notes\" });",
    "const tags = table({ id: id(), name: text() });"], "memos, tags"),
  // 9. A narrower column: values that wouldn't fit refuse; MySQL would truncate them.
  narrow: app(["const memos = table({ id: id(), text: text().max(5) }, { was: \"notes\" });",
    "const tags = table({ id: id(), name: text() });"], "memos, tags"),
};

if (process.argv[2] !== undefined) {
  const step = steps[process.argv[2]];
  if (step === undefined) throw new Error(`no step ${process.argv[2]}`);
  process.stdout.write(step);
}
