// A small editorial site with optional TSX pages (pages/). The config stays the whole backend:
// collections, access rules and one public action. The pages add-on reads it through
// viewer-bound queries and never through the trusted `db`.
import { collection, table, text, integer, richText, slug, timestamp, defineConfig, action, route, env, db, HttpError, ref } from "first";

const STAFF = ["author", "editor", "admin"];

export const notes = collection({
  title: text().min(1).max(120),
  slug: slug({ source: "title" }).optional(),
  dek: text({ multiline: true }).max(240).optional(),
  body: richText().optional(),
  // Staff-only desk notes: anonymous rows never carry the value.
  deskNotes: text({ multiline: true }).max(500).access({ read: "author", create: "editor", update: "editor" }).optional(),
  updatedAt: timestamp().defaultNow().$onUpdate(() => new Date()),
}, {
  label: "Notes",
  title: "title",
  content: "body",
  access: {
    read: (ctx) => STAFF.includes(ctx.user?.role ?? "") ? true : { status: "published" },
    create: "author",
    update: "editor",
    delete: "editor",
  },
});

// Reader applause per note. Anyone may read counts; only the cheer action writes them.
export const cheers = table({
  noteId: ref(notes).unique().onDelete("cascade"),
  count: integer().default(0),
}, { access: { read: "anyone", create: "admin", update: "admin", delete: "admin" } });

export default defineConfig({
  name: "fullsite",
  collections: { notes },
  tables: { cheers },
  actions: {
    // The page's one interactive action: a published note gets one more cheer.
    cheer: action({
      input: { noteId: integer() },
      access: "anyone",
      async handler({ noteId }) {
        const note = await db.query.notes.findFirst({ where: { id: noteId, status: "published" } });
        if (!note) throw new HttpError(404, "not_found", "No published note has that id");
        const row = await db.query.cheers.findFirst({ where: { noteId } });
        if (row) {
          await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
          return { count: row.count + 1 };
        }
        await db.insert(cheers).values({ noteId, count: 1 });
        return { count: 1 };
      },
    }),
  },
  // Custom HTTP endpoints on the site's own paths: a public JSON Feed and a signed webhook.
  routes: {
    feed: route({
      method: "GET",
      path: "/api/feed.json",
      access: "anyone",
      async handler(req) {
        const limit = Number(req.query.get("limit") ?? "10");
        const notes = await db.query.notes.findMany({ where: { status: "published" }, orderBy: { id: "desc" }, limit: limit > 0 && limit <= 50 ? limit : 10 });
        const items = notes.map((note) => ({ id: String(note.id), title: note.title, summary: note.dek ?? "" }));
        return {
          headers: { "content-type": "application/feed+json" },
          body: JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Field Notes", items }),
        };
      },
    }),
    stripe: route({
      method: "POST",
      path: "/webhooks/stripe",
      signature: { secret: env("FULLSITE_WEBHOOK_SECRET"), header: "x-fullsite-signature", scheme: "hmac-sha256" },
      async handler(req) {
        const event = JSON.parse(req.body) as { noteId: number };
        const noteId = Number(event.noteId);
        const row = await db.query.cheers.findFirst({ where: { noteId } });
        if (row) await db.update(cheers).set({ count: row.count + 1 }).where({ id: row.id });
        return { status: 202, body: "accepted " + req.headers["x-fullsite-signature"].slice(0, 8) };
      },
    }),
  },
  admin: false,
});
