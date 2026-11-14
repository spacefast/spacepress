// The store lane's second app: one of every thing First installs for a build, so the lane can check
// that a managed boot installs none of it and initialize installs all of it.
import { collection, defineConfig, email, files, file, select, text, userProjection } from "first";

// Members with a default: the guest role, the identity client and the member backfill.
export const members = userProjection({
  email: email().unique().max(191),
  name: text().max(80),
  plan: select(["free", "pro"]).default("free"),
}, { access: { read: "self", update: "self", create: "admin", delete: "admin" } });

// A private files bucket: the secret, the directory and its deny rules.
export const decks = files({ accept: ["application/pdf"], maxBytes: 100_000, access: { read: "owner", delete: "owner" } });

// A kind with a URL pattern (rewrite rules) and searchable text (the search shape).
export const notes = collection({
  title: text(),
  body: text().optional(),
  deck: file(decks).optional(),
}, { title: "title", url: "/notes/:id", access: { read: "anyone", create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({
  name: "installlane",
  runtimeSchema: true,
});
