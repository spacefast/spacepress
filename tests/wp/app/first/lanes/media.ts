// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
import { collection, file, files, group, text, table, media } from "first";

/** A post-backed collection holding a private file, for `file({ bucket })` on WordPress. */
export const talks = collection({
  title: text(),
  deck: file({ bucket: "decks" }).optional(),
  image: media().optional(),
  extras: group({ handout: file({ bucket: "decks" }).optional() }).optional(),
}, { access: { read: "anyone", create: "author", update: "author", delete: "editor" } });

export const collections = { talks };
export const uploadRecords = table({
  deck: file({ bucket: "decks" }).optional(), image: media().optional(),
}, { access: { read: "anyone", create: "author", update: "author", delete: "editor" } });
export const tables = { uploadRecords };
export const users = {  };
export const entities = { ...collections, ...tables, ...users };
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Image sizes (one focal-driven cover crop, one inside fit) and one private bucket owned by its uploader. */
export const config = {
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" as const }, wide: { width: 200, fit: "inside" as const } } },
  files: { decks: files("decks", { accept: ["application/pdf"], maxBytes: 100_000, access: { read: "owner", delete: "owner" } }) },
};
