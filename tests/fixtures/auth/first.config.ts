// The auth-collection fixture (§6.2): members are users. tests/php/auth_test.php runs the runtime on
// it; tests/compiler.rs keeps auth.schema.json in step with the compiler.
import { collection, defineConfig, email, group, integer, select, text, userProjection, table, ref } from "first";

export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
  // A required sub-field only admins set: a member's own patch of `billing` may leave it out.
  billing: group({ city: text().optional(), tier: text().access({ update: "admin" }) }).optional(),
  // A required group whose grandchild only admins set: a member's patch of `profile` may leave `vip` out.
  profile: group({ bio: text().optional(), vip: group({ level: text().access({ update: "admin" }) }) }).optional(),
}, { access: { read: "self", update: "self", create: "anyone", delete: "admin" } });

export const notes = table({
  body: text(),
  memberId: ref(members).optional().onDelete("restrict"),
}, { revisions: true, access: { read: "anyone", create: "authenticated", update: "authenticated" } });

export const collections = {  };
export const tables = { notes };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({
  name: "club",
  collections, tables, users,
  
});
