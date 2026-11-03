// Feature 6 config surface (phase 2 §7.2): media sizes and private file buckets. Compiles only.
import { collection, defineConfig, file, files, id, text, env } from "zero";

const talks = collection({ id: id(), title: text().notNull(), deck: file({ bucket: "decks" }) });
type TalkRow = typeof talks.$inferSelect;
const deckId: TalkRow["deck"] = 1;
const noDeck: TalkRow["deck"] = null;

defineConfig({
  name: "files",
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET"), region: "us-east-1", endpoint: env("UPLOAD_ENDPOINT"), pathStyle: true, prefix: "app", credentials: { accessKeyId: env("UPLOAD_KEY"), secretAccessKey: env("UPLOAD_SECRET"), sessionToken: env("UPLOAD_TOKEN") } },
  collections: { talks },
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" }, wide: { width: 1600 }, tall: { width: 300, fit: "inside" } } },
  files: {
    decks: files("decks", { accept: ["application/pdf", "image/*"], maxBytes: 20_000_000, access: { read: "owner", create: "author", delete: (ctx) => ctx.user?.role === "admin" } }),
    shared: files("shared", { accept: ["text/plain"], maxBytes: 1_000 }),
  },
});

// @ts-expect-error a bucket needs accept and maxBytes
files("broken", { accept: ["application/pdf"] });
// @ts-expect-error fit is cover or inside
defineConfig({ name: "x", collections: {}, media: { sizes: { a: { width: 1, fit: "fill" } } } });
// @ts-expect-error file() needs a bucket
file();
void deckId, noDeck;

// @ts-expect-error credentials must be runtime environment references
defineConfig({ name: "x", uploads: { backend: "s3", bucket: "files", credentials: { accessKeyId: "literal", secretAccessKey: env("SECRET") } } });
defineConfig({ name: "local", uploads: { backend: "local" } });
