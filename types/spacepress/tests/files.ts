// Feature 6 config surface: media sizes and private file buckets. Compiles only.
import { collection, defineConfig, f, files, env, type PrivateFileInfo } from "spacepress";

export const decks = files({ accept: ["application/pdf", "image/*"], maxBytes: 20_000_000, access: { read: "owner", create: "author", delete: (ctx) => ctx.user?.role === "admin" } });
export const shared = files({ accept: ["text/plain"], maxBytes: 1_000 });
export const talks = collection({ title: f.text(), deck: f.file(decks).optional() });
type TalkRow = typeof talks.$inferSelect;
const deckId: TalkRow["deck"] = 1;
const noDeck: TalkRow["deck"] = null;

defineConfig({
  name: "files",
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET"), region: "us-east-1", endpoint: env("UPLOAD_ENDPOINT"), pathStyle: true, prefix: "app", credentials: { accessKeyId: env("UPLOAD_KEY"), secretAccessKey: env("UPLOAD_SECRET"), sessionToken: env("UPLOAD_TOKEN") } },
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" }, wide: { width: 1600 }, tall: { width: 300, fit: "inside" } } },
});

// @ts-expect-error a bucket needs accept and maxBytes
files({ accept: ["application/pdf"] });
// @ts-expect-error fit is cover or inside
defineConfig({ name: "x", media: { sizes: { a: { width: 1, fit: "fill" } } } });
// @ts-expect-error f.file() needs a bucket
f.file().optional();
// @ts-expect-error f.file() takes the exported bucket, not its name
f.file({ bucket: "decks" }).optional();
void deckId, noDeck;

// @ts-expect-error credentials must be runtime environment references
defineConfig({ name: "x", uploads: { backend: "s3", bucket: "files", credentials: { accessKeyId: "literal", secretAccessKey: env("SECRET") } } });
defineConfig({ name: "local", uploads: { backend: "local" } });

async function checkReads(id: number) {
  const info: PrivateFileInfo | null = await decks.get(id);
  const body: string = await decks.readText(id);
  const b64: string = await decks.readBase64(id);
  void info, body, b64;
}
void checkReads;
