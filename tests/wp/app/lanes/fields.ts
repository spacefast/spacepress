// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
//
// Lane B (field access + conditional fields, phase 2 §4): a post-backed collection whose columns
// carry `.access` and `.showIf`, linked to an `editor: false` table with an admin-only column.
import { boolean, collection, email, group, id, integer, text } from "zero";
import { posts } from "../../../fixtures/blog/zero.config.ts";

export const fieldTeams = collection("field_teams", {
  id: id(),
  name: text().notNull(),
  budget: integer().access({ read: "admin" }),
}, { editor: false, access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export const fieldStaff = collection("field_staff", {
  id: id(),
  name: text().notNull(),
  email: email().access({ read: "editor" }),
  ownerId: integer(),
  // Owners and editors see the salary; only admins change it.
  salary: integer().access({
    read: (ctx) => ctx.user !== null && (ctx.user.role === "editor" || ctx.user.role === "admin" || ctx.data.ownerId === ctx.user.id),
    update: "admin",
  }),
  kind: text({ enum: ["basic", "pro"] }),
  active: boolean(),
  plan: text().showIf({ kind: "pro" }),
  discount: integer().showIf({ OR: [{ kind: { in: ["basic", "pro"] } }, { active: true }] }),
  // `status` is a core post column, not an SCF field: settled from the saved row when the form renders.
  headline: text().showIf({ status: "published", kind: "pro" }),
  // A reference to a post-backed collection renders as SCF post_object, whose inequality is '!=='.
  postNote: text().showIf({ postId: { ne: 1 } }),
  always: text().showIf({ OR: [{}, { kind: "pro" }] }),
  postId: integer().references(() => posts.id, { onDelete: "set null" }),
  notes: group({ fields: {
    public: text().validate((value, ctx) => ctx.data.notes?.public === value || "Invalid note"),
    private: text().access({ read: "editor" }).showIf({ public: { isNotNull: true } }),
  } }),
  teamId: integer().references(() => fieldTeams.id, { onDelete: "set null" }),
}, {
  title: "name",
  access: {
    read: "anyone",
    create: "author",
    update: (ctx) => ctx.user?.role === "admin" || ctx.user?.role === "editor" ? true : { ownerId: ctx.user?.id ?? -1 },
    delete: "editor",
  },
});

export const schema = { fieldTeams, fieldStaff };
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: any) => ({
  fieldStaff: { team: r.one.fieldTeams({ from: r.fieldStaff.teamId, to: r.fieldTeams.id }) },
  fieldTeams: { members: r.many.fieldStaff() },
});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Top-level options this lane owns (e.g. jobs, webhooks, files, media, locales). */
export const config = {};
