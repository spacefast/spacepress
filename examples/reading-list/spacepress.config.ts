// A reading list that uses each part of a SpacePress app once: a WordPress collection, a SQL table,
// per-user access, hooks, an action, a background job, and (in sp/app/) a public route that
// uses two npm packages.
import { collection, defineConfig, f, job, mutation, table } from "spacepress";
import { HttpError } from "spacepress/server";
import { mine, ownerId, signedIn } from "./sp/lib/owner";

// A collection is stored as WordPress posts, so it gets the editor, drafts and revisions.
export const books = collection({
  title: f.text().max(160),
  slug: f.slug({ source: "title" }).optional(),
  review: f.richText().optional(),
  // Written by the tally job below; a client can't set it.
  minutesRead: f.integer().default(0).access({ create: false, update: false }),
}, {
  title: "title",
  content: "review",
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

// A table is a plain SQL table, with its migration written for you.
export const reads = table({
  bookId: f.ref(books).onDelete("cascade"),
  minutes: f.integer(),
  finishedAt: f.timestamp().defaultNow(),
  ownerId,
}, {
  access: { read: mine, create: "authenticated", update: mine, delete: mine },
}).on({
  beforeCreate({ data, user }) {
    data.ownerId = signedIn({ user });
    if (data.minutes <= 0) throw new HttpError(422, "invalid_input", "minutes must be positive", "/minutes");
  },
  async afterCreate({ row }) {
    await tally.enqueue({ bookId: row.bookId }, { key: `tally-${row.bookId}` });
  },
});

// POST /wp-json/spacepress/v1/actions/logRead, typed in the generated client.
export const logRead = mutation({ access: "authenticated" }, async ({ db, user }, { bookId, minutes }: { bookId: number; minutes: number }) => {
  if (!Number.isInteger(bookId)) throw new HttpError(422, "invalid_input", "bookId must be an integer", "/bookId");
  if (!Number.isInteger(minutes)) throw new HttpError(422, "invalid_input", "minutes must be an integer", "/minutes");
  return await db.system.reads.create({ bookId, minutes, ownerId: signedIn({ user }) });
});

// A job runs after the request, on Action Scheduler: here it totals a book's reading time.
export const tally = job({}, async ({ db }, { bookId }: { bookId: number }) => {
  if (!Number.isInteger(bookId)) throw new HttpError(422, "invalid_input", "bookId must be an integer", "/bookId");
  const all = await db.reads.list({ where: { bookId } });
  const minutesRead = all.reduce((sum, r) => sum + r.minutes, 0);
  await db.books.update(bookId, { minutesRead });
});

export default defineConfig({
  name: "reading-list",
});
