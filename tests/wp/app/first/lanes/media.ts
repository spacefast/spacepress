// Lane fragment for the WP test app; only this lane edits this file. Every kind, action and job it
// exports registers under its export name, and a name another lane or the app uses fails the build.
import { collection, file, files, group, text, table, media } from "first";

/** One private bucket, owned by its uploader. */
export const decks = files({ accept: ["application/pdf"], maxBytes: 100_000, access: { read: "owner", delete: "owner" } });

/** A post-backed collection holding a private file, for `file(bucket)` on WordPress. */
export const talks = collection({
  title: text(),
  deck: file(decks).optional(),
  image: media().optional(),
  extras: group({ handout: file(decks).optional() }).optional(),
}, { access: { read: "anyone", create: "author", update: "author", delete: "editor" } });

export const uploadRecords = table({
  deck: file(decks).optional(), image: media().optional(),
}, { access: { read: "anyone", create: "author", update: "author", delete: "editor" } });
/** Image sizes (one focal-driven cover crop, one inside fit) and the private bucket. */
export const config = {
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" as const }, wide: { width: 200, fit: "inside" as const } } },
};
