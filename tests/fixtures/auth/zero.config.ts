// The auth-collection fixture (§6.2): members are users. tests/php/auth_test.php runs the runtime on
// it; tests/compiler.rs keeps auth.schema.json in step with the compiler.
import { collection, defineConfig, defineRelations, email, group, id, integer, select, text, userProjection, table } from "zero";

export const members = userProjection({
  id: id(),
  email: email().notNull().unique().max(191),
  name: text().notNull().max(80),
  plan: select({ options: ["free", "pro"] }).notNull().default("free"),
  // A required sub-field only admins set: a member's own patch of `billing` may leave it out.
  billing: group({ fields: { city: text(), tier: text().notNull().access({ update: "admin" }) } }),
  // A required group whose grandchild only admins set: a member's patch of `profile` may leave `vip` out.
  profile: group({ fields: { bio: text(), vip: group({ fields: { level: text().notNull().access({ update: "admin" }) } }).notNull() } }),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export const notes = table({
  id: id(),
  body: text().notNull(),
  memberId: integer().references(() => members.id),
}, { revisions: true, access: { read: "anyone", create: "authenticated", update: "authenticated" } });

export const collections = {  };
export const tables = { notes };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({
  name: "club",
  collections, tables, users,
  relations: defineRelations(entities, (r) => ({
    notes: { member: r.one.members({ from: r.notes.memberId, to: r.members.id }) },
    members: { notes: r.many.notes() },
  })),
});
