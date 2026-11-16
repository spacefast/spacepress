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

1. It selects, trusted, the rows whose referencing column holds this row's key (for a
   `ref().many()`, the owners of links to it). It never inspects a whole table.
2. It reads the same rows as the viewer. When any of them is not returned, or the referencing column
   or the referenced key may be hidden from the viewer, the delete is refused with
   `409 reference_violation`, detail `Rows in <child> may reference this row`, no pointer. One or
   many hidden rows give the same body. Hidden rows are never returned, written, cascaded or counted.
3. Under `onDelete: "cascade"` the check repeats for each visible child, to every depth, before any
   row is written.
4. When every referencing row is visible, `onDelete` applies as it did: `restrict` refuses,
   `setNull` updates through the pipeline with the viewer's constraint checks, `cascade` deletes
   through the pipeline. Nothing new is hard-deleted; WordPress's trash stays an unpublish
   ([2026-11-14-trash-is-unpublish.md](2026-11-14-trash-is-unpublish.md)).
5. Trusted writes (hooks, CLI, jobs) are not checked, as before.

## Costs

- A viewer allowed to delete a row learns one bit: whether some row they cannot read references it.
  They learn it only for rows they may delete, and never how many rows, which rows, or their values.
  Databases with row-level security make the same trade for foreign keys.
- The check costs one trusted select and one viewer read per referencing column, plus the same for
  each visible cascaded row.

## Tests

`tests/php/db_test.php` (the owner-scoped block and the hidden-child cases),
`tests/wp/tables.test.ts` (both REST surfaces) and `tests/sync.rs`
(`a_pointerless_reference_refusal_is_not_reported_as_a_missing_target`).
