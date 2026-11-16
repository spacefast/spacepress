// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
//
// Lane B (field access + conditional fields, phase 2 §4): a post-backed collection whose columns
// carry `.access` and `.showIf`, linked to a `table()` table with an admin-only column.
import { boolean, collection, email, group, integer, text, table, select, ref } from "typedpress";
import { posts } from "../blog/typedpress.config.ts";

export const fieldTeams = table({
  name: text(),
  budget: integer().access({ read: "admin" }).optional(),
}, { access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const fieldStaff = collection({
  name: text(),
  email: email().access({ read: "editor" }).optional(),
  ownerId: integer().optional(),
  // Owners and editors see the salary; only admins change it.
  salary: integer().access({
    read: (ctx) => ctx.user !== null && (ctx.user.role === "editor" || ctx.user.role === "admin" || ctx.data.ownerId === ctx.user.id),
    update: "admin",
  }).optional(),
  kind: select(["basic", "pro"]).optional(),
  active: boolean().optional(),
  plan: text().showIf({ kind: "pro" }).optional(),
  discount: integer().showIf({ OR: [{ kind: { in: ["basic", "pro"] } }, { active: true }] }).optional(),
  // `status` is a core post column, not an SCF field: settled from the saved row when the form renders.
  headline: text().showIf({ status: "published", kind: "pro" }).optional(),
  // A reference to a post-backed collection renders as SCF post_object, whose inequality is '!=='.
  postNote: text().showIf({ postId: { ne: 1 } }).validate((v, ctx) => v !== "pro only" || ctx.data.kind === "pro" || "Only pro staff take this note").optional(),
  always: text().showIf({ OR: [{}, { kind: "pro" }] }).optional(),
  postId: ref(() => posts).optional(),
  notes: group({
    public: text().validate((value, ctx) => ctx.data.notes?.public === value || "Invalid note").optional(),
    private: text().access({ read: "editor" }).showIf({ public: { isNotNull: true } }).optional(),
  }).optional(),
  teamId: ref(fieldTeams).optional(),
}, {
  title: "name",
  access: {
    read: "anyone",
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});
/** Top-level options this lane owns (e.g. webhooks, media, locales). */
export const config = {};
