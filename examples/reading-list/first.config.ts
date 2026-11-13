// A reading list that uses each part of a First app once: a WordPress collection, a SQL table,
// per-user access, hooks, an action, a background job, and (in first/app/) a public route that
// uses two npm packages.
import {
  collection, table, text, integer, timestamp, richText, slug,
  defineRelations, defineConfig, action, job, jobs, db, HttpError,
} from "first";
import { mine, ownerId, signedIn } from "./first/lib/owner";

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
  bookId: integer().references(() => books.id, { onDelete: "cascade" }),
  minutes: integer(),
  finishedAt: timestamp().defaultNow(),
  ownerId,
}, {
  access: { read: mine, create: "authenticated", update: mine, delete: mine },
});

export const relations = defineRelations({ books, reads }, (r) => ({
  books: { reads: r.many.reads() },
  reads: { book: r.one.books({ from: r.reads.bookId, to: r.books.id }) },
}));

export default defineConfig({
  name: "reading-list",
  collections: { books },
  tables: { reads },
  relations,
  hooks: {
    // Hooks compile to PHP and run inside the write. Throwing rolls it back.
    reads: {
      beforeCreate(data, ctx) {
        data.ownerId = signedIn(ctx);
        if (data.minutes <= 0) throw new HttpError(422, "invalid_input", "minutes must be positive");
      },
      async afterCreate(row) {
        await jobs.tally.enqueue({ bookId: row.bookId }, { key: `tally-${row.bookId}` });
      },
    },
  },
  actions: {
    // POST /__first/api/v1/actions/logRead, typed in the generated client.
    logRead: action({
      input: { bookId: integer(), minutes: integer() },
      access: "authenticated",
      async handler({ bookId, minutes }, ctx) {
        const [read] = await db.insert(reads).values({ bookId, minutes, ownerId: signedIn(ctx) }).returning();
        return read;
      },
    }),
  },
  jobs: {
    // A job runs after the request, on Action Scheduler: here it totals a book's reading time.
    tally: job({
      input: { bookId: integer() },
      async handler({ bookId }) {
        const all = await db.query.reads.findMany({ where: { bookId } });
        const minutesRead = all.reduce((sum, r) => sum + r.minutes, 0);
        await db.update(books).set({ minutesRead }).where({ id: bookId });
      },
    }),
  },
});
