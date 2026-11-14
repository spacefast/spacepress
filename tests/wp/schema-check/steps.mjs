// The schema-check lane's app at each deploy, one first.config.ts per step. `run.sh` builds them
// in order into one project, so every step's migration is planned against the previous step's
// ledger, exactly as successive deploys of one app would be.
//
//   node steps.mjs <step>   prints that step's first.config.ts
//
// `tasks` is bound to a table the app did not create (`existingTable`), as `first migrate app
// --from zero-0.8 --space <id>` binds a migrated Space's tables. `likes` and `notes` are First's.
const tasks = (fields = "") => `export const tasks = table({
  title: text(),
  note: text().optional(),${fields}
}, { existingTable: "sf_spc_schema_check_tasks_510ec462fc" });`;
const likes = (fields = "", options = "") => `export const likes = table({
  post: integer(),${fields}
}${options});`;
const notes = (fields = "", options = "") => `export const notes = table({
  body: text().optional(),${fields}
}${options});`;

const app = (parts) => `import { boolean, defineConfig, integer, number, ref, table, text } from "first";
${parts.join("\n")}
export default defineConfig({ name: "schema-check" });
`;

export const steps = {
  // 1. The first deploy: adopts tasks, creates likes and notes.
  initial: app([tasks(), likes(), notes()]),
  // 2. Additive: a new kind, an optional field, a required field with a default. No --drop, no refusal.
  additive: app([tasks(), likes(`\n  emoji: text().optional(),`), notes(`\n  state: text().default("open"),`),
    "export const tags = table({ name: text().optional() });"]),
  // 3. A new required field with no default on a kind that has rows: refused with the count.
  required: app([tasks(), likes(`\n  emoji: text().optional(),`), notes(`\n  state: text().default("open"),\n  author: text(),`),
    "export const tags = table({ name: text().optional() });"]),
  // 4. An optional field becomes required: refused while rows lack it.
  tighten: app([tasks(), likes(`\n  emoji: text(),`), notes(`\n  state: text().default("open"),`),
    "export const tags = table({ name: text().optional() });"]),
  // 5. Renames: notes → memos, body → text. Nothing is dropped, so nothing is asked.
  rename: app([tasks(), likes(`\n  emoji: text().optional(),`),
    `export const memos = table({
  text: text().was("body").optional(),
  state: text().default("open"),
}, { was: "notes" });`,
    "export const tags = table({ name: text().optional() });"]),
  // 6. Drops: the likes kind and the memos.state field, both holding rows.
  drop: app([tasks(),
    `export const memos = table({
  text: text().optional(),
}, { was: "notes" });`,
    "export const tags = table({ name: text().optional() });"]),
  // 7. The adopted table renames a field and loses one, then (8) its kind: never without --drop, even when empty.
  adoptedField: app([`export const tasks = table({
  name: text().was("title"),
}, { existingTable: "sf_spc_schema_check_tasks_510ec462fc" });`,
    "export const memos = table({ text: text().optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().optional() });"]),
  adoptedKind: app(["export const memos = table({ text: text().optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().optional() });"]),
  // 9. A narrower column: values that wouldn't fit refuse; MySQL would truncate them.
  narrow: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().optional() });"]),
  // 10. Text fields become a boolean and an integer: text is compared as text, and integers are
  //     range-checked, since MySQL would turn 'yes' into 0 and clamp a value past BIGINT's range.
  retype: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().optional(), flag: text().optional(), count: text().optional() });"]),
  retyped: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().optional(), flag: boolean().optional(), count: integer().optional() });"]),
  // 11. One change makes a field required and narrower: a too-long value refuses like a missing one.
  requiredNarrow: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: integer().optional() });"]),
  // 12. An integer becomes a real: a DOUBLE holds integers exactly only up to 2^53, and the check
  //     must not overflow on BIGINT's minimum (an erroring count must refuse, never pass).
  toReal: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional() });"]),
  // 13. Text becomes a real: only a plain decimal converts. MySQL would read '1,5' and '1x5' as 1,
  //     '1e3' as 1000 and '5\n' as 5, so each refuses.
  ratioText: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: text().optional() });"]),
  ratioReal: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: number().optional() });"]),
  // 14. Text becomes a reference to memos (BIGINT UNSIGNED). MariaDB's ALTER clamps text from 2^63
  //     up to 2^63 - 1 even into an unsigned column, so those values refuse.
  memoText: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: number().optional(), memo: text().optional() });"]),
  memoRef: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: number().optional(), memo: ref(memos).optional() });"]),
  // 15. A table the app didn't create comes back with an optional field, then (16) that field
  //     changes type: a retype of an adopted table is refused even when empty, until --drop names it.
  readoptField: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: number().optional(), memo: ref(memos).optional() });",
    `export const tasks = table({ name: text().optional(), rank: integer().optional() }, { existingTable: "sf_spc_schema_check_retype_082186420c" });`]),
  readoptRetype: app(["export const memos = table({ text: text().max(5).optional() }, { was: \"notes\" });",
    "export const tags = table({ name: text().max(5), flag: boolean().optional(), count: number().optional(), ratio: number().optional(), memo: ref(memos).optional() });",
    `export const tasks = table({ name: text().optional(), rank: text().optional() }, { existingTable: "sf_spc_schema_check_retype_082186420c" });`]),
};

if (process.argv[2] !== undefined) {
  const step = steps[process.argv[2]];
  if (step === undefined) throw new Error(`no step ${process.argv[2]}`);
  process.stdout.write(step);
}
