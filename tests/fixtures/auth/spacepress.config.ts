// The auth-collection fixture (§6.2): members are users. tests/php/auth_test.php runs the runtime on
// it; tests/compiler.rs keeps auth.schema.json in step with the compiler.
import { defineConfig, extend, table, f } from "spacepress";

export const members = extend("users", {
  fields: {
    name: f.text().max(80),
    plan: f.select(["free", "pro"]).default("free"),
    // A required sub-field only admins set: a member's own patch of `billing` may leave it out.
    billing: f.group({ city: f.text().optional(), tier: f.text().access({ update: "admin" }) }).optional(),
    // A required group whose grandchild only admins set: a member's patch of `profile` may leave `vip` out.
    profile: f.group({ bio: f.text().optional(), vip: f.group({ level: f.text().access({ update: "admin" }) }) }).optional(),
  },
  access: { read: "self", update: "self", create: "anyone", delete: "admin" },
});

export const notes = table({
  body: f.text(),
  memberId: f.ref(members).optional().onDelete("restrict"),
}, { revisions: true, access: { read: "anyone", create: "authenticated", update: "authenticated" } });

export const collections = {  };
export const tables = { notes };
export const users = { members };
export const entities = { ...collections, ...tables, ...users };
export default defineConfig({
  name: "club",

});
