// A reading list that uses each part of a TypedPress app once: a WordPress collection, a SQL table,
// per-user access, hooks, an action, a background job, and (in tp/app/) a public route that
// uses two npm packages.
import {
  collection, table, text, integer, timestamp, richText, slug,
  defineConfig, job, db, HttpError, ref, mutation,
} from "typedpress";
import { mine, ownerId, signedIn } from "./tp/lib/owner";

// A collection is stored as WordPress posts, so it gets the editor, drafts and revisions.
export const books = collection({
  title: text().max(160),
  slug: slug({ source: "title" }).optional(),
  review: richText().optional(),
  // Written by the tally job below; a client can't set it.
  minutesRead: integer().default(0).access({ create: false, update: false }),
}, {
  title: "title",
  content: "review",
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

// A table is a plain SQL table, with its migration written for you.
export const reads = table({
  bookId: ref(books).onDelete("cascade"),
  minutes: integer(),
  finishedAt: timestamp().defaultNow(),
  ownerId,
}, {
  access: { read: mine, create: "authenticated", update: mine, delete: mine },
}).on({
  beforeCreate(data, ctx) {
    data.ownerId = signedIn(ctx);
    if (data.minutes <= 0) throw new HttpError(422, "invalid_input", "minutes must be positive", "/minutes");
  },
  async afterCreate(row) {
    await tally.enqueue({ bookId: row.bookId }, { key: `tally-${row.bookId}` });
  },
});

// POST /__tp/api/v1/actions/logRead, typed in the generated client.
export const logRead = mutation({ access: "authenticated" }, async ({ bookId, minutes }: { bookId: number; minutes: number }, ctx) => {
  if (!Number.isInteger(bookId)) throw new HttpError(422, "invalid_input", "bookId must be an integer", "/bookId");
  if (!Number.isInteger(minutes)) throw new HttpError(422, "invalid_input", "minutes must be an integer", "/minutes");
  const [read] = await db.insert(reads).values({ bookId, minutes, ownerId: signedIn(ctx) }).returning();
  return read;
});

// A job runs after the request, on Action Scheduler: here it totals a book's reading time.
export const tally = job({}, async ({ bookId }: { bookId: number }) => {
  if (!Number.isInteger(bookId)) throw new HttpError(422, "invalid_input", "bookId must be an integer", "/bookId");
  const all = await db.query.reads.findMany({ where: { bookId } });
  const minutesRead = all.reduce((sum, r) => sum + r.minutes, 0);
  await db.update(books).set({ minutesRead }).where({ id: bookId });
});

export default defineConfig({
  name: "reading-list",
});
