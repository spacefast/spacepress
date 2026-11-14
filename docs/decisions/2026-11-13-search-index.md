# A search index, filtered by the reader's access at query time

Date: 2026-11-13. Status: accepted. Spec: [spec.md](../spec/spec.md) §2.6 (`search`), §3.

## Problem

`search` on a kind (`posts.list({ search })`, `?search=` on the API and on core's list routes) ran
`LIKE '%term%'` over every searchable field of every row the reader may see, through two copies of
the same code (`Seam::searched`, `FirstQuery::search`). That scans each field's meta row, cannot use
an index, matches inside words (`tea` in `steal`), and ranks nothing. There was no site-wide search.

## Decision

**An index the write path keeps.** `first__search` holds one row per (kind, row, field) with the
field's text as a reader sees it: markup and block comments dropped, entities decoded. It is a
system table (`SystemTables`), created on the plugin's upgrade check like the job tables.

- Every pipeline write (the API, actions, hooks, jobs, wp-admin and core REST saves) reports through
  `Extensions::onWritten` inside its transaction. The row's entries are replaced there, so the index
  commits and rolls back with the write: there is no window where a committed row is unsearchable
  or a rolled-back one is.
- The entries are written from the row as stored when the report runs, not from the report's own
  copy. An after-hook that writes the row again reports first; the outer report then reads the same
  final row, so an older snapshot is never the last thing indexed.
- Each entry is written by its exact key: an upsert of (kind, row, field) for a field with text, a
  delete by key for one without, and a delete of the row's entries for fields no longer searchable.
  Deleting the row's whole key range before inserting deadlocked under concurrent creates on
  InnoDB: a delete that matches nothing takes a gap lock, and two new rows in the same gap each
  waited on the other's insert (about one write in forty, at 24 concurrent writers).
  `tests/wp/search.test.ts` runs that load.
- Users are also written by WordPress itself (`wp_insert_user`, the profile screen, sign-up), which
  doesn't go through the pipeline. The members kind's entries follow core's `user_register`,
  `profile_update` and `deleted_user` hooks, re-read from the stored user the same way.
- A kind whose searchable fields change in a build is rebuilt by a runtime job, `first.search.reindex`,
  through the existing outbox and Action Scheduler, a batch of rows per run. Nothing is polled; no
  cron, tick or worker is added. The rebuild clears nothing first: each run re-indexes its batch, row
  by row under a lock, and the last run deletes the entries of rows that no longer exist and of fields
  that are no longer searchable. A run carries the build's field list as its generation, and a run of
  an older generation does nothing.

**Access is decided by the read, never by the index.** The index holds every row, published or not,
because whether a row is visible depends on who asks. A search compiles to one more condition on
the kind's ordinary read: "every term occurs in a searchable field the reader may read". The read
rule, a filter the rule returns, draft visibility and the store's own guards (post passwords) are
the same guards as on any list, so the rows, `count()`, the API's `cursor` and the order are exactly
what the reader would get by listing the kind and filtering by hand.

- **Hidden fields.** Each field is its own index row, and the condition names only the fields the
  reader may read in every row (`FieldAccess::mayHide`, the rule the old search already used). A
  value in a hidden field never qualifies a row, so it can't be found, counted or inferred.
- **No refusal.** Because a search only consults readable fields, it is never refused for a hidden
  field (the old `LIKE` search answered 403 when the content was hidden). Core's users route
  (`/wp/v2/users?search=`) used to run core's own search over login, nicename and email, outside
  First's read; it now selects members through First as the reader, with core's search off, and
  `X-WP-Total` counts the same members.
- **No relevance ranking.** A score would be computed over text the reader may not see (MySQL's
  FULLTEXT relevance uses document frequencies across the whole index), and ordering by it leaks
  through rank. Results keep the kind's own order (`orderBy`, else its default), as before.

**MySQL and MariaDB use FULLTEXT; SQLite matches word prefixes.** On MySQL and MariaDB the condition
is `MATCH (body) AGAINST ('+term*' IN BOOLEAN MODE)`, served by the table's FULLTEXT index. The SQLite
Database Integration plugin (dev sites, WordPress Playground, the PHP suites) accepts a FULLTEXT key
but has no `MATCH`; there the same condition uses `FIRST_WORD_PREFIX(body, term)`, a function First
registers on the SQLite connection, with Unicode case folding like the MySQL collations. Both match a
term at the start of a word. The two differ in what MySQL leaves out: InnoDB ignores its stopwords
and words shorter than `innodb_ft_min_token_size` (3), which the SQLite path matches. The tests run on
SQLite; the MySQL statement is exercised by the WordPress suite on MariaDB.

Three more differences are accepted rather than papered over:

- **Read after write.** InnoDB applies FULLTEXT changes at commit, so `MATCH` inside the transaction
  that wrote a row doesn't see its new text (a hook that searches for the row it just saved finds
  the old entries). Requests and jobs search after their writes commit, so readers see every
  committed write. The SQLite path sees the transaction's own writes.
- **Accents and underscores.** The table's `utf8mb4_unicode_ci` collation makes MySQL ignore accents
  (`cafe` finds `café`), and MySQL's parser keeps `_` inside a word (`bar` doesn't find `foo_bar`). The
  SQLite path folds case only, and starts a new word after `_`.
- **Keys are bytes.** `kind`, `item` and `field` are `VARBINARY`, so ids that differ only in case are
  distinct and no collation is involved in the join. The SQLite translator turns `CAST(… AS BINARY)`
  into text, which never equals a BLOB, so there the join reads the stored id as text instead.

**Timing.** The index holds every row, readable or not, and the condition is evaluated inside the
reader's query. How long a search takes can vary with how many rows match, including rows the reader
can't see. That is a weak channel (noise from the rest of the request dominates it), the same one any
filtered list has, and it is not closed here.

**One site-wide endpoint.** `GET /__first/api/v1/search?q=…` runs the same search on every kind with
a searchable field and an API list, as the caller, and returns the matching rows per kind. A kind the
caller may not read is left out without a word, and `kinds=` naming a kind that doesn't exist or isn't
searchable gives the same empty answer as one with no match.

**ElasticPress coexists.** ElasticPress (4.2, as VIP Enterprise Search runs it) replaces core queries,
not tables: it returns its own results from `posts_pre_query` (WP_Query), `users_pre_query`,
`terms_pre_query` and `comments_pre_query`, for a query it chose to integrate (a front-end or REST
search, or one that sets `ep_integrate`). First's search never reaches those filters: the API, the
site-wide endpoint and `{ search }` read `first__search` through First's own SQL, and First's handlers
for core's list routes strip `s` before core's `WP_Query` runs (`FirstQuery::coreArgs`) and select the
rows themselves. So on a site with ElasticPress, First's kinds are searched by First, with the reader's
access, and WordPress's own searches (the theme's `?s=`, core's `/wp/v2/search`, other plugins'
`WP_Query`) are ElasticPress's, as before. Neither needs the other turned off. ElasticPress indexes
only `public` post types by default (`Post::get_indexable_post_types`), and First registers its kinds
with `public => false`, so it doesn't index them. A site that adds them through
`ep_indexable_post_types` would have core searches over them answered from Elasticsearch, outside
First's field access; it shouldn't.

## Not done

The static JSON index of prerendered pages: static prerender into `first/dist/` is not on main yet
(it belongs to the app-pages work). When it lands, the build can write the index of the pages it
prerendered from the same text rules.

`first/app/` pages are not in the search index. A page's text is what it renders for a reader, which
depends on who reads it; the rows it shows are searchable through their kinds. With prerender, the
prerendered pages are the ones whose text is the same for every reader, and they are the ones to index.
