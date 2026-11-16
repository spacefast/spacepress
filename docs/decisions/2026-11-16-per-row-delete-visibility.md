# A delete checks the rows that reference it, not whole tables

Date: 2026-11-16. Status: accepted by the release coordinator as the recommended option; the owner can reverse it.

## Context

PR #72 made write failures unable to reveal rows the viewer can't read. For deletes it required
the viewer to read every row of every table that references the deleted row's table, including
tables with no row pointing at it. An owner-scoped app filters every table with
`read: ({ user }) => ({ ownerId: user.id })`, so no viewer can ever read a whole referencing table,
and every HTTP delete of a referenced kind answered `409 reference_violation`, whatever the data.
examples/pet-food, stuff-drawer, subscriptions and drive-locker could not delete a pet, an empty
bin, a subscription or a place.

## Decision

A viewer's delete looks only at the rows that reference this row:

1. It counts, trusted, the rows whose referencing column holds this row's key (for a
   `ref().many()`, including a taxonomy's terms, the owners of links to it). It never inspects a
   whole table, and it loads no row before deciding, so hidden volume can't change the answer.
2. It counts the same rows as the viewer. When the counts differ, or the referencing column or the
   referenced key may be hidden from the viewer, the delete is refused with
   `409 reference_violation`, detail `Rows you can't read may reference this row`, no pointer. Every
   refusal has that body: it names no table, depth or count. Hidden rows are never returned,
   written or cascaded.
3. Under `onDelete: "cascade"` the check repeats for each visible child, to every depth, before any
   referential write.
4. When every referencing row is visible, `onDelete` applies as it did: `restrict` refuses,
   `setNull` and `setDefault` update through the pipeline, `cascade` deletes through the pipeline.
   A `setNull` or `setDefault` branch with rows keeps #72's generated-value preflight: the value it
   writes, on-update columns and anything a `beforeUpdate` hook may write into a unique or reference
   column must be visible to the viewer, so the answer can't depend on a hidden value. Nothing new
   is hard-deleted; WordPress's trash stays an unpublish
   ([2026-11-14-trash-is-unpublish.md](2026-11-14-trash-is-unpublish.md)).
5. When a read extension is registered that may hide rows (`Extensions::constraintReadsSafe()` is
   false), counts can't prove visibility, and any relationship to this collection refuses, as #72 did.
6. Trusted writes (hooks, CLI, jobs) are not checked, as before.

## Costs

- A viewer allowed to delete a row learns one bit: whether some row they cannot read references it.
  They learn it only for rows they may delete, and never how many rows, which rows, or their values.
  Databases with row-level security make the same trade for foreign keys.
- The check costs two counts per referencing column, plus a read of each visible cascaded row.
- `beforeDelete` hooks run before the check; a refusal rolls their writes back with the transaction.

## Tests

`tests/php/db_test.php` (the owner-scoped block, the hidden-child cases and the PR #516 review
cases: hook-written and default references, many-ref links, hidden volume, read extensions),
`tests/php/taxonomy_test.php` (a term on an item the viewer can't read),
`tests/wp/tables.test.ts` (both REST surfaces) and `tests/sync.rs`
(`a_pointerless_reference_refusal_is_not_reported_as_a_missing_target`).
