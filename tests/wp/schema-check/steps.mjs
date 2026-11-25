// Each step is built into the same project so the compiler sees the earlier migrations.
const tasks = (title = 'title: text()') =>
  `export const tasks = table({ ${title}, note: text().optional() }, { existingTable: "wp_external_tasks" });`;
const likes = (fields = "") => `export const likes = table({ post: integer()${fields} });`;
const tags = 'export const tags = table({ name: text().optional() });';
const notes = (fields = {}, name = "notes", options = "") => {
  const columns = {
    body: "text().max(100).optional()",
    state: 'text().default("open")',
    category: 'text().default("general")',
    flag: "text().optional()",
    count: "text().optional()",
    ratio: "text().optional()",
    total: "integer().optional()",
    ...fields,
  };
  const declarations = Object.entries(columns)
    .filter(([, declaration]) => declaration !== null)
    .map(([field, declaration]) => `${field}: ${declaration}`);
  return `export const ${name} = table({ ${declarations.join(", ")} }${options});`;
};

const app = (...parts) => `import { boolean, defineConfig, integer, number, ref, table, text } from "spacepress";
${parts.join("\n")}
export default defineConfig({ name: "schema-check" });
`;

const additiveLikes = likes(", emoji: text().optional()");
const aliasedNotes = (retire = false) => notes({
  body: null,
  category: retire ? null : 'text().default("general")',
  text: 'text().max(100).column("body").alias("body").optional()',
}, "memos", ', { storageName: "notes" }');

const steps = {
  initial: app(tasks(), likes(), notes({ body: "text().max(16).optional()", state: "text().optional()", category: null })),
  additive: app(tasks(), additiveLikes, notes(), tags),
  renamed: app(tasks('name: text().column("title").alias("title")'), additiveLikes, aliasedNotes(), tags),
  retired: app(aliasedNotes(true), tags),

  required: app(tasks(), additiveLikes, notes({ reviewer: "text()" }), tags),
  tighten: app(tasks(), additiveLikes, notes({ body: "text().max(100)" }), tags),
  narrow: app(tasks(), additiveLikes, notes({ body: "text().max(5).optional()" }), tags),
  toBoolean: app(tasks(), additiveLikes, notes({ flag: "boolean().optional()" }), tags),
  toInteger: app(tasks(), additiveLikes, notes({ count: "integer().optional()" }), tags),
  toReal: app(tasks(), additiveLikes, notes({ ratio: "number().optional()" }), tags),
  integerToReal: app(tasks(), additiveLikes, notes({ total: "number().optional()" }), tags),
  toRef: app(tasks(), additiveLikes, notes({ count: "ref(likes).optional()" }), tags),
  renameColumn: app(tasks(), additiveLikes, notes({ body: 'text().max(100).was("oldBody").optional()' }), tags),
  renameTable: app(tasks(), additiveLikes, notes({}, "memos", ', { was: "notes" }'), tags),
};

const step = steps[process.argv[2]];
if (step === undefined) throw new Error(`unknown step ${process.argv[2]}`);
process.stdout.write(step);
